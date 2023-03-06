import test from 'ava';
import { BrowserProcess } from '../browser/process.js';
import config from '../test/config.js';
import { render, RenderErrorResult, RenderErrorType, RenderHtmlResult, RenderResult, TabRenderOptions } from './tab.js';
import prettier from 'prettier';
import { RequestsCompletionTrigger } from './pageload/requests.js';
import { VariableCompletionTrigger } from './pageload/variable.js';
import { EventCompletionTrigger } from './pageload/event.js';
import * as path from 'node:path';
import { LoadedRequest, RequestReadyState } from '../browser/requests.js';
import { NeverCompletionTrigger } from './pageload/never.js';
import getPort from '@ava/get-port';
import { nullLogger } from '../support/logging.js';
import { CompletionType } from './pageload/config.js';
import { MarkRequired } from 'ts-essentials';
import { AlwaysCompletionTrigger } from './pageload/always.js';
import { initialize } from '../test/extensions.js';
import { onEvent, PromiseSource } from '../support/promise.js';
import { CdpClient } from '../support/cdp.js';

initialize(test, { maxConcurrency: 8 });

const { testBaseUrl, testBaseUrlHttps } = config;

const defaultTabRenderOptions: MarkRequired<Partial<TabRenderOptions>, 'logger'> = {
  browserHeight: undefined,
  logger: nullLogger,
  pageLoadTimeoutMillis: 3000,
  completionTriggerFactory: () => new NeverCompletionTrigger(),
};

let browserProcess: BrowserProcess | null = null;

test.before('start chrome', async () => {
  const port = await getPort();
  browserProcess = new BrowserProcess({
    debuggingPort: port,
  });
  await browserProcess.start();
});

test.after.always('stop chrome', async () => {
  if (browserProcess !== null) {
    await browserProcess.stop();
    browserProcess = null;
  }
});

test('requests completion trigger', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/wait-requests`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new RequestsCompletionTrigger(500),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  const actualHtml = prettier.format(renderResult.html, { parser: 'html' });
  const expectedHtml = getExpectedHtml(
    `<h1>Test - wait for requests</h1>
<img src="/assets/smiley.png" />
<img src="/assets/circle.png" />
<script>
  setTimeout(() => {
    const img = document.createElement("img");
    img.src = "/assets/square.png";
    document.body.appendChild(img);
  }, 100);

  setTimeout(() => {
    const img = document.createElement("img");
    img.src = "/assets/triangle.png";
    document.body.appendChild(img);
  }, 200);
</script>

<img src="/assets/square.png" /><img src="/assets/triangle.png" />`
  );
  t.is(actualHtml, expectedHtml);
  t.is(renderResult.completion, CompletionType.Requests);
});

test('requests completion trigger but requests never end', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/wait-requests-never-end`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new RequestsCompletionTrigger(1000),
  })) as RenderErrorResult;

  t.false(renderResult.ok);
  t.is(renderResult.type, RenderErrorType.Timeout);
  t.is(renderResult.httpStatus, 200);
});

test('requests completion trigger but requests inside an iframe never end', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/iframe-requests-never-end`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new RequestsCompletionTrigger(1000),
  })) as RenderErrorResult;

  t.false(renderResult.ok);
  t.is(renderResult.type, RenderErrorType.Timeout);
  t.is(renderResult.httpStatus, 200);
});

test('variable completion trigger', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/completed-by-variable`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new VariableCompletionTrigger('renderDoneVar'),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  const actualHtml = prettier.format(renderResult.html ?? '', { parser: 'html' });
  const expectedHtml = getExpectedHtml(
    `<h1>Test - wait for variable</h1>
<script>
  setTimeout(() => {
    window.renderDoneVar = true;
  }, 500);
</script>`
  );
  t.is(actualHtml, expectedHtml);
  t.is(renderResult.completion, CompletionType.Variable);
});

test('variable completion trigger that is never set', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/sample`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new VariableCompletionTrigger('renderDoneVar'),
  })) as RenderErrorResult;

  t.false(renderResult.ok);
  t.is(renderResult.type, RenderErrorType.Timeout);
  t.is(renderResult.httpStatus, 200);
});

test('event completion trigger', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/completed-by-event`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new EventCompletionTrigger('window', 'renderDoneEvent'),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  const actualHtml = prettier.format(renderResult.html ?? '', { parser: 'html' });
  const expectedHtml = getExpectedHtml(
    `<h1>Test - wait for event</h1>
<script>
  setTimeout(() => {
    window.dispatchEvent(new Event("renderDoneEvent"));
  }, 500);
</script>`
  );
  t.is(actualHtml, expectedHtml);
  t.is(renderResult.completion, CompletionType.Event);
});

