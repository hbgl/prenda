import { EventEmitter } from 'node:events';
import { PromiseSource } from '../../support/promise.js';

export function eventCount<T extends EventEmitter>(
  eventEmitter: T,
  eventName: Parameters<T['on']>[0],
  filter?: (...args: any[]) => boolean
) {
  let count = 0;
  eventEmitter.on(eventName, (...args: any[]) => {
    if (filter === undefined || filter(...args)) {
      count++;
    }
  });
  return () => count;
}

export function mapEvent<T extends EventEmitter, U>(
  eventEmitter: T,
  eventName: Parameters<T['on']>[0],
  callback: (...args: any[]) => U | Promise<U>
) {
  const source = new PromiseSource<U>();
  eventEmitter.on(eventName, async (...args: any[]) => {
    const promise = callback(...args);
    try {
      const result = await promise;
      source.resolve(result);
    } catch (e) {
      source.reject(e);
    }
  });
  return source.promise;
}

export type EventRecorderEntry<T extends object> = {
  [K in keyof T]-?: { name: K; data: T[K] };
}[keyof T];

export class EventRecorder<T extends Record<string | symbol, unknown> = Record<string | symbol, unknown>> {
  private _events: EventRecorderEntry<T>[] = [];
  private _eventNames: (keyof T)[] = [];
  private _eventEmitter: EventEmitter;
  private _listeners: { name: keyof T; listener: (...args: any[]) => any }[] = [];

  public constructor(eventEmitter: EventEmitter, keys: (keyof T)[]) {
    this._eventEmitter = eventEmitter;

    for (const key of keys) {
      const listener = (...args: any[]) => {
        this._events.push({ name: key, data: args.length <= 1 ? args[0] : args });
        this._eventNames.push(key);
      };
      this._listeners.push({ name: key, listener });
      this._eventEmitter.on(key as string | symbol, listener);
    }
  }

  public stop() {
    for (const entry of this._listeners) {
      this._eventEmitter.off(entry.name as string | symbol, entry.listener);
    }
    this._listeners = [];
    return this.events;
  }

  public get events(): Readonly<typeof this._events> {
    return this._events;
  }

  public get eventNames(): Readonly<typeof this._eventNames> {
    return this._eventNames;
  }
}
