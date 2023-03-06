import { EventEmitter } from 'node:events';
import { TimeoutError } from '../support/errors/timeout.js';
import { Throwable } from './types/utilities.js';

export function makePromiseSource<T>(): [Promise<T>, (value: T | PromiseLike<T>) => void, (reason?: any) => void] {
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return [promise, resolve!, reject!];
}

export function raceWithKey<T extends Readonly<Record<string | number, unknown>>>(values: T) {
  type RetKey = `${Extract<keyof T, string | number>}`;
  const promises = [] as Promise<{
    key: RetKey;
    value: Awaited<T[RetKey]>;
  }>[];
  for (const rawKey in values) {
    const key = rawKey as RetKey;
    const promise = (async () => {
      try {
        return {
          key,
          value: await values[key],
        };
      } catch (e) {
        throw new RaceMapError(key, e);
      }
    })();
    promises.push(promise);
  }
  return Promise.race(promises);
}

export class RaceMapError extends Error {
  public key: Readonly<string>;
  public error: Readonly<Throwable>;

  public constructor(key: string, error: Throwable) {
    super();
    this.key = key;
    this.error = error;
  }
}

export class PromiseSource<T> {
  public promise: Promise<T>;
  public resolve!: (value: T | PromiseLike<T>) => void;
  public reject!: (reason?: Throwable) => void;

  public constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new TimeoutError());
    }, ms);

    promise
      .then(result => {
        clearTimeout(timeoutHandle);
        resolve(result);
      })
      .catch(reason => {
        clearTimeout(timeoutHandle);
        reject(reason);
      });
  });
}

export function withTimeoutAsResult<T>(
  promise: Promise<T>,
  ms: number
): Promise<{ value: T; timeout: false } | { value: undefined; timeout: true }> {
  return new Promise((resolve, reject) => {
    withTimeout(promise, ms)
      .then(value => {
        resolve({ value, timeout: false });
      })
      .catch(reason => {
        if (typeof reason === 'object' && reason instanceof TimeoutError) {
          resolve({ value: undefined, timeout: true });
        } else {
          reject(reason);
        }
      });
  });
}

export function willTimeout<T>(promise: Promise<T>, ms: number): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    withTimeout(promise, ms)
      .then(() => {
        resolve(false);
      })
      .catch(reason => {
        resolve(typeof reason === 'object' && reason instanceof TimeoutError);
      });
  });
}

export function willCompleteInTime<T>(promise: Promise<T>, ms: number): Promise<boolean> {
  return willTimeout(promise, ms).then(result => {
    return !result;
  });
}

export class CancelToken {
  private _callback!: () => unknown;
  private _isCanceled: boolean | null = null;

  public static when(callback: () => unknown) {
    const instance = new CancelToken();
    instance._callback = callback;
    return instance;
  }

  public isCanceled() {
    if (!this._isCanceled) {
      this._isCanceled = !!this._callback();
    }
    return this._isCanceled;
  }
}

export type Result<T> = { value: T; error: null; hasError: false } | { value: null; error: unknown; hasError: true };

export async function asResult<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    return {
      value: await promise,
      error: null,
      hasError: false,
    };
  } catch (e) {
    return {
      value: null,
      error: e,
      hasError: true,
    };
  }
}

export class EventPromiseSource<T extends EventEmitter> {
  private _eventEmitter: T;
  private _eventName: string | symbol;
  private _listener: (err: unknown) => void;
  private _source = new PromiseSource<void>();

  public constructor(eventEmitter: T, eventName: Parameters<T['on']>[0]) {
    this._eventEmitter = eventEmitter;
    this._eventName = eventName;
    this._listener = (err: unknown) => {
      if (typeof err === 'object' && err instanceof Error) {
        this._source.reject(err);
      } else {
        this._source.resolve();
      }
    };
    eventEmitter.once(eventName, this._listener);
  }

  public get promise() {
    return this._source.promise;
  }

  public close() {
    this._eventEmitter.removeListener(this._eventName, this._listener);
  }
}

export const never = new Promise<void>(() => {
  // Never resolved.
});

export function onEvent<T extends EventEmitter>(
  eventEmitter: T,
  eventName: Parameters<T['on']>[0],
  filter?: (...args: any[]) => boolean
) {
  return new Promise<any[]>(resolve => {
    let handler: (...args: any[]) => any;
    // eslint-disable-next-line prefer-const
    handler = (...args: any[]) => {
      if (filter === undefined || filter(...args)) {
        eventEmitter.off(eventName, handler);
        resolve(args);
      }
    };
    eventEmitter.on(eventName, handler);
  });
}

export class ReentrancyGuard<T> {
  private _promise: Promise<T> | null = null;

  public get promise() {
    return this._promise;
  }

  public get active() {
    return this._promise !== null;
  }

  public unlock() {
    this._promise = null;
  }

  public run<Args extends unknown[]>(func: (...args: Args) => Promise<T>, ...args: Args) {
    if (this._promise) {
      return {
        promise: this._promise,
        first: false,
      };
    }

    const promiseSource = new PromiseSource<T>();
    const { promise } = promiseSource;

    const execute = () => {
      func(...args)
        .then(result => {
          this._promise = null;
          promiseSource.resolve(result);
        })
        .catch(error => {
          this._promise = null;
          promiseSource.reject(error);
        });
      return promise;
    };

    this._promise = promise;
    execute();

    return {
      promise,
      first: true,
    };
  }
}

// type FunctionKeys<Target> = keyof {
//   [K in keyof Target as Target[K] extends ((...args: any) => any) ? K : never]: Target[K]
// }

// function foo<
// Target extends Record<Key, (...args: any) => any>,
// Key extends FunctionKeys<Target>,
// >(...[target, key, ...args]: [Target, Key, ...Parameters<Target[Key]>]) {
//   const method = target[key];
//   return method(...args) as ReturnType<Target[Key]>;
// }

// function foo2<
//   Target extends Record<Key, (...args: Args) => any>,
//   Args extends unknown[],
//   Key extends FunctionKeys<Target>
// >(target: Target, key: Key, ...args: Args): ReturnType<Target[Key]> {
//   const method = target[key];
//   return method(...args);
// }

// function foo3<
//   Target extends Record<Key, (...args: Args) => any>,
//   Args extends unknown[],
//   Key extends PropertyKey
// >(target: Target, key: Key, ...args: Args) {
//   const method = target[key];
//   return method(...args);
// }

// const obj = {
//   greet: (name: string) => `Hello, ${name}.`,
// };

// const r1 = foo(obj, 'd');
// const e2 = foo2(obj, 'd');
