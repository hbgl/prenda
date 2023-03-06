import test from 'ava';
import { BrowserProcessStatus } from '../process.js';
import {
  BrowserRecycleResult,
  BrowserSupervisor,
  BrowserSupervisorRecycleEvent,
  BrowserSupervisorTakeoverEvent,
  BrowserSupervisorTakeoverReason,
} from './supervisor.js';
import { BrowserInstanceRole } from '../instance.js';
import { onEvent, willTimeout, withTimeoutAsResult } from '../../support/promise.js';
import getPort from '@ava/get-port';
import { killProc, killProcSync, procExists } from '../../test/support/process.js';
import { nullLogger } from '../../support/logging.js';
import { BrowserHandle } from '../../browser/handle.js';
import { eventCount, mapEvent } from '../../test/support/events.js';
import { initialize } from '../../test/extensions.js';

initialize(test, { maxConcurrency: 4 });

const defaultOptions = {
  logger: nullLogger,
};

test('example', async t => {
  const [port1, port2] = await Promise.all([getPort(), getPort()]);
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: port1,
    debuggingPort2: port2,
  });
  t.teardown(() => supervisor.close());

  t.is(supervisor.main.role, BrowserInstanceRole.Main);
  t.is(supervisor.main.handleCount, 0);
  t.is(supervisor.main.process.status, BrowserProcessStatus.Initial);

  t.is(supervisor.standby.role, BrowserInstanceRole.Standby);
  t.is(supervisor.standby.handleCount, 0);
  t.is(supervisor.standby.process.status, BrowserProcessStatus.Initial);

  await supervisor.start();

  const mainPid = supervisor.main.process.pid;
  const standbyPid = supervisor.standby.process.pid;

  t.is(supervisor.main.process.status, BrowserProcessStatus.Running);
  t.truthy(procExists(mainPid!));
  t.is(supervisor.main.client!.port, port1);

  t.is(supervisor.standby.process.status, BrowserProcessStatus.Running);
  t.truthy(procExists(standbyPid!));
  t.is(supervisor.standby.client!.port, port2);

  const handle = await supervisor.createHandle();
  t.not(handle, null);
  t.is(handle?.client, supervisor.main.process.client!);
  t.is(supervisor.main.handleCount, 1);

  t.truthy(await handle?.client.Browser.getVersion());
  handle?.close();

  await supervisor.close();

  t.is(supervisor.main.handleCount, 0);
  t.is(supervisor.main.process.status, BrowserProcessStatus.Stopped);
  t.falsy(procExists(mainPid!));

  t.is(supervisor.standby.handleCount, 0);
  t.is(supervisor.standby.process.status, BrowserProcessStatus.Stopped);
  t.falsy(procExists(standbyPid!));
});

test('recycle - wait for handles to close', async t => {
  const port1 = await getPort();
  const port2 = await getPort();
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: port1,
    debuggingPort2: port2,
    autoRecycle: false,
    recycleDrainMillis: 10000,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const handle1 = await supervisor.createHandle();
  t.not(handle1, null);
  t.is(handle1?.client.port, port1);

  const recyclePromise = supervisor.recycleMain();
  const timedOutWithOpenHandle = await willTimeout(recyclePromise, 2000);
  t.is(timedOutWithOpenHandle, true);

  handle1?.close();

  const result = await recyclePromise;
  t.is(result, BrowserRecycleResult.Recycled);

  const handle2 = await supervisor.createHandle();
  t.not(handle2, null);
  t.is(handle2?.client.port, port2);
});

test('recycle - wait for open handles to close but force restart after timeout', async t => {
  const port1 = await getPort();
  const port2 = await getPort();
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: port1,
    debuggingPort2: port2,
    autoRecycle: false,
    recycleDrainMillis: 3000,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const handle1 = await supervisor.createHandle();
  t.not(handle1, null);
  t.is(handle1?.client.port, port1);

  const result = await withTimeoutAsResult(supervisor.recycleMain(), 10000);
  t.is(result.timeout, false);
  t.is(result.value, BrowserRecycleResult.Recycled);

  t.is(handle1?.closed, true);

  const handle2 = await supervisor.createHandle();
  t.not(handle2, null);
  t.is(handle2?.client.port, port2);
});

