import { CancelToken, EventPromiseSource, ReentrancyGuard } from '../../support/promise.js';
import { sleepMs } from '../../support/sleep.js';
import { LogicError } from '../../support/errors/common.js';
import defaults from '../../defaults.js';
import { BrowserInstance, BrowserInstanceRole } from '../instance.js';
import { BrowserProcess, BrowserProcessStatus } from '../process.js';
import { BrowserHandle } from '../handle.js';
import { Logger, nullLogger } from '../../support/logging.js';
import { BrowserProvider, BrowserProviderStatus } from '../providers/provider.js';
import { Timeout } from '../../support/timeout.js';
import { EventEmitter } from 'node:events';

/**
 * Starts and watches a main and standby browser process. The main process will
 * actively receive requests while the standby process is there to take over on
 * crash or recycling. Recycling is the process of precautiously restarting the
 * main process, e.g. for the purpose of combating memory/resource leaks.
 * The correct behavior of the supervisor can only be guaranteed if the processes
 * are not manipulated by outside code through the {@link BrowserProcess} API.
 */
export class BrowserSupervisor extends EventEmitter implements BrowserProvider {
  private _options: Readonly<BrowserSupervisorOptionsInternal>;
  private _instances: [BrowserInstance, BrowserInstance];
  private _status = BrowserProviderStatus.Initial;
  private _recycleTimeout = Timeout.cleared();
  private _recycleReentrancyGuard = new ReentrancyGuard<BrowserRecycleResult>();
  private _closeReentrancyGuard = new ReentrancyGuard<void>();
  private _logger: Logger;
  private _scheduleMainRecycleHandler = () => this.scheduleMainRecycle();
  private _considerStandbyPromotionHandler = () => this.considerStandbyPromotion();

  constructor(options: Readonly<BrowserSupervisorOptions>) {
    super();
    this._logger = options.logger ?? nullLogger;

    this._options = {
      ...options,
      debuggingPort1: options.debuggingPort1 ?? defaults.browser.provider.internal.debuggingPort1,
      debuggingPort2: options.debuggingPort2 ?? defaults.browser.provider.internal.debuggingPort2,
      autoRecycle: options.autoRecycle ?? true,
      autoRecycleAfterUptimeMillis:
        options.autoRecycleAfterUptimeMillis ?? defaults.browser.provider.internal.autoRecycleAfterUptimeMillis,
      autoRecycleRetryAfterMillis:
        options.autoRecycleAfterUptimeMillis ?? defaults.browser.provider.internal.autoRecycleRetryAfterMillis,
      recycleDrainMillis: options.recycleDrainMillis ?? defaults.browser.provider.internal.recycleDrainMillis,
    };

    const ports = [this._options.debuggingPort1, this._options.debuggingPort2];
    this._instances = ports.map(port => {
      const process = new BrowserProcess({
        logger: this._logger,
        chromePath: this._options.chromePath,
        overrideArgs: this._options.overrideArgs,
        additionalArgs: this._options.additionalArgs,
        autoRestart: this._options.autoRestartProcesses,
        debuggingPort: port,
      });
      return new BrowserInstance({
        process,
        logger: this._logger,
      });
    }) as [BrowserInstance, BrowserInstance];

    this.main.markAsMain();
    this.standby.markAsStandby();
  }

  public get main() {
    return this._instances[0];
  }

  private set main(value: BrowserInstance) {
    this._instances[0] = value;
  }

  public get standby() {
    return this._instances[1];
  }

  private set standby(value: BrowserInstance) {
    this._instances[1] = value;
  }

  public get status() {
    return this._status;
  }

  public async start() {
    if (this._status === BrowserProviderStatus.Running) {
      return;
    }
    if (this._status !== BrowserProviderStatus.Initial) {
      throw new LogicError(`Invalid status: ${this._status}.`);
    }

    this._status = BrowserProviderStatus.Starting;
    const cancelToken = CancelToken.when(() => this._status !== BrowserProviderStatus.Starting);
    this._logger.trace(`Browser supervisor starting.`);

    await Promise.all(this._instances.map(i => i.start()));

    if (cancelToken.isCanceled()) {
      return;
    }

    if (cancelToken.isCanceled()) {
      return;
    }

    this._status = BrowserProviderStatus.Running;
    this._logger.trace(`Browser supervisor started.`);

    for (const instance of this._instances) {
      instance.on('main_online', this._scheduleMainRecycleHandler);
      instance.process.on('start', this._considerStandbyPromotionHandler);
      instance.process.on('fault', this._considerStandbyPromotionHandler);
    }

    this.scheduleMainRecycle();
  }

