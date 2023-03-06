import * as os from 'node:os';
import { ChildProcess, spawn } from 'child_process';
import CDP from 'chrome-remote-interface';
import { asResult, CancelToken, willCompleteInTime, EventPromiseSource, ReentrancyGuard } from '../support/promise.js';
import { sleepMs } from '../support/sleep.js';
import { LogicError } from '../support/errors/common.js';
import { Timeout } from '../support/timeout.js';
import { EventEmitter } from 'node:events';
import { Defer } from '../support/defer.js';
import { CdpClient, createCdpClient } from '../support/cdp.js';
import { Logger, nullLogger } from '../support/logging.js';
import { Throwable } from '../support/types/utilities.js';

/**
 * Starts a chrome browser process and exposes a debugging
 * {@link BrowserProcess.client|client}. Additionally the process
 * is supervised and restarted on crash.
 */
export class BrowserProcess extends EventEmitter {
  private _process: ChildProcess | null = null;
  private _options: BrowserProcessOptionsInternal;
  private _status = BrowserProcessStatus.Initial;
  private _stopReason: BrowserProcessStopReason | null = null;
  private _restartTimeout = Timeout.cleared();
  private _browserInfo: BrowserInfo | null = null;
  private _version = BigInt(0);
  private _client: CdpClient | null = null;
  private _stopReentrancyGuard = new ReentrancyGuard<bigint>();
  private _logger: Logger;
  private _startCounter = 0;

  public constructor(options: BrowserProcessOptions) {
    super();
    this._options = {
      ...options,
      logger: options.logger ?? nullLogger,
      args: [
        ...(options.overrideArgs ?? [`--remote-debugging-port=${options.debuggingPort}`, ...DefaultChromeFlags]),
        ...(options.additionalArgs ?? []),
        'about:blank', // Initial URL
      ],
      autoRestart: options.autoRestart ?? true,
      autoRestartDelayMillis: options.autoRestartDelayMillis ?? 0,
      retryStartup: options.retryStartup ?? true,
      retryStartupDelayMillis: options.retryStartupDelayMillis ?? 0,
    };
    this._logger = this._options.logger;
  }

  public get browserInfo(): Readonly<BrowserInfo> | null {
    return this._browserInfo;
  }

  public get pid() {
    return this._process?.pid;
  }

  public get status() {
    return this._status;
  }

  public get stopReason() {
    return this._stopReason;
  }

  public get client() {
    return this._client;
  }

  public get port() {
    return this._options.debuggingPort;
  }

  public get startCount() {
    return this._startCounter;
  }

  /**
   * Start the process.
   *
   * Can only be called when the state is 'initial' or 'stopped'.
   */
  public async start() {
    await this.startImpl({ reason: BrowserProcessStartReason.Requested });
  }

  public async startImpl(args: { reason: BrowserProcessStartReason }) {
    if (this._status === BrowserProcessStatus.Running) {
      return;
    }
    if (this._status !== BrowserProcessStatus.Initial && this._status !== BrowserProcessStatus.Stopped) {
      throw new LogicError(`Invalid status: ${this._status}.`);
    }

    this._status = BrowserProcessStatus.Starting;
    this._stopReason = null;
    this._restartTimeout.clear();
    const version = ++this._version;
    this._startCounter++;
    this._logger.trace(`Browser process on port ${this._options.debuggingPort} starting.`);
    this.emit('starting', { reason: args.reason });

    // Cancel, if there is another start in progress. This can happen
    // when the process is stopped and again started before the previous
    // startup has completed. We cannot rely on check the status because
    // of the ABA problem.
    const cancelToken = CancelToken.when(() => this._version !== version);

    if (cancelToken.isCanceled()) {
      return;
    }

    const chromePath = findChromePath();

    let process: ChildProcess;
    try {
      process = spawn(chromePath, this._options.args);
      this._process = process;
    } catch (e: Throwable) {
      // TODO: log
      // TODO: stop restarting after number of tries.
      this.onFaulted({ cause: e });
      return;
    }

    // Restart on unexpected process exit.
    process.once('close', code => {
      if (!cancelToken.isCanceled()) {
        this.onFaulted({ exitCode: code ?? undefined });
      }
    });

    // Query chrome CDP version.
    const { value: cdpVersion, error: cdpError } = await asResult(this.queryCdpVersionAfterSpawn(cancelToken));
    if (cancelToken.isCanceled()) {
      return;
    }
    if (!cdpVersion) {
      this.onFaulted({ cause: cdpError });
      return;
    }
    this._browserInfo = {
      defaultUserAgent: cdpVersion['User-Agent'],
      webSocketDebuggerUrl: cdpVersion.webSocketDebuggerUrl,
      chromeVersion: cdpVersion.Browser,
    };

    this.emit('__test__:cdp-client-creation:before' as any, undefined);

    // Create CDP client to browser.
    const { value: client, error: clientError } = await asResult(
      createCdpClient({
        target: cdpVersion.webSocketDebuggerUrl,
      })
    );
    if (cancelToken.isCanceled()) {
      return;
    }
    if (clientError) {
      this.onFaulted({ cause: clientError });
      return;
    }
    this._client = client;

    // Restart on client disconnect.
    this._client!.on('disconnect', () => {
      if (!cancelToken.isCanceled()) {
        this.onFaulted({ cause: new Error('CDP client unexpectedly disconnected.') });
      }
    });

    this._status = BrowserProcessStatus.Running;
    this._logger.trace(`Browser process on port ${this._options.debuggingPort} started (pid ${this._process.pid}).`);
    this.emit('start', { reason: args.reason });
  }

