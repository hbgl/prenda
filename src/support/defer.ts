type DeferCallback = (() => void) | (() => Promise<unknown>);

export class Defer {
  private _callbacks: (DeferCallback | null)[] = [];

  public add(callback: DeferCallback) {
    this._callbacks.push(callback);
  }

  public clear() {
    this._callbacks = [];
  }

  public unset(indexOrCallback: DeferCallback | number) {
    if (typeof indexOrCallback === 'number') {
      this._callbacks[indexOrCallback] = null;
    } else {
      const index = this._callbacks.indexOf(indexOrCallback);
      if (index >= 0) {
        this._callbacks[index] = null;
      }
    }
  }

  public run() {
    // Run in reverse order.
    const promises = new Array(this._callbacks.length);
    for (let i = this._callbacks.length - 1; i >= 0; i--) {
      const callback = this._callbacks[i];
      if (callback) {
        promises[i] = callback();
      }
    }
    return Promise.all(promises);
  }

  public static scope<T>(callback: (defer: Defer) => T) {
    const defer = new Defer();
    try {
      return callback(defer);
    } finally {
      defer.run();
    }
  }

  public static async asyncScope<T>(callback: (defer: Defer) => Promise<T>) {
    const defer = new Defer();
    try {
      return await callback(defer);
    } finally {
      defer.run();
    }
  }
}