  public close() {
    const { promise } = this._closeReentrancyGuard.run(async () => {
      if (this._status === BrowserProviderStatus.Closed) {
        return;
      }

      this._status = BrowserProviderStatus.Closing;
      this._logger.trace(`Browser supervisor stopping.`);
      this._recycleTimeout.clear();

      for (const instance of this._instances) {
        instance.off('main_online', this._scheduleMainRecycleHandler);
        instance.process.off('start', this._considerStandbyPromotionHandler);
        instance.process.off('fault', this._considerStandbyPromotionHandler);
      }

      await Promise.all(this._instances.map(i => i.stop()));
      this._status = BrowserProviderStatus.Closed;
      this._logger.trace('Browser supervisor stopped.');
    });
    return promise;
  }

  public async createHandle() {
    if (this._status !== BrowserProviderStatus.Running) {
      throw new LogicError(`Invalid status: ${this._status}`);
    }
    const instance = this.main;
    if (instance.process.status !== BrowserProcessStatus.Running) {
      return null;
    }
    const handle = new BrowserHandle(instance.process.client!);
    instance.addHandle(handle);
    return handle;
  }

  private scheduleMainRecycle(timeoutMillis?: number) {
    if (this._status !== BrowserProviderStatus.Running) {
      return;
    }
    if (!this._options.autoRecycle) {
      return;
    }
    if (this._recycleReentrancyGuard.active) {
      // Don't schedule a new recycling run when there is an active one already.
      return;
    }

    timeoutMillis =
      timeoutMillis ?? Math.max(this._options.autoRecycleAfterUptimeMillis - this.main.mainUptimeMillis, 0);

    this._recycleTimeout.clear();
    this._recycleTimeout = Timeout.create(async () => {
      const result = await this.recycleMain();
      if (this._status !== BrowserProviderStatus.Running) {
        return;
      }
      switch (result) {
        case BrowserRecycleResult.StandbyUnavailable:
          this.scheduleMainRecycle(this._options.autoRecycleRetryAfterMillis);
          break;
        case BrowserRecycleResult.Canceled:
        case BrowserRecycleResult.Recycled:
          this.scheduleMainRecycle();
          break;
      }
    }, timeoutMillis);
  }

  /**
   * Recycle the main instance by first demoting it to standby and
   * then restarting it. It guarantees that the main is only recycled
   * when a standby is ready to take over. All currently pending requests
   * on the main instance are given a grace period to complete after which
   * they are forcefully terminated.
   */
  public async recycleMain() {
    const { promise, first } = this._recycleReentrancyGuard.run(async () => {
      // Recycles are only allowed on running supervisor.
      if (this._status !== BrowserProviderStatus.Running) {
        throw new LogicError(`Invalid status: ${this._status}`);
      }

      this._logger.trace(`Browser main instance on port ${this.main.process.port} preparing to restart.`);

      if (this.standby.process.status !== BrowserProcessStatus.Running) {
        return BrowserRecycleResult.StandbyUnavailable;
      }

      // Promote standby to main.
      this.promoteStandbyToMain(BrowserSupervisorTakeoverReason.Recycle);

      // Check that supervisor is running. It might have been closed from within a callback.
      if (this._status !== BrowserProviderStatus.Running) {
        return BrowserRecycleResult.Canceled;
      }

      const standby = this.standby;

      // Drain requests.
      if (standby.handles.size > 0) {
        this._logger.trace('Draining instance requests.');
        const idle = new EventPromiseSource(standby, 'idle');
        try {
          await Promise.race([idle.promise, sleepMs(this._options.recycleDrainMillis)]);
        } finally {
          idle.close();
        }
      }

      // Recheck that supervisor is running. It might have been closed while draining.
      if (this._status !== BrowserProviderStatus.Running) {
        return BrowserRecycleResult.Canceled;
      }

      // Check that standby is still standby. It might have been promoted due to main faulting.
      if (standby.role !== BrowserInstanceRole.Standby) {
        return BrowserRecycleResult.StandbyUnavailable;
      }

      // Standby might have faulted while draining.
      if (standby.process.status !== BrowserProcessStatus.Running) {
        return BrowserRecycleResult.Canceled;
      }

      await standby.stop();

      // Recheck that supervisor is running. It might have been closed while stopping the standby.
      if (this._status !== BrowserProviderStatus.Running) {
        return BrowserRecycleResult.Canceled;
      }

      // Check that process is stopped. This should not occur unless outside code is starting/stopping
      // the process, which is generally not allowed.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (standby.process.status !== BrowserProcessStatus.Stopped) {
        return BrowserRecycleResult.Canceled;
      }

      await standby.start();

      return BrowserRecycleResult.Recycled;
    });

