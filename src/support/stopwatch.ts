export class Stopwatch {
  private _elapsedAccumulator = BigInt(0);
  private _start: bigint | null = null;
  private _end: bigint | null = null;

  public get paused() {
    return this._start === null;
  }

  public get stopped() {
    return this._end !== null;
  }

  public get running() {
    return this._start !== null && this._end === null;
  }

  public get elapsed() {
    if (this.paused) {
      return this._elapsedAccumulator;
    }
    const ref = this._end ?? process.hrtime.bigint();
    return this._elapsedAccumulator + ref - this._start!;
  }

  public get elapsedMillis() {
    return nanosToMillis(this.elapsed);
  }

  public static start() {
    const stopwatch = new Stopwatch();
    stopwatch.start();
    return stopwatch;
  }

  public start() {
    if (this.running) {
      return;
    }
    if (this.stopped) {
      this._end = null;
      this._elapsedAccumulator = BigInt(0);
    }
    this._start = process.hrtime.bigint();
  }

  public stop() {
    if (!this.stopped) {
      this._end = process.hrtime.bigint();
    }
    return this.elapsed;
  }

  public pause() {
    if (this.running) {
      this._elapsedAccumulator += this.elapsed;
      this._start = null;
    }
    return this.elapsed;
  }

  public reset() {
    this._start = null;
    this._end = null;
    this._elapsedAccumulator = BigInt(0);
  }

  public pauseMillis() {
    return nanosToMillis(this.pause());
  }

  public stopMillis() {
    return nanosToMillis(this.stop());
  }
}

function nanosToMillis(hrtime: bigint) {
  const whole = hrtime / BigInt(1000000);
  const rest = hrtime % BigInt(1000000);
  return Number(whole) + Number(rest) / 1000000;
}
