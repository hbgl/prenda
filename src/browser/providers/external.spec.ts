import test from 'ava';
import { BrowserProcess } from '../process.js';
import { onEvent } from '../../support/promise.js';
import getPort from '@ava/get-port';
import {
  ExternalBrowserConnectEvent,
  ExternalBrowserConnectReason,
  ExternalBrowserFaultEvent,
  ExternalBrowserFaultType,
  ExternalBrowserProvider,
  ExternalBrowserProviderEvents,
  ExternalBrowserProviderHostPortOptions,
} from './external.js';
import { BrowserProviderStatus } from './provider.js';
import * as http from 'node:http';
import { FlatBackoff } from '../../support/backoff.js';
import { BrowserHandle } from '../../browser/handle.js';
import { EventRecorder, EventRecorderEntry, mapEvent } from '../../test/support/events.js';
import { identity } from '../../support/types/utilities.js';
import { initialize } from '../../test/extensions.js';

initialize(test, { maxConcurrency: 4 });

const defaultHostPortOptions: ExternalBrowserProviderHostPortOptions = {
  host: 'localhost',
  port: -1,
  secure: false,
};

let browserProcess: BrowserProcess | null = null;

test.before('start chrome', async () => {
  const port = await getPort();
  browserProcess = new BrowserProcess({
    autoRestart: false,
    retryStartup: false,
    debuggingPort: port,
  });
  await browserProcess.start();
  defaultHostPortOptions.port = port;
});

test.after.always('stop chrome', async () => {
  if (browserProcess !== null) {
    await browserProcess.stop();
    browserProcess = null;
  }
});

test('example', async t => {
  const externalProvider = new ExternalBrowserProvider({ ...defaultHostPortOptions });
  t.teardown(() => externalProvider.close());

  const eventRecorder = recordEvents(externalProvider);

  const started = externalProvider.start();
  t.is(externalProvider.status, BrowserProviderStatus.Starting);
  await started;
  t.is(externalProvider.status, BrowserProviderStatus.Running);

  const handle1 = (await externalProvider.createHandle())!;
  const handle2 = (await externalProvider.createHandle())!;
  t.not(handle1, null);
  t.not(handle2, null);

  t.truthy(await handle1.client.Browser.getVersion());
  t.truthy(await handle2.client.Browser.getVersion());
  handle1.close();
  handle2.close();

  const closed = externalProvider.close();
  t.is(externalProvider.status, BrowserProviderStatus.Closing);
  await closed;
  t.is(externalProvider.status, BrowserProviderStatus.Closed);

  t.deepEqual(
    eventRecorder.stop(),
    identity<EventRecorderEntry<ExternalBrowserProviderEvents>[]>([
      { name: 'starting', data: undefined },
      { name: 'connect', data: { reason: ExternalBrowserConnectReason.Startup } },
      { name: 'start', data: undefined },
      { name: 'closing', data: undefined },
      { name: 'close', data: undefined },
    ])
  );
});

test('static debugger url', async t => {
  const externalProvider = new ExternalBrowserProvider({
    debuggerUrl: browserProcess!.client!.webSocketUrl,
  });
  t.teardown(() => externalProvider.close());

  await externalProvider.start();

  const handle = (await externalProvider.createHandle())!;
  t.not(handle, null);
  t.truthy(handle.client.Browser.getVersion());
});

test('auto close handle', async t => {
  const externalProvider = new ExternalBrowserProvider({ ...defaultHostPortOptions });
  t.teardown(() => externalProvider.close());
  await externalProvider.start();

  const handle = (await externalProvider.createHandle())!;
  t.false(handle.closed);

  await externalProvider.close();
  t.true(handle.closed);
  t.is(externalProvider.handles.size, 0);
});

test('close during start', async t => {
  const externalProvider = new ExternalBrowserProvider({ ...defaultHostPortOptions });
  t.teardown(() => externalProvider.close());

  const eventRecorder = recordEvents(externalProvider);

  const started = externalProvider.start();
  await externalProvider.close();
  t.is(externalProvider.status, BrowserProviderStatus.Closed);
  await started;

  t.deepEqual(
    eventRecorder.stop(),
    identity<EventRecorderEntry<ExternalBrowserProviderEvents>[]>([
      { name: 'starting', data: undefined },
      { name: 'closing', data: undefined },
      { name: 'close', data: undefined },
    ])
  );
});

test('close before reconnect', async t => {
  const browserProcess = new BrowserProcess({
    autoRestart: false,
    debuggingPort: await getPort(),
  });
  t.teardown(() => browserProcess.stop());
  await browserProcess.start();

  const externalProvider = new ExternalBrowserProvider({
    ...defaultHostPortOptions,
    port: browserProcess.port,
    reconnectBackoffFactory: () => new FlatBackoff(0),
  });
  t.teardown(() => externalProvider.close());

  const eventRecorder = recordEvents(externalProvider);

  await externalProvider.start();

  const closed = mapEvent(externalProvider, 'fault', () => externalProvider.close());
  await browserProcess.stop();
  await closed;

  t.deepEqual(
    eventRecorder.eventNames,
    identity<Array<keyof ExternalBrowserProviderEvents>>([
      'starting',
      'connect',
      'start',
      'disconnect',
      'fault',
      'closing',
      'close',
    ])
  );
});

