import { TestFn } from 'ava';
import { Semaphore } from './support/concurrency.js';

export interface TestFileOptions {
  maxConcurrency?: number;
}

export function initialize(test: TestFn<unknown>, options?: TestFileOptions) {
  const o: TestFileOptions = {
    maxConcurrency: options?.maxConcurrency,
  };

  setupMaxConcurrency(test, o.maxConcurrency);
}

function setupMaxConcurrency(test: TestFn<unknown>, n?: number) {
  if (n === undefined) {
    return;
  }

  const semaphore = new Semaphore(n);

  test.beforeEach(async () => {
    await semaphore.enter();
  });

  test.afterEach.always(() => {
    semaphore.exit();
  });
}
