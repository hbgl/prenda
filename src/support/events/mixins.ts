import { EventEmitter } from 'node:events';
import { AbstractConstructor, Constructor } from '../../support/object.js';

export function eventEmitterMixin<TBase extends Constructor | AbstractConstructor>(BaseClass: TBase) {
  return class extends BaseClass implements EventEmitter {
    protected eventEmitter: EventEmitter = new EventEmitter();

    addListener(eventName: string | symbol, listener: (...args: any[]) => void) {
      this.eventEmitter.addListener(eventName, listener);
      return this;
    }
    on(eventName: string | symbol, listener: (...args: any[]) => void) {
      this.eventEmitter.on(eventName, listener);
      return this;
    }
    once(eventName: string | symbol, listener: (...args: any[]) => void) {
      this.eventEmitter.once(eventName, listener);
      return this;
    }
    removeListener(eventName: string | symbol, listener: (...args: any[]) => void) {
      this.eventEmitter.removeListener(eventName, listener);
      return this;
    }
    off(eventName: string | symbol, listener: (...args: any[]) => void) {
      this.eventEmitter.off(eventName, listener);
      return this;
    }
    removeAllListeners(event?: string | symbol) {
      this.eventEmitter.removeAllListeners(event);
      return this;
    }
    setMaxListeners(n: number) {
      this.eventEmitter.setMaxListeners(n);
      return this;
    }
    getMaxListeners() {
      return this.eventEmitter.getMaxListeners();
    }
    listeners(eventName: string | symbol) {
      return this.eventEmitter.listeners(eventName);
    }
    rawListeners(eventName: string | symbol) {
      return this.eventEmitter.rawListeners(eventName);
    }
    emit(eventName: string | symbol, ...args: any[]) {
      return this.eventEmitter.emit(eventName, ...args);
    }
    listenerCount(eventName: string | symbol) {
      return this.eventEmitter.listenerCount(eventName);
    }
    prependListener(eventName: string | symbol, listener: (...args: any[]) => void) {
      this.eventEmitter.prependListener(eventName, listener);
      return this;
    }
    prependOnceListener(eventName: string | symbol, listener: (...args: any[]) => void) {
      this.eventEmitter.prependOnceListener(eventName, listener);
      return this;
    }
    eventNames() {
      return this.eventEmitter.eventNames();
    }
  };
}
