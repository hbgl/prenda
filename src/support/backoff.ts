import { LogicError } from './errors/common.js';

export interface Backoff {
  nextTry(): number;
  getMillis(): number;
  reset(): void;
}

export class FlatBackoff implements Backoff {
  private _millis: number;

  public constructor(millis: number) {
    this._millis = millis;
  }

  public nextTry() {
    return this.getMillis();
  }

  public getMillis() {
    return this._millis;
  }

  public reset() {
    // Not needed.
  }
}

export interface TriesBackoffEntry {
  tries: number;
  millis: number;
}

export type TriesBackoffEntries =
  | ReadonlyArray<Readonly<TriesBackoffEntry>>
  | ReadonlyArray<Readonly<[number, number]>>;

export class TriesBackoff implements Backoff {
  private _entries: ReadonlyArray<Readonly<TriesBackoffEntry>>;
  private _index = 0;
  private _tries = 0;

  public constructor(entries: TriesBackoffEntries) {
    if (entries.length === 0) {
      throw new LogicError('entries must not be empty');
    }

    if (TriesBackoff.isTupleEntries(entries)) {
      entries = entries.map(([tries, millis]) => ({ tries, millis }));
    }
    this._entries = entries.slice().sort((a, b) => Math.sign(a.tries - b.tries));
  }

  private static isTupleEntries(entries: TriesBackoffEntries): entries is ReadonlyArray<Readonly<[number, number]>> {
    return Array.isArray(entries[0]);
  }

  nextTry() {
    this._tries++;
    if (this._index < this._entries.length - 1 && this._entries[this._index + 1].tries >= this._tries) {
      this._index++;
    }
    return this.getMillis();
  }

  getMillis(): number {
    return this._entries[this._index].millis;
  }

  public reset() {
    this._tries = 0;
    this._index = 0;
  }
}

export type BackoffFactory = () => Backoff;
