import { BrowserHandle } from '../../browser/handle.js';
import CDP from 'chrome-remote-interface';
import defaults from '../../defaults.js';
import { EventEmitter } from 'node:events';
import { Backoff, BackoffFactory, FlatBackoff } from '../../support/backoff.js';
import { CdpClient, createCdpClient } from '../../support/cdp.js';
import { LogicError } from '../../support/errors/common.js';
import { Logger, nullLogger } from '../../support/logging.js';
import { asResult, ReentrancyGuard } from '../../support/promise.js';
import { Timeout } from '../../support/timeout.js';
import { Throwable } from '../../support/types/utilities.js';
import { MarkRequired } from 'ts-essentials';
import { BrowserProvider, BrowserProviderStatus } from './provider.js';

export class ExternalBrowserProvider extends EventEmitter implements BrowserProvider {
  private _options: Readonly<InternalOptions>;
  private _status: BrowserProviderStatus = BrowserProviderStatus.Initial;
  private _browserClient: CdpClient | null = null;
  private _logger: Logger;
  private _reconnectTimeout = Timeout.cleared();
  private _reconnectBackoff: Backoff;
  private _handles = new Set<BrowserHandle>();
  private _closeReentranceGuard = new ReentrancyGuard<void>();

  public constructor(options: Readonly<ExternalBrowserProviderOptions>) {
    super();
    this._options = {
      ...options,
      logger: options.logger ?? nullLogger,
      reconnectBackoffFactory:
        options.reconnectBackoffFactory ??
        (() => new FlatBackoff(defaults.browser.externalProviderReconnectIntervalMillis)),
    };
    this._logger = this._options.logger;
    this._reconnectBackoff = this._options.reconnectBackoffFactory();
  }

  get status(): BrowserProviderStatus {
    return this._status;
  }

  public get handles(): ReadonlySet<BrowserHandle> {
    return this._handles;
  }

  public async createHandle() {
    if (this._browserClient === null) {
      return null;
    }
    const handle = new BrowserHandle(this._browserClient);
    this._handles.add(handle);
    handle.on('close', () => {
      this._handles.delete(handle);
    });
    return handle;
  }

  async start() {
    if (this._status === BrowserProviderStatus.Running) {
      return;
    }
    if (this._status !== BrowserProviderStatus.Initial) {
      throw new LogicError(`Cannot start external browser provider: invalid status '${this._status}'.`);
    }

    this._status = BrowserProviderStatus.Starting;
    this._logger.trace('Starting external browser provider.');
    this.emit('starting', undefined);

    // Check that we are still starting. Might have been closed by a callback.
    if (this._status !== BrowserProviderStatus.Starting) {
      return;
    }

    await this.connect(ExternalBrowserConnectReason.Startup);

    // Recheck that we are still starting. Might have been closed while connecting.
    if (this._status !== BrowserProviderStatus.Starting) {
      return;
    }

    this._status = BrowserProviderStatus.Running;
    this._logger.trace('External browser provider started.');

    this.emit('start', undefined);
  }

  private scheduleReconnect() {
    const millis = this._reconnectBackoff.nextTry();
    this._logger.trace(`Reconnecting in ${millis}ms to external browser.`);
    this._reconnectTimeout.clear();
    this._reconnectTimeout = Timeout.create(async () => {
      await this.connect(ExternalBrowserConnectReason.Reconnect);
    }, millis);
  }

  private async connect(reason: ExternalBrowserConnectReason): Promise<void> {
    // Remember current status.
    const status = this._status;

    const {
      value: client,
      error,
      hasError,
    } = await asResult(
      (async () => {
        const target = await this.getTarget();
        const client = await createCdpClient({ target });
        return client;
      })()
    );

    // Check that the status didn't change. The provider might have been closed while connecting.
    if (this._status !== status) {
      if (client) {
        await this.closeClient(client);
      }
      return;
    }

    if (hasError) {
      this._logger.error(`Failed to connect to external browser: ${(error as Throwable).message}`);
      this.emit('fault', { type: ExternalBrowserFaultType.Connect, cause: error });
      // Check that the status didn't change. The provider might have been closed in a callback.
      if (this._status !== status) {
        return;
      }
      this.scheduleReconnect();
      return;
    }

    this._logger.error(`Connected to external browser.`);
    this._reconnectBackoff.reset();
    this._browserClient = client;
    this._browserClient.on('disconnect', () => this.onDisconnect());
    this.emit('connect', { reason });
  }

