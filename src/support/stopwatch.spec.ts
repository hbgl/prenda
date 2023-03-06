import test from 'ava';
import { sleepMs } from './sleep.js';
import { Stopwatch } from './stopwatch.js';

test('example', async t => {
  const stopwatch = Stopwatch.start();

  await sleepMs(5);
  const e1 = stopwatch.elapsedMillis;
  t.true(e1 > 4);

  await sleepMs(5);
  const e2 = stopwatch.elapsedMillis;
  t.true(e2 > e1);

  stopwatch.pause();

  const e3 = stopwatch.elapsedMillis;
  await sleepMs(5);
  const e4 = stopwatch.elapsedMillis;
  t.true(e3 === e4);

  stopwatch.start();

  await sleepMs(5);
  stopwatch.stop();
  const e5 = stopwatch.elapsedMillis;
  t.true(e5 > e4);

  stopwatch.start();

  await sleepMs(5);
  const e6 = stopwatch.elapsedMillis;
  t.true(e6 > 4 && e6 < e5);
});
