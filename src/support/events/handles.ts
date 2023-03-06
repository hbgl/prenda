import { EventEmitter } from 'stream';

export interface EventListenerEntry {
  eventEmitter: EventEmitter;
  eventName: string | symbol;
  listener: (...args: any[]) => void;
}

export class EventHandles {
  private _entries: (EventListenerEntry | null)[] = [];

  public on(eventEmitter: EventEmitter, eventName: string | symbol, listener: (...args: any[]) => void) {
    eventEmitter.on(eventName, listener);
    this._entries.push({
      eventEmitter,
      eventName,
      listener,
    });
  }

  public once(eventEmitter: EventEmitter, eventName: string | symbol, listener: (...args: any[]) => void) {
    const index = this._entries.length;
    const callback = (...args: any[]) => {
      listener(...args);
      this._entries[index] = null;
    };
    eventEmitter.on(eventName, callback);
    this._entries.push({
      eventEmitter,
      eventName,
      listener: callback,
    });
  }

  public close() {
    for (const entry of this._entries) {
      if (entry === null) {
        continue;
      }
      entry.eventEmitter.removeListener(entry.eventName, entry.listener);
    }
  }
}