    const result = await promise;

    if (first) {
      this.emit('recycle', { result });
    }

    return result;
  }

  private considerStandbyPromotion() {
    if (this.main.process.status === BrowserProcessStatus.Running) {
      // Main is already online.
      return;
    }
    if (this.standby.process.status !== BrowserProcessStatus.Running) {
      // Standby is offline. Promotion would not improve the situation.
      return;
    }
    if (
      this._status === BrowserProviderStatus.Starting &&
      this.main.process.status === BrowserProcessStatus.Starting &&
      this.main.process.startCount === 1
    ) {
      // Main should be given a chance to start up for the first time.
      return;
    }
    this.promoteStandbyToMain(BrowserSupervisorTakeoverReason.Fault);
  }

  private promoteStandbyToMain(reason: BrowserSupervisorTakeoverReason) {
    this._logger.trace(`Promiting standby to main.`);
    const temp = this.main;
    this.main = this.standby;
    this.standby = temp;
    this.main.markAsMain();
    this.standby.markAsStandby();
    this.main.emit('main', undefined);
    this.standby.emit('standby', undefined);
    this.emit('takeover', { reason });
  }
}

export enum BrowserSupervisorTakeoverReason {
  Recycle,
  Fault,
}

export type BrowserSupervisorEvents = {
  takeover: BrowserSupervisorTakeoverEvent;
  recycle: BrowserSupervisorRecycleEvent;
};

export interface BrowserSupervisorTakeoverEvent {
  reason: BrowserSupervisorTakeoverReason;
}

export interface BrowserSupervisorRecycleEvent {
  result: BrowserRecycleResult;
}

export declare interface BrowserSupervisor {
  on<T extends keyof BrowserSupervisorEvents>(
    eventName: T,
    listener: (eventData: BrowserSupervisorEvents[T]) => void
  ): this;
  once<T extends keyof BrowserSupervisorEvents>(
    eventName: T,
    listener: (eventData: BrowserSupervisorEvents[T]) => void
  ): this;
  emit<T extends keyof BrowserSupervisorEvents>(eventName: T, eventData: BrowserSupervisorEvents[T]): boolean;
}

export interface BrowserSupervisorOptions {
  logger?: Logger;
  chromePath?: string;
  overrideArgs?: readonly string[];
  additionalArgs?: readonly string[];
  debuggingPort1?: number;
  debuggingPort2?: number;
  autoRecycle?: boolean;
  autoRecycleAfterUptimeMillis?: number;
  autoRecycleRetryAfterMillis?: number;
  recycleDrainMillis?: number;
  autoRestartProcesses?: boolean;
}

export interface BrowserSupervisorOptionsInternal extends BrowserSupervisorOptions {
  debuggingPort1: number;
  debuggingPort2: number;
  autoRecycle: boolean;
  autoRecycleAfterUptimeMillis: number;
  autoRecycleRetryAfterMillis: number;
  recycleDrainMillis: number;
}

export enum BrowserRecycleResult {
  Recycled = 'recycled',
  Canceled = 'canceled',
  StandbyUnavailable = 'standby_unavailable',
}
