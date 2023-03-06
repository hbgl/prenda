import Denque from 'denque';
import { PromiseSource } from '../../support/promise.js';

export class Semaphore {
  private _count: number;
  private _queue = new Denque<PromiseSource<void>>();

  public constructor(maxConcurrent: number) {
    this._count = maxConcurrent;
  }

  public wrap<F extends (...args: unknown[]) => unknown>(func: F): (...args: Parameters<F>) => Promise<ReturnType<F>> {
    return async (...args: unknown[]) => {
      await this.enter();

      let result: ReturnType<F>;
      try {
        result = (await func(...args)) as ReturnType<F>;
      } finally {
        this.exit();
      }

      return result;
    };
  }

  public async enter() {
    if (this._count == 0) {
      const ticket = new PromiseSource<void>();
      this._queue.push(ticket);
      await ticket.promise;
    }
    this._count--;
  }

  public exit() {
    this._count++;
    const ticket = this._queue.shift();
    if (ticket) {
      ticket.resolve();
    }
  }
}