  private async onFaulted(faultedArgs: ProcessFaultedArgs) {
    const { cause, exitCode } = faultedArgs;

    this._logger.trace(`Browser process on port ${this._options.debuggingPort} faulted (exit code ${exitCode}).`);
    const wasStarting = this._status === BrowserProcessStatus.Starting;

    let version = this._version;
    this._status = BrowserProcessStatus.Faulted;
    this.emit('fault', { cause, exitCode });

    // Method stop may have been called in 'faulted' event handler.
    if (this._version !== version) {
      return;
    }

    version = await this.stopImpl({ reason: BrowserProcessStopReason.Faulted });

    // Process may have been manually started in the 'stopped' event handler.
    if (this._version !== version) {
      this.emit('__test__:auto-restart-aborted' as any, undefined);
      return;
    }

    const shouldRestart = wasStarting ? this._options.retryStartup : this._options.autoRestart;
    if (!shouldRestart) {
      return;
    }

    const timeoutMillis = wasStarting ? this._options.retryStartupDelayMillis : this._options.autoRestartDelayMillis;
    if (timeoutMillis > 0) {
      this._restartTimeout.clear();
      this._restartTimeout = Timeout.sleep(timeoutMillis);
      this.emit('__test__:auto-restart-scheduled' as any, undefined);
      if (!(await this._restartTimeout.promise)) {
        this.emit('__test__:auto-restart-aborted' as any, undefined);
        return;
      }
    }
    await this.startImpl({ reason: BrowserProcessStartReason.AutoRestart });
  }

  /**
   * Stop the process releasing all associated resources.
   *
   * Can be called anytime from anywhere. If the process is
   * currently starting, the start will be aborted. If the
   * process is stopping, it will wait until it is stopped.
   */
  public async stop() {
    await this.stopImpl({ reason: BrowserProcessStopReason.Requested });
  }

  private async stopImpl(args: { reason: BrowserProcessStopReason }) {
    const { promise, first } = this._stopReentrancyGuard.run(async () => {
      if (this._status === BrowserProcessStatus.Stopped) {
        return this._version;
      }
      this._status = BrowserProcessStatus.Stopping;
      this._stopReason = args.reason;
      this.emit('stopping', { reason: args.reason });

      const process = this._process;
      const client = this._client;
      const version = ++this._version;
      this._process = null;
      this._client = null;
      this._browserInfo = null;
      this._restartTimeout.clear();

      // Remove event listeners first to prevent any triggers
      // during async cleanup.
      process?.removeAllListeners();

      // Close client.
      if (client !== null) {
        try {
          await client.close();
          client.removeAllListeners();
        } catch {
          // TODO: log
        }
      }

      // Kill process.
      if (process) {
        await this.killProcess(process);
      }

      this._status = BrowserProcessStatus.Stopped;
      this._stopReentrancyGuard.unlock();
      this._logger.trace(`Browser process on port ${this._options.debuggingPort} stopped.`);

      return version;
    });

    const version = await promise;

    if (first) {
      this.emit('stop', { reason: args.reason });
    }

    return version;
  }