test('recycle - standby stopped', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRecycle: false,
    autoRestartProcesses: false,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const standby = supervisor.standby;
  const faulted = onEvent(standby.process, 'fault');
  await killProc(standby.process.pid!);
  await faulted;

  const result = await supervisor.recycleMain();
  t.is(result, BrowserRecycleResult.StandbyUnavailable);
});

test('recycle - shutdown while draining requests', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRecycle: false,
    recycleDrainMillis: 3000,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const handle = await supervisor.createHandle();
  t.not(handle, null);

  const recyclePromise = supervisor.recycleMain();
  await supervisor.close();

  handle!.close();

  const result = await recyclePromise;
  t.is(result, BrowserRecycleResult.Canceled);
});

test('recycle - fault new main while draining requests and after process recognizes fault', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRecycle: false,
    recycleDrainMillis: 5000,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const newMain = supervisor.standby;
  const newStandby = supervisor.main;
  const takeoverCount = eventCount(supervisor, 'takeover');

  const handle = await supervisor.createHandle();
  t.not(handle, null);

  const newMainFault = onEvent(newMain.process, 'fault');

  const recyclePromise = supervisor.recycleMain();
  killProcSync(newMain.process.pid!);
  await newMainFault;
  handle!.close();

  const result = await recyclePromise;
  t.is(newMain.role, BrowserInstanceRole.Standby);
  t.is(newStandby.role, BrowserInstanceRole.Main);
  t.is(result, BrowserRecycleResult.StandbyUnavailable);
  t.is(takeoverCount(), 2); // One takeover from recycle plus one takeover from fault.
});

test('recycle - fault new standby while draining requests but before process recognizes fault', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRecycle: false,
    recycleDrainMillis: 5000,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const newStandby = supervisor.main;
  const newStandbyFaultCount = eventCount(newStandby.process, 'fault');

  const handle = await supervisor.createHandle();
  t.not(handle, null);

  const recyclePromise = supervisor.recycleMain();
  killProcSync(newStandby.process.pid!);
  handle!.close();

  const result = await recyclePromise;
  t.is(result, BrowserRecycleResult.Recycled);
  t.is(newStandbyFaultCount(), 0);
});

test('recycle - fault new standby while draining requests and after process recognizes fault', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRecycle: false,
    recycleDrainMillis: 5000,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const newStandby = supervisor.main;

  const handle = await supervisor.createHandle();
  t.not(handle, null);

  const newStandbyFault = onEvent(newStandby.process, 'fault');
  const newStandbyStart = onEvent(newStandby.process, 'start');

  const recyclePromise = supervisor.recycleMain();
  killProcSync(newStandby.process.pid!);
  await newStandbyFault; // Wait until fault recognized.
  handle!.close();

  const result = await recyclePromise;
  t.is(result, BrowserRecycleResult.Canceled);

  await newStandbyStart; // Standby should automatically restart.
});

test('recycle - shutdown before restarting', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRecycle: false,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const main = supervisor.main;
  const mainStopped = onEvent(main, 'stop');

  const recyclePromise = supervisor.recycleMain();

  await mainStopped;
  await supervisor.close();

  const result = await recyclePromise;
  t.is(result, BrowserRecycleResult.Canceled);
});

test('auto recycle - example', async t => {
  const port1 = await getPort();
  const port2 = await getPort();
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: port1,
    debuggingPort2: port2,
    autoRecycleAfterUptimeMillis: 3000,
    autoRecycleRetryAfterMillis: 1000,
    recycleDrainMillis: 1500,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const originalMain = supervisor.main;
  const originalStandby = supervisor.standby;

  await onEvent(
    supervisor,
    'takeover',
    (data: BrowserSupervisorTakeoverEvent) => data.reason === BrowserSupervisorTakeoverReason.Recycle
  );
  await onEvent(originalMain, 'stop');
  await onEvent(originalMain, 'start');

  t.is(originalMain.role, BrowserInstanceRole.Standby);
  t.is(originalStandby.role, BrowserInstanceRole.Main);

  await onEvent(
    supervisor,
    'takeover',
    (data: BrowserSupervisorTakeoverEvent) => data.reason === BrowserSupervisorTakeoverReason.Recycle
  );
  await onEvent(originalStandby, 'stop');
  await onEvent(originalStandby, 'start');

  t.is(originalMain.role, BrowserInstanceRole.Main);
  t.is(originalStandby.role, BrowserInstanceRole.Standby);
});

