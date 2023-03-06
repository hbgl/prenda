import { EventEmitter } from 'node:events';
import { CdpClient } from '../support/cdp.js';

/**
 * A handle to a {@link CdpClient}. Call {@link BrowserHandle.close|close} when no longer needed.
 * Will also be automatically closed when the underlying {@link CdpClient}
 * is disconnected or closed.
 */
export class BrowserHandle extends EventEmitter {
  private _client: CdpClient;
  private _closed = false;
  private _disconnectOrCloseHandler = () => this.onDisconnectOrClose();

  public constructor(client: CdpClient) {
    super();
    this._client = client;
    client.once('disconnect', this._disconnectOrCloseHandler);
    client.once('close', this._disconnectOrCloseHandler);
  }

  public get client() {
    return this._client;
  }

  public get closed() {
    return this._closed;
  }

  public close() {
    this._client.off('disconnect', this._disconnectOrCloseHandler);
    this._client.off('close', this._disconnectOrCloseHandler);
    this.emit('close', undefined);
    this._closed = true;
    this.removeAllListeners();
  }

  private onDisconnectOrClose() {
    // Auto-close when the client disconnects.
    this.close();
  }
}

export declare interface BrowserHandle {
  on<T extends keyof BrowserHandleEvents>(eventName: T, listener: (eventData: BrowserHandleEvents[T]) => void): this;
  once<T extends keyof BrowserHandleEvents>(eventName: T, listener: (eventData: BrowserHandleEvents[T]) => void): this;
  emit<T extends keyof BrowserHandleEvents>(eventName: T, eventData: BrowserHandleEvents[T]): boolean;
}

export type BrowserHandleEvents = {
  close: undefined;
};