test('event completion trigger that is never fired', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/sample`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new EventCompletionTrigger('window', 'renderDoneEvent'),
  })) as RenderErrorResult;

  t.false(renderResult.ok);
  t.is(renderResult.type, RenderErrorType.Timeout);
  t.is(renderResult.httpStatus, 200);
});

test('never completion trigger', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/sample`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new NeverCompletionTrigger(),
  })) as RenderErrorResult;

  t.false(renderResult.ok);
  t.is(renderResult.type, RenderErrorType.Timeout);
  t.is(renderResult.httpStatus, 200);
});

test('always completion trigger', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/sample`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new AlwaysCompletionTrigger(),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  t.is(renderResult.completion, CompletionType.Always);
});

test('run custom script', async t => {
  const script = `window.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = '<p>dumburz</p>';
    window.dispatchEvent(new Event('dumburz'));
  })`;
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/sample`,
    browserClient: browserProcess!.client!,
    scriptToEvaluateOnNewDocument: script,
    completionTriggerFactory: () => new EventCompletionTrigger('window', 'dumburz'),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  const actualHtml = prettier.format(renderResult.html ?? '', { parser: 'html' });
  const expectedHtml = getExpectedHtml(`<p>dumburz</p>`);
  t.is(actualHtml, expectedHtml);
  t.is(renderResult.completion, CompletionType.Event);
});

test('trigger event completion in custom script', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/sample`,
    browserClient: browserProcess!.client!,
    scriptToEvaluateOnNewDocument: 'window.dispatchEvent(new Event("renderDoneEvent"));',
    completionTriggerFactory: () => new EventCompletionTrigger('window', 'renderDoneEvent'),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  t.is(renderResult.html, '');
  t.is(renderResult.completion, CompletionType.Event);
});

test('trigger variable completion in custom script', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/sample`,
    browserClient: browserProcess!.client!,
    scriptToEvaluateOnNewDocument: 'window.renderDoneVar = true;',
    completionTriggerFactory: () => new VariableCompletionTrigger('renderDoneVar'),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  t.is(renderResult.html, '');
  t.is(renderResult.completion, CompletionType.Variable);
});

test('iframe', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/iframe`,
    browserClient: browserProcess!.client!,
    scriptToEvaluateOnNewDocument: 'console.log("custom " + (self === top));',
    completionTriggerFactory: () => new VariableCompletionTrigger('renderDoneVar'),
  })) as RenderHtmlResult;

  const actualHtml = prettier.format(renderResult.html ?? '', { parser: 'html' });
  const expectedHtml = getExpectedHtml(
    `<h1>IFrame</h1>
    <p id="content">2</p>
    <script>
      window.addEventListener("message", (event) => {
        if (event.origin !== document.location.origin || event.data !== "ok") {
          return;
        }
        document.getElementById("content").innerHTML = "2";
        window.renderDoneVar = true;
      });
    </script>
    <iframe
      id="embed"
      title="Embed"
      width="600"
      height="400"
      src="/tests/iframe-embed"
    >
    </iframe>`
  );
  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  t.is(actualHtml, expectedHtml);
  t.is(renderResult.completion, CompletionType.Variable);
});

test('vue', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/vue`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new EventCompletionTrigger('window', 'renderDoneEvent'),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  const actualHtml = prettier.format(renderResult.html ?? '', { parser: 'html' });
  const expectedHtml = getExpectedHtml({
    head: `<script src="/assets/vue/index.iife.js" defer=""></script>
    <link rel="stylesheet" href="/assets/vue/style.css">`,
    body: '<div id="app" data-v-app=""><h1>Hello, Vue!</h1><ul><li>0</li><li>1</li><li>2</li><li>3</li><li>4</li><li>5</li><li>6</li><li>7</li><li>8</li><li>9</li></ul></div>',
  });
  t.is(actualHtml, expectedHtml);
});