test('auto recycle - shutdown after restarting', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRecycleAfterUptimeMillis: 3000,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const main = supervisor.main;

  const recycled = onEvent(supervisor, 'recycle');
  await mapEvent(main, 'start', () => supervisor.close());
  const recycleEvent = (await recycled)[0] as BrowserSupervisorRecycleEvent;

  t.is(recycleEvent.result, BrowserRecycleResult.Recycled);
});

test('auto recycle - canceled recycle run does not prevent future recycles', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRecycleAfterUptimeMillis: 3000,
    recycleDrainMillis: 1500,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const oldMain = supervisor.main;
  const oldStandby = supervisor.standby;

  const handle = await supervisor.createHandle();
  t.truthy(handle);

  await onEvent(
    supervisor,
    'takeover',
    (data: BrowserSupervisorTakeoverEvent) => data.reason === BrowserSupervisorTakeoverReason.Recycle
  );
  const oldMainFault = onEvent(oldMain.process, 'fault');
  const oldMainStart = onEvent(oldMain.process, 'start');
  killProcSync(oldMain.process.pid!);
  await oldMainFault;
  handle!.close();

  const recycleEvent1 = (await onEvent(supervisor, 'recycle'))[0] as BrowserSupervisorRecycleEvent;
  t.is(recycleEvent1.result, BrowserRecycleResult.Canceled);

  t.is(oldMain.role, BrowserInstanceRole.Standby);
  t.not(oldMain.process.status, BrowserProcessStatus.Running);
  t.is(oldStandby.role, BrowserInstanceRole.Main);
  t.is(oldStandby.process.status, BrowserProcessStatus.Running);
  await oldMainStart;

  const recycleEvent2 = (await onEvent(supervisor, 'recycle'))[0] as BrowserSupervisorRecycleEvent;
  t.is(recycleEvent2.result, BrowserRecycleResult.Recycled);

  t.is(oldMain.role, BrowserInstanceRole.Main);
  t.is(oldStandby.role, BrowserInstanceRole.Standby);
});

test('auto recycle - unavailable standby in one recycle run does not prevent future recycles', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRecycleAfterUptimeMillis: 3000,
    recycleDrainMillis: 1500,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const oldMain = supervisor.main;
  const oldStandby = supervisor.standby;

  const handle = await supervisor.createHandle();
  t.truthy(handle);

  await onEvent(
    supervisor,
    'takeover',
    (data: BrowserSupervisorTakeoverEvent) => data.reason === BrowserSupervisorTakeoverReason.Recycle
  );
  const oldStandbyFault = onEvent(oldStandby.process, 'fault');
  const oldStandbyStart = onEvent(oldStandby.process, 'start');
  killProcSync(oldStandby.process.pid!);
  await oldStandbyFault;
  handle!.close();

  const recycleEvent1 = (await onEvent(supervisor, 'recycle'))[0] as BrowserSupervisorRecycleEvent;
  t.is(recycleEvent1.result, BrowserRecycleResult.StandbyUnavailable);

  t.is(oldMain.role, BrowserInstanceRole.Main);
  t.is(oldMain.process.status, BrowserProcessStatus.Running);
  t.is(oldStandby.role, BrowserInstanceRole.Standby);
  t.not(oldStandby.process.status, BrowserProcessStatus.Running);
  await oldStandbyStart;

  const recycleEvent2 = (await onEvent(supervisor, 'recycle'))[0] as BrowserSupervisorRecycleEvent;
  t.is(recycleEvent2.result, BrowserRecycleResult.Recycled);

  t.is(oldMain.role, BrowserInstanceRole.Standby);
  t.is(oldStandby.role, BrowserInstanceRole.Main);
});

