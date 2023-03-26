import test from 'ava';
import {
  BrowserProcess,
  BrowserProcessEventRunning,
  BrowserProcessEvents,
  BrowserProcessStartReason,
  BrowserProcessStatus,
} from './process.js';
import { onEvent } from '../support/promise.js';
import { killProc, killProcSync, procExists } from '../test/support/process.js';
import { LogicError } from '../support/errors/common.js';
import { eventCount, mapEvent } from '../test/support/events.js';
import { initialize } from '../test/extensions.js';
import getPort from '@ava/get-port';

initialize(test, { maxConcurrency: 4 });

test('example', async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  t.is(browserProcess.status, BrowserProcessStatus.Initial);

  const statusRecorder = BrowserProcessStatusRecorder.start(browserProcess);

  await browserProcess.start();

  // Verify that the process is indeed running.
  const pid = browserProcess.pid;
  t.true(typeof pid === 'number');
  t.is(browserProcess.status, BrowserProcessStatus.Running);
  t.truthy(procExists(pid!));

  // Communicate with the browser.
  const targetInfoResponse = await browserProcess.client?.Target.getTargetInfo({});
  t.truthy(targetInfoResponse);
  t.is(targetInfoResponse!.targetInfo.attached, true);

  await browserProcess.stop();

  t.falsy(procExists(pid!));
  t.is(browserProcess.status, BrowserProcessStatus.Stopped);

  t.deepEqual(statusRecorder.stop(), [
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
    BrowserProcessStatus.Stopping,
    BrowserProcessStatus.Stopped,
  ]);
});

test('cannot start again while starting', async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const first = browserProcess.start();
  const second = browserProcess.start();

  await t.throwsAsync(second, { instanceOf: LogicError });
  await first;
});

test('stop during start then restart', async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const statusRecorder = BrowserProcessStatusRecorder.start(browserProcess);

  const firstStart = browserProcess.start();
  await browserProcess.stop();
  const secondStart = browserProcess.start();

  await Promise.all([firstStart, secondStart]);

  t.deepEqual(statusRecorder.stop(), [
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Stopping,
    BrowserProcessStatus.Stopped,
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
  ]);
});

test("start in 'stopped' event handler", async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const statusRecorder = BrowserProcessStatusRecorder.start(browserProcess);

  const startedInStopped = mapEvent(browserProcess, 'stop', async () => browserProcess.start());

  await browserProcess.start();
  await browserProcess.stop();
  await startedInStopped;

  t.deepEqual(statusRecorder.stop(), [
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
    BrowserProcessStatus.Stopping,
    BrowserProcessStatus.Stopped,
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
  ]);
});

test('cannot start when faulted', async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const startedInFaulted = mapEvent(browserProcess, 'fault', () => browserProcess.start());

  await browserProcess.start();
  await killProc(browserProcess.pid!);
  await t.throwsAsync(startedInFaulted!, { instanceOf: LogicError });
});

test('cannot start when stopping', async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const startedInFaulted = mapEvent(browserProcess, 'stopping', () => browserProcess.start());

  await browserProcess.start();
  await browserProcess.stop();
  await t.throwsAsync(startedInFaulted!, { instanceOf: LogicError });
});

test("stop in 'starting' event handler", async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const statusRecorder = BrowserProcessStatusRecorder.start(browserProcess);

  const stoppedInStarting = mapEvent(browserProcess, 'starting', () => browserProcess.stop());

  await browserProcess.start();
  await stoppedInStarting;

  t.deepEqual(statusRecorder.stop(), [
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Stopping,
    BrowserProcessStatus.Stopped,
  ]);
});

test("stop in 'faulted' event handler", async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const statusRecorder = BrowserProcessStatusRecorder.start(browserProcess);

  const stoppedAfterFaulted = mapEvent(browserProcess, 'fault', () => browserProcess.stop());

  await browserProcess.start();
  await killProc(browserProcess.pid!);
  await stoppedAfterFaulted;

  t.deepEqual(statusRecorder.stop(), [
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
    BrowserProcessStatus.Faulted,
    BrowserProcessStatus.Stopping,
    BrowserProcessStatus.Stopped,
  ]);
});

test("stop in 'stopping' event handler", async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const statusRecorder = BrowserProcessStatusRecorder.start(browserProcess);

  const stoppedInStopping = mapEvent(browserProcess, 'stopping', () => browserProcess.stop());

  await browserProcess.start();
  await browserProcess.stop();
  await stoppedInStopping;

  t.deepEqual(statusRecorder.stop(), [
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
    BrowserProcessStatus.Stopping,
    BrowserProcessStatus.Stopped,
  ]);
});

test('stop multiple times', async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const statusRecorder = BrowserProcessStatusRecorder.start(browserProcess);

  await browserProcess.start();
  await Promise.all([browserProcess.stop(), browserProcess.stop()]);

  t.deepEqual(statusRecorder.stop(), [
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
    BrowserProcessStatus.Stopping,
    BrowserProcessStatus.Stopped,
  ]);
});

test('fault before CDP client creation', async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
    retryStartup: false,
    autoRestart: false,
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  let faultedEventCalled = false;

  browserProcess.on('fault', () => {
    faultedEventCalled = true;
  });

  browserProcess.on('__test__:cdp-client-creation:before' as any, () => {
    killProcSync(browserProcess.pid!);
  });

  await browserProcess.start();
  t.true(
    browserProcess.status === BrowserProcessStatus.Stopping || browserProcess.status === BrowserProcessStatus.Stopped
  );
  t.is(browserProcess.faulted, true);
  t.true(faultedEventCalled);
});