test('deterministic event', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/deterministic-event`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new EventCompletionTrigger('window', 'renderDoneEvent'),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  const actualHtml = prettier.format(renderResult.html ?? '', { parser: 'html' });
  const expectedHtml = getExpectedHtml(`<h1>Test - deterministic event</h1>
  <p id="content">2</p>
  <script>
    setTimeout(() => {
      const p = document.getElementById('content');
      p.innerHTML = '2';
      window.dispatchEvent(new Event('renderDoneEvent'));
      p.innerHTML = '3';
    }, 500);
  </script>`);
  t.is(actualHtml, expectedHtml);
});

test('deterministic variable', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/deterministic-variable`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new VariableCompletionTrigger('renderDoneVar'),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  const actualHtml = prettier.format(renderResult.html ?? '', { parser: 'html' });
  const expectedHtml = getExpectedHtml(`<h1>Test - deterministic variable</h1>
  <p id="content">2</p>
  <script>
    setTimeout(() => {
      const p = document.getElementById('content');
      p.innerHTML = '2';
      window.renderDoneVar = true;
      p.innerHTML = '3';
    }, 500);
  </script>`);
  t.is(actualHtml, expectedHtml);
});

test('synchronous event', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/synchronous-event`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new EventCompletionTrigger('window', 'renderDoneEvent'),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  const actualHtml = prettier.format(renderResult.html ?? '', { parser: 'html' });
  const expectedHtml = getExpectedHtml(`<h1>Test - synchronous event</h1>
  <p>1</p>
  <script>window.dispatchEvent(new Event('renderDoneEvent'));</script>`);
  t.is(actualHtml, expectedHtml);
});

test('synchronous variable', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/synchronous-variable`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new VariableCompletionTrigger('renderDoneVar'),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  const actualHtml = prettier.format(renderResult.html ?? '', { parser: 'html' });
  const expectedHtml = getExpectedHtml(`<h1>Test - synchronous variable</h1>
  <p>1</p>
  <script>window.renderDoneVar = true;</script>`);
  t.is(actualHtml, expectedHtml);
});

for (const expectedCodes of [[200], [200, 201, 202]]) {
  test(`render - expected status code ${expectedCodes.join(', ')}`, async t => {
    const renderResult = (await render({
      ...defaultTabRenderOptions,
      url: `${testBaseUrl}tests/sample`,
      browserClient: browserProcess!.client!,
      expectedStatusCodes: expectedCodes,
      completionTriggerFactory: () => new EventCompletionTrigger('window', 'load'),
    })) as RenderHtmlResult;

    t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
    t.is(renderResult.completion, CompletionType.Event);
    t.is(renderResult.httpStatus, 200);
  });
}

for (const expectedCodes of [[400], [500, 501, 503]]) {
  test(`render - wrong expected status code ${expectedCodes.join(', ')}`, async t => {
    const renderResult = (await render({
      ...defaultTabRenderOptions,
      url: `${testBaseUrl}tests/sample`,
      browserClient: browserProcess!.client!,
      expectedStatusCodes: expectedCodes,
      completionTriggerFactory: () => new EventCompletionTrigger('window', 'load'),
    })) as RenderErrorResult;

    t.false(renderResult.ok);
    t.is(renderResult.type, RenderErrorType.InitialRequestStatus);
  });
}

test('modals', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/modals`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new VariableCompletionTrigger('renderDoneVar'),
  })) as RenderHtmlResult;

  t.true(renderResult.ok, renderResultNotOkMessage(renderResult));
  const actualHtml = prettier.format(renderResult.html ?? '', { parser: 'html' });
  const expectedHtml = getExpectedHtml(
    `<h1>Test - modals</h1>
<script>
  confirm("1 - Confirm");
  confirm("2 - Confirm");
  confirm("3 - Confirm");
  alert("4 - Alert");
  alert("5 - Alert");
  confirm("6 - Confirm");
  prompt("7 - Prompt");
  alert("8 - Alert");
  prompt("9 - Prompt");
  prompt("10 - Prompt");
  const p = document.createElement("p");
  p.innerText = "Done";
  document.body.appendChild(p);
  window.renderDoneVar = true;
</script>
<p>Done</p>`
  );
  t.is(actualHtml, expectedHtml);
  t.is(renderResult.completion, CompletionType.Variable);
  t.is(renderResult.httpStatus, 200);
  t.is(renderResult.resolvedUrl, `${testBaseUrl}tests/modals`);
});

test('bad certificate', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: testBaseUrlHttps,
    browserClient: browserProcess!.client!,
  })) as RenderErrorResult;
  t.false(renderResult.ok);
  t.is(renderResult.type, RenderErrorType.InitialRequestFailed);
  t.is(renderResult.message, 'net::ERR_CERT_AUTHORITY_INVALID');
});

test('ssl protocol error', async t => {
  const url = new URL(testBaseUrl);
  url.protocol = 'https';
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: url.toString(),
    browserClient: browserProcess!.client!,
  })) as RenderErrorResult;
  t.false(renderResult.ok);
  t.is(renderResult.type, RenderErrorType.InitialRequestFailed);
  t.is(renderResult.message, 'net::ERR_SSL_PROTOCOL_ERROR');
});

test('browser cache', async t => {
  const results: RenderResult[] = [];
  for (let i = 0; i < 2; i++) {
    results.push(
      await render({
        ...defaultTabRenderOptions,
        debug: true,
        url: `${testBaseUrl}tests/browser-cache`,
        browserClient: browserProcess!.client!,
        completionTriggerFactory: () => new EventCompletionTrigger('window', 'load'),
        freshBrowserContext: false,
      })
    );
  }

  const [first, second] = results;
  t.true(first.ok);
  t.true(second.ok);

  const secondImageRequests = second.debug!.requests.filter(r => path.extname(new URL(r.url).pathname) === '.png');
  t.true(secondImageRequests.length > 0);

  for (const request of secondImageRequests) {
    t.is(request.readyState, RequestReadyState.Loaded);
    t.is((request as LoadedRequest).fromDiskCache, true);
  }
});

test('initial request timeout', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}wait-5s`,
    pageLoadTimeoutMillis: 4000,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new AlwaysCompletionTrigger(),
  })) as RenderErrorResult;

  t.false(renderResult.ok);
  t.is(renderResult.type, RenderErrorType.Timeout);
  t.is(renderResult.httpStatus, undefined);
});