test('cannot connect', async t => {
  const port = await getPort();
  const externalProvider = new ExternalBrowserProvider({
    host: 'localhost',
    port,
    reconnectBackoffFactory: () => new FlatBackoff(60000),
  });
  t.teardown(() => externalProvider.close());

  const doNothingHttpServer = new DoNothingHttpServer(request => request.destroy());
  t.teardown(() => doNothingHttpServer.close());
  await doNothingHttpServer.listen(port);

  const faulted = new Promise<ExternalBrowserFaultEvent>(resolve => {
    externalProvider.on('fault', fault => resolve(fault));
  });
  await externalProvider.start();
  const fault = await faulted;
  t.is(fault.type, ExternalBrowserFaultType.Connect);

  const handle = await externalProvider.createHandle();
  t.is(handle, null);
});

test('auto-reconnect', async t => {
  const browserProcess = new BrowserProcess({
    autoRestart: false,
    debuggingPort: await getPort(),
  });
  t.teardown(() => browserProcess.stop());
  await browserProcess.start();

  const externalProvider = new ExternalBrowserProvider({
    ...defaultHostPortOptions,
    port: browserProcess.port,
    reconnectBackoffFactory: () => new FlatBackoff(500),
  });
  t.teardown(() => externalProvider.close());
  await externalProvider.start();

  const handle1 = (await externalProvider.createHandle())!;
  t.not(handle1, null);
  t.truthy(await handle1.client.Browser.getVersion());

  const disconnected = onEvent(externalProvider, 'disconnect');
  const reconnected = onEvent(
    externalProvider,
    'connect',
    (data: ExternalBrowserConnectEvent) => data.reason === ExternalBrowserConnectReason.Reconnect
  );

  await browserProcess.stop();
  await disconnected;

  t.true(handle1.closed);

  await browserProcess.start();
  await reconnected;

  t.true(handle1.closed);
});

test('static debugger URL fails to auto-reconnect because of changing UUID', async t => {
  const browserProcess = new BrowserProcess({
    autoRestart: false,
    debuggingPort: await getPort(),
  });
  t.teardown(() => browserProcess.stop());
  await browserProcess.start();

  const oldDebuggerUrl = browserProcess.client!.webSocketUrl;

  const externalProvider = new ExternalBrowserProvider({
    debuggerUrl: oldDebuggerUrl,
    reconnectBackoffFactory: () => new FlatBackoff(500),
  });
  t.teardown(() => externalProvider.close());

  await externalProvider.start();

  const handle = (await externalProvider.createHandle())!;
  t.not(handle, null);
  t.truthy(handle.client.Browser.getVersion());

  const disconnected = onEvent(externalProvider, 'disconnect');
  await browserProcess.stop();
  await disconnected;

  // Allow external provider to make an unsuccessful reconnect attempt.
  await onEvent(
    externalProvider,
    'fault',
    (data: ExternalBrowserFaultEvent) => data.type === ExternalBrowserFaultType.Connect
  );

  await browserProcess.start();
  const newDebuggerUrl = browserProcess.client!.webSocketUrl;
  t.not(newDebuggerUrl, oldDebuggerUrl);

  await onEvent(
    externalProvider,
    'fault',
    (data: ExternalBrowserFaultEvent) => data.type === ExternalBrowserFaultType.Connect
  );
});

test('open lots of handles', async t => {
  const externalProvider = new ExternalBrowserProvider({
    host: 'localhost',
    port: browserProcess!.port,
  });
  t.teardown(() => externalProvider.close());

  await externalProvider.start();

  const handles = new Array<BrowserHandle>(500);

  for (let i = 0; i < handles.length; i++) {
    const handle = (await externalProvider.createHandle())!;
    t.not(handle, null);
    handles[i] = handle;
  }
  t.is(externalProvider.handles.size, handles.length);

  for (const handle of handles) {
    t.truthy(await handle.client.Browser.getVersion());
  }

  await externalProvider.close();
  t.is(externalProvider.handles.size, 0);
});

class DoNothingHttpServer {
  private _server: http.Server;

  public constructor(requestListener?: http.RequestListener) {
    this._server = http.createServer(requestListener);
  }

  public listen(port: number) {
    return new Promise<void>((resolve, reject) => {
      const errorListener = (err: Error) => reject(err);
      this._server.once('error', errorListener);
      this._server.listen(port, () => {
        this._server.removeListener('error', errorListener);
        resolve();
      });
    });
  }

  public close() {
    return new Promise<void>((resolve, reject) => {
      this._server.close(err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

function recordEvents(provider: ExternalBrowserProvider) {
  // Use record to get exhaustive list of all keys.
  const keysHelper: Record<keyof ExternalBrowserProviderEvents, null> = {
    close: null,
    closing: null,
    connect: null,
    disconnect: null,
    fault: null,
    start: null,
    starting: null,
  };
  const keys = Object.keys(keysHelper) as (keyof ExternalBrowserProviderEvents)[];
  const recorder = new EventRecorder<ExternalBrowserProviderEvents>(provider, keys);
  return recorder;
}