  private async killProcess(process: ChildProcess) {
    if (process.exitCode !== null) {
      return;
    }
    await Defer.asyncScope(async defer => {
      const killed = new EventPromiseSource(process, 'close' as any);
      defer.add(() => killed.close());
      try {
        if (!process.kill('SIGINT')) {
          // TODO: log.
          return;
        }
      } catch {
        return;
      }
      if (await willCompleteInTime(killed.promise, 5000)) {
        return;
      }

      // Kill as last resort.
      try {
        process.kill('SIGKILL');
      } catch {
        // Nothing to do.
      }
    });
  }

  private async queryCdpVersionAfterSpawn(cancelToken: CancelToken) {
    // The process may take some time to start up.
    const delays = [100, 200, 500, 1000, 2000, 5000];
    for (let i = 0; i < delays.length; i++) {
      await sleepMs(delays[i]);
      if (cancelToken.isCanceled()) {
        return null;
      }
      try {
        this.emit('__test__:cdp-verison-query:before' as any, undefined);
        const cdpVersion = await CDP.Version({
          port: this._options.debuggingPort,
        });
        if (cancelToken.isCanceled()) {
          return null;
        }
        return cdpVersion;
      } catch (e) {
        if (cancelToken.isCanceled()) {
          return null;
        }
        const isLastIteration = i === delays.length - 1;
        if (isLastIteration) {
          throw e; // TODO: throw custom exception
        }
      }
    }
    throw new Error('Never reached.');
  }
}

export declare interface BrowserProcess {
  on<T extends keyof BrowserProcessEvents>(eventName: T, listener: (eventData: BrowserProcessEvents[T]) => void): this;
  once<T extends keyof BrowserProcessEvents>(
    eventName: T,
    listener: (eventData: BrowserProcessEvents[T]) => void
  ): this;
  emit<T extends keyof BrowserProcessEvents>(eventName: T, eventData: BrowserProcessEvents[T]): boolean;
}

export enum BrowserProcessStatus {
  Initial = 'initial',
  Starting = 'starting',
  Running = 'running',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Faulted = 'faulted',
}

export enum BrowserProcessStopReason {
  Requested = 'requested',
  Faulted = 'faulted',
}

export enum BrowserProcessStartReason {
  Requested = 'requested',
  AutoRestart = 'auto_restart',
}

export interface BrowserProcessOptions {
  logger?: Logger;
  chromePath?: string;
  overrideArgs?: readonly string[];
  additionalArgs?: readonly string[];
  debuggingPort: number;
  autoRestart?: boolean;
  autoRestartDelayMillis?: number;
  retryStartup?: boolean;
  retryStartupDelayMillis?: number;
}

interface BrowserProcessOptionsInternal {
  logger: Logger;
  chromePath?: string;
  args: readonly string[];
  debuggingPort: number;
  autoRestart: boolean;
  autoRestartDelayMillis: number;
  retryStartup: boolean;
  retryStartupDelayMillis: number;
}

export interface BrowserInfo {
  defaultUserAgent: string;
  webSocketDebuggerUrl: string;
  chromeVersion: string;
}

export interface BrowserProcessEventStarting {
  reason: BrowserProcessStartReason;
}

export interface BrowserProcessEventRunning {
  reason: BrowserProcessStartReason;
}

export interface BrowserProcessEventStopping {
  reason: BrowserProcessStopReason;
}

export interface BrowserProcessEventStopped {
  reason: BrowserProcessStopReason;
}

export type BrowserProcessEvents = {
  starting: BrowserProcessEventStarting;
  start: BrowserProcessEventRunning;
  fault: { cause?: Throwable; exitCode?: number };
  stopping: BrowserProcessEventStopping;
  stop: BrowserProcessEventStopped;
};

export function findChromePath() {
  const platform = os.platform();
  if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  if (platform === 'linux') {
    return '/usr/bin/google-chrome';
  }
  if (platform === 'win32') {
    return `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`;
  }
  throw new Error(`Unable to auto-detect chrome executable for platform ${platform}.`);
}

export const DefaultChromeFlags: readonly string[] = [
  '--headless',
  '--mute-audio',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-default-browser-check',
  '--no-first-run',
  '--metrics-recording-only',
  '--password-store=basic',
  '--use-mock-keychain',
  '--disable-features=' + ['Translate', 'OptimizationHints', 'MediaRouter', 'InterestFeedContentSuggestions'].join(','),
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-client-side-phishing-detection',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-ipc-flooding-protection',
];

interface ProcessFaultedArgs {
  cause?: Throwable;
  exitCode?: number;
}
