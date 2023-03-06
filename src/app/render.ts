import { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { JSONSchemaType } from 'ajv';
import { RenderManager } from '../render/manager.js';
import { CompletionTriggerFactory } from '../render/pageload/abstract.js';
import defaults from '../defaults.js';
import { ServiceError } from './error.js';
import { BrowserProviderConfig, BrowserProviderType } from './config.js';
import { CompletionTriggerConfig, CompletionTriggerType, CompletionType } from '../render/pageload/config.js';
import { makeCompletionTriggerFactory } from '../render/pageload/factory.js';
import { BrowserSupervisor } from '../browser/providers/supervisor.js';
import { ExternalBrowserProvider } from '../browser/providers/external.js';
import { FlatBackoff } from '../support/backoff.js';
import { identity } from '../support/types/utilities.js';
import { Logger } from '../support/logging.js';

export async function setupRender(fastify: FastifyInstance) {
  const { config, log: logger } = fastify;

  const renderManager = new RenderManager({
    browserProviderFactory: makeBrowserProviderFactory(config.browser.provider, logger),
    logger,
    allowPartialLoad: config.render.allowPartiaLoad,
    browserHeight: config.browser.height,
    browserWidth: config.browser.width,
    completionTriggerFactory: makeCompletionTriggerFactory(config.render.completionTrigger),
    freshBrowserContext: config.render.freshBrowserContext,
    pageLoadTimeoutMillis: config.render.pageLoadTimeoutMillis,
    expectedStatusCodes: config.render.expectedStatusCodes,
    scriptToEvaluateOnNewDocument: config.render.scriptToEvaluateOnNewDocument,
    userAgent: config.browser.userAgent,
  });

  fastify.addHook('onClose', async () => {
    await renderManager.stop();
  });

  await renderManager.start();

  fastify.post('/render', renderRouteOptions, async (request, reply) => {
    const body = request.body as RenderArgs;

    const result = await renderManager.render({
      url: body.url,
      allowPartialLoad: body.allowPartialLoad ?? undefined,
      browserHeight: body.browserHeight ?? undefined,
      browserWidth: body.browserWidth ?? undefined,
      completionTriggerFactory: makeCompletionTriggerFactoryFromRenderArgs(body),
      expectedStatusCodes: body.expectedStatusCodes ?? undefined,
      freshBrowserContext: body.freshBrowserContext ?? undefined,
      pageLoadTimeoutMillis: body.pageLoadTimeoutMillis ?? undefined,
      scriptToEvaluateOnNewDocument: body.scriptToEvaluateOnNewDocument ?? undefined,
    });

    if (result.ok) {
      reply.send(
        identity<RenderResponseHtml>({
          status: result.httpStatus,
          html: result.html,
          headers: result.headers,
          completed: result.completion !== CompletionType.PageLoadTimeout,
        })
      );
    } else {
      reply.status(500).send(
        identity<ServiceError>({
          code: result.type,
          message: result.message,
        })
      );
    }
  });
}

interface RenderArgs {
  url: string;
  pageLoadTimeoutMillis?: number | null;
  browserWidth?: number | null;
  browserHeight?: number | null;
  allowPartialLoad?: boolean | null;
  completionTrigger?: CompletionTriggerConfig | null;
  expectedStatusCodes?: ReadonlyArray<number> | null;
  freshBrowserContext?: boolean | null;
  scriptToEvaluateOnNewDocument?: string | null;
}

interface RenderResponseHtml {
  status: number;
  html: string;
  headers: Record<string, string>;
  completed: boolean;
}

const renderRouteOptions: RouteShorthandOptions = {
  schema: {
    description: 'Render a web page.',
    body: identity<JSONSchemaType<RenderArgs>>({
      $id: 'render-request',
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        pageLoadTimeoutMillis: { type: 'integer', nullable: true, minimum: 0 },
        browserWidth: { type: 'integer', nullable: true, minimum: 160 },
        browserHeight: { type: 'integer', nullable: true, minimum: 160 },
        allowPartialLoad: { type: 'boolean', nullable: true },
        freshBrowserContext: { type: 'boolean', nullable: true },
        scriptToEvaluateOnNewDocument: { type: 'string', nullable: true },
        expectedStatusCodes: {
          type: 'array',
          items: { type: 'integer' },
          nullable: true,
        },
        completionTrigger: {
          type: 'object',
          nullable: true,
          discriminator: { propertyName: 'type' },
          required: ['type'],
          oneOf: [
            {
              type: 'object',
              properties: {
                type: { type: 'string', const: CompletionTriggerType.Requests },
                waitAfterLastRequestMillis: { type: 'integer', nullable: true, minimum: 0 },
              },
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', const: CompletionTriggerType.Event },
                target: { type: 'string', nullable: true },
                eventName: { type: 'string', nullable: true },
              },
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', const: CompletionTriggerType.Variable },
                varName: { type: 'string', nullable: true },
              },
            },
          ],
        },
      },
      examples: [
        {
          url: 'https://example.com/',
          pageLoadTimeoutMillis: 8000,
          browserWidth: 1920,
          browserHeight: 1080,
          allowPartialLoad: false,
          freshBrowserContext: true,
          scriptToEvaluateOnNewDocument: "console.log('Hello!')",
          expectedStatusCodes: [200, 204],
          completionTrigger: {
            type: 'requests',
            waitAfterLastRequestMillis: 2000,
          },
        },
      ],
    }),
    response: {
      default: {
        $ref: 'service-error',
      } as JSONSchemaType<unknown>,
      '2xx': identity<JSONSchemaType<RenderResponseHtml>>({
        $id: 'render-response-html',
        type: 'object',
        required: ['status', 'html', 'headers'],
        properties: {
          status: { type: 'number' },
          html: { type: 'string' },
          headers: {
            type: 'object',
            required: [],
            patternProperties: {
              '^': { type: 'string' },
            },
          },
          completed: { type: 'boolean' },
        },
      }),
    },
  },
};