  private async getTarget() {
    if ((this._options as ExternalBrowserProviderUrlOptions).debuggerUrl !== undefined) {
      return (this._options as ExternalBrowserProviderUrlOptions).debuggerUrl;
    }
    const options = this._options as ExternalBrowserProviderHostPortOptions;
    const version = await CDP.Version({
      host: options.host,
      port: options.port,
      secure: options.secure,
    });
    return version.webSocketDebuggerUrl;
  }

  private async onDisconnect() {
    this._logger.warn(`Unexpectedly disconnected from external browser.`);
    this.emit('disconnect', undefined);

    // Check that the provider is running. It might have been closed by a callback.
    if (this._status !== BrowserProviderStatus.Running) {
      return;
    }

    if (this._browserClient !== null) {
      const client = this._browserClient;
      this._browserClient = null;
      await this.closeClient(client);
    }

    // Check that the provider is running. It might have been closed while closing the client.
    if (this._status !== BrowserProviderStatus.Running) {
      return;
    }

    this.scheduleReconnect();
  }

  async close() {
    const { promise, first } = this._closeReentranceGuard.run(async () => {
      if (this._status === BrowserProviderStatus.Closed) {
        return;
      }
      this._status = BrowserProviderStatus.Closing;
      this._logger.trace(`Stopping external browser provider.`);
      this.emit('closing', undefined);

      this._reconnectTimeout.clear();

      if (this._browserClient !== null) {
        const client = this._browserClient;
        this._browserClient = null;
        await this.closeClient(client);
      }

      this._status = BrowserProviderStatus.Closed;
      this._logger.trace(`Stopped external browser provider.`);
    });

    await promise;

    if (first) {
      this.emit('close', undefined);
    }
  }

  private async closeClient(client: CdpClient) {
    try {
      await client.close();
      client.removeAllListeners();
    } catch (e: Throwable) {
      this._logger.error(`Unable to close CDP client (potential leak): ${e.message}`);
    }
  }
}

export type ExternalBrowserProviderEvents = {
  starting: undefined;
  start: undefined;
  connect: ExternalBrowserConnectEvent;
  disconnect: undefined;
  closing: undefined;
  close: undefined;
  fault: ExternalBrowserFaultEvent;
};

export declare interface ExternalBrowserProvider {
  on<T extends keyof ExternalBrowserProviderEvents>(
    eventName: T,
    listener: (eventData: ExternalBrowserProviderEvents[T]) => void
  ): this;
  once<T extends keyof ExternalBrowserProviderEvents>(
    eventName: T,
    listener: (eventData: ExternalBrowserProviderEvents[T]) => void
  ): this;
  emit<T extends keyof ExternalBrowserProviderEvents>(
    eventName: T,
    eventData: ExternalBrowserProviderEvents[T]
  ): boolean;
}

export type ExternalBrowserProviderBaseOptions = {
  logger?: Logger;
  reconnectBackoffFactory?: BackoffFactory;
};

export type ExternalBrowserProviderUrlOptions = ExternalBrowserProviderBaseOptions & {
  debuggerUrl: string;
};

export type ExternalBrowserProviderHostPortOptions = ExternalBrowserProviderBaseOptions & {
  host: string;
  port: number;
  secure?: boolean;
};

export type ExternalBrowserProviderOptions = ExternalBrowserProviderUrlOptions | ExternalBrowserProviderHostPortOptions;

type InternalOptions = MarkRequired<ExternalBrowserProviderOptions, 'logger' | 'reconnectBackoffFactory'>;

export enum ExternalBrowserConnectReason {
  Startup = 'startup',
  Reconnect = 'reconnect',
}

export interface ExternalBrowserConnectEvent {
  reason: ExternalBrowserConnectReason;
}

export interface ExternalBrowserFaultEvent {
  type: ExternalBrowserFaultType;
  cause: Throwable;
}

export enum ExternalBrowserFaultType {
  Connect = 'Connect',
}
