import test from 'ava';
import { BrowserSupervisor } from '../browser/providers/supervisor.js';
import defaults from '../defaults.js';
import getPort from '@ava/get-port';
import config from '../test/config.js';
import { asyncMap } from '../test/support/promise.js';
import { RenderManager } from './manager.js';
import { EventCompletionTrigger } from './pageload/event.js';
import { RenderHtmlResult } from './tab.js';
import { initialize } from '../test/extensions.js';

initialize(test, { maxConcurrency: 4 });

const { testBaseUrl } = config;

test('example', async t => {
  const port1 = await getPort();
  const port2 = await getPort();
  const manager = new RenderManager({
    browserProviderFactory: () =>
      new BrowserSupervisor({
        debuggingPort1: port1,
        debuggingPort2: port2,
        autoRecycle: false,
        recycleDrainMillis: defaults.browser.provider.internal.recycleDrainMillis,
      }),
  });

  await manager.start();

  const requests = Array.from({ length: 100 });
  const results = await asyncMap(
    requests,
    async (_, i) => {
      return (await manager.render({
        url: `${testBaseUrl}ok?n=${i}`,
        completionTriggerFactory: () => new EventCompletionTrigger('window', 'load'),
      })) as RenderHtmlResult;
    },
    { maxConcurrency: 8 }
  );

  for (const result of results) {
    t.is(result.ok, true);
    t.is(result.httpStatus, 200);
    t.is(result.html, '<html><head></head><body>ok</body></html>');
  }
});
