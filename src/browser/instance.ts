import { BrowserProcess, BrowserProcessStatus } from './process.js';
import { BrowserHandle } from './handle.js';
import { Logger } from '../support/logging.js';
import { Stopwatch } from '../support/stopwatch.js';
import { EventEmitter } from 'node:events';

export enum BrowserInstanceRole {
  Main = 'main',
  Standby = 'standby',
}

export type BrowserInstanceEvents = {
  start: undefined;
  stop: undefined;
  idle: undefined;
  main: undefined;
  standby: undefined;
  main_online: undefined;
  main_offline: undefined;
};

export declare interface BrowserInstance {
  on<T extends keyof BrowserInstanceEvents>(
    eventName: T,
    listener: (eventData: BrowserInstanceEvents[T]) => void
  ): this;
  once<T extends keyof BrowserInstanceEvents>(
    eventName: T,
    listener: (eventData: BrowserInstanceEvents[T]) => void
  ): this;
  emit<T extends keyof BrowserInstanceEvents>(eventName: T, eventData: BrowserInstanceEvents[T]): boolean;
}

export interface BrowserInstanceOptions {
  process: BrowserProcess;
  logger: Logger;
}

export class BrowserInstance extends EventEmitter {
  private _process: BrowserProcess;
  private _handles: Set<BrowserHandle>;
  private _role: BrowserInstanceRole | undefined;
  private _logger: Logger;
  private _mainUptimeStopwatch = new Stopwatch();

  constructor(options: BrowserInstanceOptions) {
    super();
    this._process = options.process;
    this._logger = options.logger;
    this._handles = new Set();

    this.on('main', () => this.invalidateMainUptime());
    this.on('standby', () => this.invalidateMainUptime());
    this.process.on('start', () => this.invalidateMainUptime());
    this.process.on('stop', () => this.invalidateMainUptime());
    this.process.on('fault', () => this.invalidateMainUptime());
  }

  public get process() {
    return this._process;
  }

  public get client() {
    return this._process.client;
  }

  public get role() {
    return this._role;
  }

  public get handles(): ReadonlySet<BrowserHandle> {
    return this._handles;
  }

  public get mainUptimeMillis() {
    return this._mainUptimeStopwatch.elapsedMillis;
  }

  public get handleCount() {
    return this.handles.size;
  }

  public markAsMain() {
    if (this._role === BrowserInstanceRole.Main) {
      return;
    }
    this._role = BrowserInstanceRole.Main;
    if (this._process.status !== BrowserProcessStatus.Initial) {
      this._logger.debug(`Browser instance on port ${this.process.port} is now main.`);
    }
  }

  public markAsStandby() {
    if (this._role === BrowserInstanceRole.Standby) {
      return;
    }
    this._role = BrowserInstanceRole.Standby;
    if (this._process.status !== BrowserProcessStatus.Initial) {
      this._logger.debug(`Browser instance on port ${this.process.port} is now standby.`);
    }
  }

  public async start() {
    await this._process.start();
    this.emit('start', undefined);
    this._logger.trace(`Browser ${this.role} instance on port ${this.process.port} started.`);
  }

  public async stop() {
    await this._process.stop();
    this.emit('stop', undefined);
    this._logger.trace(`Browser ${this.role} instance on port ${this.process.port} stopped.`);
  }

  private invalidateMainUptime() {
    const wasOnline = this._mainUptimeStopwatch.running;
    if (this._process.status !== BrowserProcessStatus.Running) {
      this._mainUptimeStopwatch.stop();
    } else if (this._role === BrowserInstanceRole.Main) {
      this._mainUptimeStopwatch.start();
    } else if (this._role === BrowserInstanceRole.Standby) {
      this._mainUptimeStopwatch.pause();
    }
    const inOnline = this._mainUptimeStopwatch.running;
    if (!wasOnline && inOnline) {
      this.emit('main_online', undefined);
    } else if (wasOnline && !inOnline) {
      this.emit('main_offline', undefined);
    }
  }

  public addHandle(handle: BrowserHandle) {
    this._handles.add(handle);
    handle.once('close', () => {
      this.removeHandle(handle);
    });
  }

  public removeHandle(handle: BrowserHandle) {
    if (this._handles.delete(handle)) {
      if (this.handles.size === 0) {
        this.emit('idle', undefined);
      }
    }
  }
}