test('initial request incomplete', async t => {
  const renderResult = (await render({
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}errors/incomplete-chunked-encoding`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new AlwaysCompletionTrigger(),
  })) as RenderErrorResult;

  t.false(renderResult.ok);
  t.is(renderResult.type, RenderErrorType.InitialRequestFailed);
  t.is(renderResult.httpStatus, 200);
  t.true(Object.keys(renderResult.headers ?? {}).length > 0);
  t.is(renderResult.message, 'net::ERR_INCOMPLETE_CHUNKED_ENCODING');
});

test('independent emulation parameters', async t => {
  const renderOptions: TabRenderOptions = {
    ...defaultTabRenderOptions,
    url: `${testBaseUrl}tests/sample`,
    browserClient: browserProcess!.client!,
    completionTriggerFactory: () => new VariableCompletionTrigger('renderDoneVar'),
  };

  const clientPromiseSource1 = new PromiseSource<CdpClient>();
  const clientPromiseSource2 = new PromiseSource<CdpClient>();

  const renderPromise1 = render({
    ...renderOptions,
    browserWidth: 1338,
    browserHeight: 911,
    onInitialRequest: ({ client }) => clientPromiseSource1.resolve(client),
  });

  const renderPromise2 = render({
    ...renderOptions,
    browserWidth: 1641,
    browserHeight: 781,
    onInitialRequest: ({ client }) => clientPromiseSource2.resolve(client),
  });

  const client1 = await clientPromiseSource1.promise;
  const client2 = await clientPromiseSource2.promise;

  const expression = `(() => {
    renderDoneVar = true;
    return JSON.stringify([window.screen.width, window.screen.height, window.innerWidth, window.innerHeight]);
  })()`;

  const dimensionsResult1 = await client1.Runtime.evaluate({ expression });
  const dimensionsResult2 = await client2.Runtime.evaluate({ expression });

  t.is(dimensionsResult1.exceptionDetails, undefined);
  t.is(dimensionsResult2.exceptionDetails, undefined);

  const dimensions1 = JSON.parse(dimensionsResult1.result.value);
  const dimensions2 = JSON.parse(dimensionsResult2.result.value);

  t.deepEqual(dimensions1, [1338, 911, 1338, 911]);
  t.deepEqual(dimensions2, [1641, 781, 1641, 781]);

  await renderPromise1;
  await renderPromise2;
});

function getExpectedHtml(sections: string | { body?: string; head?: string }) {
  let body = '';
  let head = '';
  if (typeof sections === 'string') {
    body = sections;
  } else {
    body = sections.body ?? '';
    head = sections.head ?? '';
  }
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Page title</title>
    ${head}
  </head>
  <body>${body}</body>
</html>
`;
  return prettier.format(html ?? '', { parser: 'html' });
}

function renderResultNotOkMessage(result: RenderHtmlResult) {
  const error = result as unknown as RenderErrorResult;
  return `error: ${error.type}, status: ${error.httpStatus}`;
}