function makeBrowserProviderFactory(config: BrowserProviderConfig, logger: Logger) {
  switch (config.type) {
    case BrowserProviderType.Internal:
      return () =>
        new BrowserSupervisor({
          logger,
          debuggingPort1: config.debuggingPort1,
          debuggingPort2: config.debuggingPort2,
          chromePath: config.chromePath,
          autoRecycle: config.autoRecycleEnabled,
          autoRecycleAfterUptimeMillis: config.autoRecycleAfterUptimeMillis,
          autoRecycleRetryAfterMillis: config.autoRecycleRetryAfterMillis,
          recycleDrainMillis: config.recycleDrainMillis,
          additionalArgs: config.additionalArgs,
          overrideArgs: config.overrideArgs,
        });
    case BrowserProviderType.ExternalStaticUrl:
      return () =>
        new ExternalBrowserProvider({
          logger,
          reconnectBackoffFactory: () => new FlatBackoff(config.reconnectIntervalMillis),
          debuggerUrl: config.staticDebuggerUrl,
        });
    case BrowserProviderType.ExternalHostPort:
      return () =>
        new ExternalBrowserProvider({
          logger,
          reconnectBackoffFactory: () => new FlatBackoff(config.reconnectIntervalMillis),
          host: config.host,
          port: config.port,
          secure: config.secure,
        });
  }
}

function makeCompletionTriggerFactoryFromRenderArgs(renderArgs: RenderArgs): CompletionTriggerFactory | undefined {
  const input = renderArgs.completionTrigger;
  if (!input) {
    return undefined;
  }

  const fallback = defaults.completionTrigger[input.type];
  const config = { ...input };

  for (const key in fallback) {
    (config as any)[key] = (config as any)[key] ?? (fallback as any)[key];
  }

  return makeCompletionTriggerFactory(config);
}
