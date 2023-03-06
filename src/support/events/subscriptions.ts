import { EventEmitter } from 'node:events';

export class Subscription {
  private _eventEmitter: EventEmitter | null;
  private _eventName: string | symbol | null;
  private _handler: ((...args: any[]) => any) | null;

  public constructor(eventEmitter: EventEmitter, eventName: string | symbol, handler: (...args: any[]) => any) {
    this._eventEmitter = eventEmitter;
    this._eventName = eventName;
    this._handler = handler;
  }

  public unsubscribe() {
    if (this._eventEmitter === null) {
      return;
    }
    this._eventEmitter.off(this._eventName!, this._handler!);
    // Don't keep references alive.
    this._eventEmitter = null;
    this._eventName = null;
    this._handler = null;
  }
}

export function subscribe<T extends EventEmitter>(
  eventEmitter: T,
  eventName: Parameters<T['on']>[0],
  handler: Parameters<T['on']>[1]
) {
  eventEmitter.on(eventName, handler);
  return new Subscription(eventEmitter, eventName, handler);
}