test('fault before CDP version query', async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
    retryStartup: false,
    autoRestart: false,
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const statusRecorder = BrowserProcessStatusRecorder.start(browserProcess);

  browserProcess.on('__test__:cdp-verison-query:before' as any, () => {
    killProcSync(browserProcess.pid!);
  });

  const stopped = onEvent(browserProcess, 'stop');

  await browserProcess.start();
  await stopped;

  t.is(browserProcess.status, BrowserProcessStatus.Stopped);
  t.is(browserProcess.faulted, true);
  t.deepEqual(statusRecorder.stop(), [
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Faulted,
    BrowserProcessStatus.Stopping,
    BrowserProcessStatus.Stopped,
  ]);
});

test('auto restart', async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
    retryStartup: false,
    autoRestart: true,
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const statusRecorder = BrowserProcessStatusRecorder.start(browserProcess);

  await browserProcess.start();
  killProcSync(browserProcess.pid!);
  await onEvent(
    browserProcess,
    'start',
    (data: BrowserProcessEventRunning) => data.reason === BrowserProcessStartReason.AutoRestart
  );

  t.deepEqual(statusRecorder.stop(), [
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
    BrowserProcessStatus.Faulted,
    BrowserProcessStatus.Stopping,
    BrowserProcessStatus.Stopped,
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
  ]);
});

test("manual start in 'stopped' event handler before auto restart", async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
    retryStartup: false,
    autoRestart: true,
    autoRestartDelayMillis: 10,
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const statusRecorder = BrowserProcessStatusRecorder.start(browserProcess);

  const manuallyRestarted = mapEvent(browserProcess, 'stop', () => browserProcess.start());
  const autoRestartAborted = onEvent(browserProcess, '__test__:auto-restart-aborted' as any);
  const autoRestartScheduledCount = eventCount(browserProcess, '__test__:auto-restart-scheduled' as any);

  await browserProcess.start();
  await killProc(browserProcess.pid!);
  await manuallyRestarted;
  await autoRestartAborted;

  t.is(autoRestartScheduledCount(), 0);

  t.deepEqual(statusRecorder.stop(), [
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
    BrowserProcessStatus.Faulted,
    BrowserProcessStatus.Stopping,
    BrowserProcessStatus.Stopped,
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
  ]);
});

test('manual start after scheduled auto restart', async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
    retryStartup: false,
    autoRestart: true,
    autoRestartDelayMillis: 10,
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  const statusRecorder = BrowserProcessStatusRecorder.start(browserProcess);

  const autoRestartAborted = onEvent(browserProcess, '__test__:auto-restart-aborted' as any);
  const autoRestartScheduled = onEvent(browserProcess, '__test__:auto-restart-scheduled' as any);
  const manualRestart = mapEvent(browserProcess, '__test__:auto-restart-scheduled' as any, () =>
    browserProcess.start()
  );

  await browserProcess.start();
  await killProc(browserProcess.pid!);
  await autoRestartScheduled;
  await manualRestart;
  await autoRestartAborted;

  t.deepEqual(statusRecorder.stop(), [
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
    BrowserProcessStatus.Faulted,
    BrowserProcessStatus.Stopping,
    BrowserProcessStatus.Stopped,
    BrowserProcessStatus.Starting,
    BrowserProcessStatus.Running,
  ]);
});

test('start counter', async t => {
  const browserProcess = new BrowserProcess({
    debuggingPort: await getPort(),
  });
  t.teardown(() => {
    browserProcess.removeAllListeners();
    return browserProcess.stop();
  });

  t.is(browserProcess.startCount, 0);

  await browserProcess.start();

  t.is(browserProcess.startCount, 1);

  await browserProcess.stop();
  await browserProcess.start();

  t.is(browserProcess.startCount, 2);

  const faulted = onEvent(browserProcess, 'fault');
  const restarted = onEvent(browserProcess, 'start');
  process.kill(browserProcess.pid!);
  await faulted;
  await restarted;

  t.is(browserProcess.startCount, 3);
});

class BrowserProcessStatusRecorder {
  private _entries: BrowserProcessStatus[] = [];
  private _browserProcess: BrowserProcess | null = null;
  private _listeners: Record<keyof BrowserProcessEvents, any> = {
    starting: () => this._entries.push(BrowserProcessStatus.Starting),
    start: () => this._entries.push(BrowserProcessStatus.Running),
    stopping: () => this._entries.push(BrowserProcessStatus.Stopping),
    stop: () => this._entries.push(BrowserProcessStatus.Stopped),
    fault: () => this._entries.push(BrowserProcessStatus.Faulted),
  };

  public get entries(): readonly BrowserProcessStatus[] {
    return this._entries;
  }

  private constructor(browserProcess: BrowserProcess) {
    this._browserProcess = browserProcess;
    let eventName: keyof typeof this._listeners;
    for (eventName in this._listeners) {
      browserProcess.on(eventName, this._listeners[eventName]);
    }
  }

  public static start(browserProcess: BrowserProcess) {
    const instance = new BrowserProcessStatusRecorder(browserProcess);
    return instance;
  }

  public stop() {
    if (this._browserProcess === null) {
      return;
    }
    let eventName: keyof typeof this._listeners;
    for (eventName in this._listeners) {
      this._browserProcess.on(eventName, this._listeners[eventName]);
    }
    this._browserProcess = null;
    return this._entries;
  }
}
