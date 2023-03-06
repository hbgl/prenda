import { PromiseSource } from './promise.js';

/** @internal */
export class Timeout {
  private _cleared = false;
  private _handle: ReturnType<typeof setTimeout> | undefined = undefined;
  private _promiseSource = new PromiseSource<boolean>();
  private static _clearedInstance = Timeout.createClearedInstance();

  public get promise() {
    return this._promiseSource.promise;
  }

  public static cleared() {
    return Timeout._clearedInstance;
  }

  public get isActive() {
    return this._handle !== undefined;
  }

  public get isCleared() {
    return this._cleared;
  }

  public static sleep(ms: number) {
    return Timeout.create(() => {
      // Just sleep.
    }, ms);
  }

  public static create(callback: () => void, ms?: number | undefined) {
    const instance = new Timeout();
    instance._handle = setTimeout(() => {
      instance._handle = undefined;
      instance._promiseSource.resolve(true);
      callback();
    }, ms);
    return instance;
  }

  private static createClearedInstance() {
    const instance = new Timeout();
    instance._cleared = true;
    return instance;
  }

  public clear() {
    if (this._cleared || this._handle === undefined) {
      return;
    }
    clearTimeout(this._handle);
    this._cleared = true;
    this._handle = undefined;
    this._promiseSource.resolve(false);
  }
}