test('open lots of handles', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRecycle: false,
  });
  t.teardown(() => supervisor.close());

  await supervisor.start();

  const handles = new Array<BrowserHandle>(500);

  for (let i = 0; i < handles.length; i++) {
    const handle = await supervisor.createHandle();
    t.not(handle, null);
    handles[i] = handle!;
  }
  t.is(supervisor.main.handles.size, handles.length);
  t.is(supervisor.standby.handles.size, 0);

  for (const handle of handles) {
    t.truthy(await handle.client.Browser.getVersion());
  }

  await supervisor.close();
  t.is(supervisor.main.handles.size, 0);
  t.is(supervisor.standby.handles.size, 0);
});

test('takeover on crash', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRecycle: false,
  });
  t.teardown(() => supervisor.close());

  const originalMain = supervisor.main;
  const originalStandby = supervisor.standby;

  await supervisor.start();

  const handle1 = await supervisor.createHandle();
  t.truthy(handle1!.client.Browser.getVersion());

  const faulted = onEvent(supervisor.main.process, 'fault');
  const takeover = onEvent(
    supervisor,
    'takeover',
    (data: BrowserSupervisorTakeoverEvent) => data.reason === BrowserSupervisorTakeoverReason.Fault
  );
  const promoted = onEvent(supervisor.standby, 'main');
  const demoted = onEvent(supervisor.main, 'standby');
  process.kill(supervisor.main.process.pid!);

  await Promise.all([faulted, promoted, demoted, takeover]);

  t.is(originalStandby.role, BrowserInstanceRole.Main);
  t.is(originalMain.role, BrowserInstanceRole.Standby);

  const handle2 = await supervisor.createHandle();
  t.truthy(handle2!.client.Browser.getVersion());

  await supervisor.close();
});

test('no takeover when both crash', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRestartProcesses: false,
  });
  t.teardown(() => supervisor.close());

  const originalMain = supervisor.main;
  const originalStandby = supervisor.standby;

  await supervisor.start();

  const handle1 = await supervisor.createHandle();
  t.truthy(handle1!.client.Browser.getVersion());

  const mainFaulted = onEvent(supervisor.main.process, 'fault');
  const standbyFaulted = onEvent(supervisor.standby.process, 'fault');

  process.kill(supervisor.standby.process.pid!);
  await standbyFaulted;

  process.kill(supervisor.main.process.pid!);
  await mainFaulted;

  t.is(originalMain.role, BrowserInstanceRole.Main);
  t.is(originalStandby.role, BrowserInstanceRole.Standby);

  await supervisor.close();
});

test('takeover after both crash and standby restarts first', async t => {
  const supervisor = new BrowserSupervisor({
    ...defaultOptions,
    debuggingPort1: await getPort(),
    debuggingPort2: await getPort(),
    autoRestartProcesses: false,
    autoRecycle: false,
  });
  t.teardown(() => supervisor.close());

  const originalMain = supervisor.main;
  const originalStandby = supervisor.standby;

  await supervisor.start();

  const handle1 = await supervisor.createHandle();
  t.truthy(handle1!.client.Browser.getVersion());

  const mainFaulted = onEvent(supervisor.main.process, 'fault');
  const standbyFaulted = onEvent(supervisor.standby.process, 'fault');

  process.kill(supervisor.standby.process.pid!);
  await standbyFaulted;

  process.kill(supervisor.main.process.pid!);
  await mainFaulted;

  t.is(originalMain.role, BrowserInstanceRole.Main);
  t.is(originalStandby.role, BrowserInstanceRole.Standby);

  const takeover = onEvent(supervisor, 'takeover');
  await supervisor.standby.start();
  await takeover;

  t.is(originalStandby.role, BrowserInstanceRole.Main);
  t.is(originalMain.role, BrowserInstanceRole.Standby);

  await supervisor.close();
});
