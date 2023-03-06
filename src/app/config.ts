import { JSONSchemaType } from 'ajv';
import { FastifyInstance } from 'fastify';
import defaults from '../defaults.js';
import { CompletionTriggerConfig, CompletionTriggerType } from '../render/pageload/config.js';
import YAML from 'yaml';
import { LevelWithSilent } from 'pino';
import * as fs from 'node:fs';
import Ajv from 'ajv';
import * as AjvType from 'ajv';
import { Throwable } from '../support/types/utilities.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Readonly<Config>;
  }
}

export async function setupConfig(fastify: FastifyInstance, config: Config) {
  fastify.decorate('config', config);
}

export async function readConfig(configPath: string | false) {
  const input = await parseConfigFile(configPath);

  const config: Config = {
    app: {
      port: input.app?.port ?? defaults.app.port,
      host: input.app?.host ?? defaults.app.host,
      logLevel: input.app?.logLevel ?? (defaults.app.logLevel as LevelWithSilent),
      swaggerEnabled: input.app?.swaggerEnabled ?? defaults.app.swaggerEnabled,
    },
    browser: {
      provider: makeBrowserPrviderConfig(input),
      userAgent: input.browser?.userAgent ?? undefined,
      width: input.browser?.width ?? defaults.browser.width,
      height: input.browser?.height ?? defaults.browser.height,
    },
    render: {
      pageLoadTimeoutMillis: input.render?.pageLoadTimeoutMillis ?? defaults.pageLoadTimeoutMillis,
      allowPartiaLoad: input.render?.allowPartiaLoad ?? defaults.allowPartialLoad,
      freshBrowserContext: input.render?.freshBrowserContext ?? defaults.freshBrowserContext,
      scriptToEvaluateOnNewDocument: input.render?.scriptToEvaluateOnNewDocument ?? undefined,
      expectedStatusCodes: input.render?.expectedStatusCodes ?? undefined,
      completionTrigger: makeCompletionTriggerConfig(input),
    },
  };

  return config;
}

async function parseConfigFile(configPath: string | false): Promise<InputConfig> {
  if (configPath === false) {
    return {};
  }
  let yaml: string | undefined = undefined;
  try {
    yaml = await fs.promises.readFile(configPath, { encoding: 'utf-8' });
  } catch (e: Throwable) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
  }

  let input: unknown = {};
  if (yaml !== undefined) {
    input = YAML.parse(yaml) ?? input;
  }

  const ajv: AjvType.default = new (Ajv as any)({
    discriminator: true,
    allErrors: true,
  });

  const validate = ajv.compile(inputSchema);
  if (!validate(input)) {
    const message = validate.errors!.map(e => `${e.instancePath} ${e.message}`).join('\n');
    throw new Error(`Configuration is invalid:\n${message}`);
  }

  return input;
}

function makeBrowserPrviderConfig(input: InputConfig): BrowserProviderConfig {
  const inputProviderConfig = input.browser?.provider ?? null;
  const type = inputProviderConfig?.type ?? defaults.browser.providerType;
  switch (type) {
    case BrowserProviderType.Internal: {
      const provider = input.browser?.provider as InputInternalBrowserProviderConfig | undefined;
      return {
        type,
        debuggingPort1: provider?.debuggingPort1 ?? defaults.browser.provider.internal.debuggingPort1,
        debuggingPort2: provider?.debuggingPort2 ?? defaults.browser.provider.internal.debuggingPort2,
        chromePath: provider?.chromePath ?? undefined,
        recycleDrainMillis: provider?.recycleDrainMillis ?? defaults.browser.provider.internal.recycleDrainMillis,
        autoRecycleEnabled: provider?.autoRecycleEnabled ?? defaults.browser.provider.internal.autoRecycleEnabled,
        autoRecycleAfterUptimeMillis:
          provider?.autoRecycleAfterUptimeMillis ?? defaults.browser.provider.internal.autoRecycleAfterUptimeMillis,
        autoRecycleRetryAfterMillis:
          provider?.autoRecycleRetryAfterMillis ?? defaults.browser.provider.internal.autoRecycleRetryAfterMillis,
        additionalArgs: provider?.additionalArgs ?? undefined,
        overrideArgs: provider?.overrideArgs ?? undefined,
      };
    }
    case BrowserProviderType.ExternalHostPort: {
      const provider = input.browser?.provider as InputExternalBrowserProviderHostPortConfig | undefined;
      return {
        type,
        host: provider?.host ?? defaults.browser.provider.external_host_port.host,
        port: provider?.port ?? defaults.browser.provider.external_host_port.port,
        secure: provider?.secure ?? defaults.browser.provider.external_host_port.secure,
        reconnectIntervalMillis:
          provider?.reconnectIntervalMillis ?? defaults.browser.externalProviderReconnectIntervalMillis,
      };
    }
    case BrowserProviderType.ExternalStaticUrl: {
      const provider = input.browser?.provider as InputExternalBrowserProviderUrlConfig;
      return {
        type,
        staticDebuggerUrl: provider?.staticDebuggerUrl,
        reconnectIntervalMillis:
          provider?.reconnectIntervalMillis ?? defaults.browser.externalProviderReconnectIntervalMillis,
      };
    }
  }
}

function makeCompletionTriggerConfig(input: InputConfig): Required<CompletionTriggerConfig> {
  const type = input.render?.completionTrigger?.type ?? defaults.completionTriggerType;
  switch (type) {
    case CompletionTriggerType.Event: {
      const trigger = input.render?.completionTrigger as InputEventCompletionTriggerConfig | undefined;
      return {
        type,
        eventName: trigger?.eventName ?? defaults.completionTrigger.event.eventName,
        target: trigger?.eventName ?? defaults.completionTrigger.event.eventName,
      };
    }
    case CompletionTriggerType.Requests: {
      const trigger = input.render?.completionTrigger as InputRequestsCompletionTriggerConfig | undefined;
      return {
        type,
        waitAfterLastRequestMillis:
          trigger?.waitAfterLastRequestMillis ?? defaults.completionTrigger.requests.waitAfterLastRequestMillis,
      };
    }
    case CompletionTriggerType.Variable: {
      const trigger = input.render?.completionTrigger as InputVariableCompletionTriggerConfig | undefined;
      return {
        type,
        varName: trigger?.varName ?? defaults.completionTrigger.variable.varName,
      };
    }
  }
}

const logLevels: LevelWithSilent[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

export interface Config {
  app: Readonly<AppConfig>;
  browser: Readonly<BrowserConfig>;
  render: Readonly<RenderConfig>;
}

export interface AppConfig {
  port: number;
  host: string;
  logLevel: LevelWithSilent;
  swaggerEnabled: boolean;
}

export interface BrowserConfig {
  width: number;
  height: number;
  userAgent?: string;
  provider: Readonly<BrowserProviderConfig>;
}

export interface RenderConfig {
  pageLoadTimeoutMillis: number;
  allowPartiaLoad: boolean;
  freshBrowserContext: boolean;
  scriptToEvaluateOnNewDocument?: string;
  expectedStatusCodes?: readonly number[];
  completionTrigger: Required<CompletionTriggerConfig>;
}

export type BrowserProviderConfig =
  | InternalBrowserProviderConfig
  | ExternalBrowserProviderUrlConfig
  | ExternalBrowserProviderHostPortConfig;

export enum BrowserProviderType {
  Internal = 'internal',
  ExternalHostPort = 'external_host_port',
  ExternalStaticUrl = 'external_static_url',
}

export interface InternalBrowserProviderConfig {
  type: BrowserProviderType.Internal;
  debuggingPort1: number;
  debuggingPort2: number;
  autoRecycleEnabled: boolean;
  autoRecycleAfterUptimeMillis: number;
  autoRecycleRetryAfterMillis: number;
  recycleDrainMillis: number;
  chromePath?: string;
  additionalArgs?: readonly string[];
  overrideArgs?: readonly string[];
}

export interface ExternalBrowserProviderBaseConfig {
  reconnectIntervalMillis: number;
}

export interface ExternalBrowserProviderUrlConfig extends ExternalBrowserProviderBaseConfig {
  type: BrowserProviderType.ExternalStaticUrl;
  staticDebuggerUrl: string;
}

export interface ExternalBrowserProviderHostPortConfig extends ExternalBrowserProviderBaseConfig {
  type: BrowserProviderType.ExternalHostPort;
  host: string;
  port: number;
  secure: boolean;
}

/**
 * The definition for reading the config file.
 */
export interface InputConfig {
  app?: InputAppConfig | null;
  browser?: InputBrowserConfig | null;
  render?: InputRenderConfig | null;
}

export interface InputAppConfig {
  port?: number | null;
  host?: string | null;
  logLevel?: LevelWithSilent | null;
  swaggerEnabled?: boolean | null;
}

export interface InputBrowserConfig {
  provider?: InputBrowserProviderConfig | null;
  width?: number | null;
  height?: number | null;
  userAgent?: string | null;
}

export type InputBrowserProviderConfig =
  | InputInternalBrowserProviderConfig
  | InputExternalBrowserProviderUrlConfig
  | InputExternalBrowserProviderHostPortConfig;

export interface InputInternalBrowserProviderConfig {
  type: BrowserProviderType.Internal;
  debuggingPort1?: number | null;
  debuggingPort2?: number | null;
  autoRecycleEnabled?: boolean | null;
  autoRecycleAfterUptimeMillis?: number | null;
  autoRecycleRetryAfterMillis?: number | null;
  recycleDrainMillis?: number | null;
  chromePath?: string | null;
  additionalArgs?: string[] | null;
  overrideArgs?: string[] | null;
}

export interface InputExternalBrowserProviderBaseConfig {
  reconnectIntervalMillis?: number | null;
}

export interface InputExternalBrowserProviderUrlConfig extends InputExternalBrowserProviderBaseConfig {
  type: BrowserProviderType.ExternalStaticUrl;
  staticDebuggerUrl: string;
}

export interface InputExternalBrowserProviderHostPortConfig extends InputExternalBrowserProviderBaseConfig {
  type: BrowserProviderType.ExternalHostPort;
  host?: string | null;
  port?: number | null;
  secure?: boolean | null;
}

export interface InputRenderConfig {
  pageLoadTimeoutMillis?: number | null;
  allowPartiaLoad?: boolean | null;
  freshBrowserContext?: boolean | null;
  scriptToEvaluateOnNewDocument?: string | null;
  expectedStatusCodes?: number[] | null;
  completionTrigger?:
    | InputEventCompletionTriggerConfig
    | InputRequestsCompletionTriggerConfig
    | InputVariableCompletionTriggerConfig;
}

export interface InputEventCompletionTriggerConfig {
  type: CompletionTriggerType.Event;
  target: string | null;
  eventName: string | null;
}

export interface InputRequestsCompletionTriggerConfig {
  type: CompletionTriggerType.Requests;
  waitAfterLastRequestMillis: number | null;
}

export interface InputVariableCompletionTriggerConfig {
  type: CompletionTriggerType.Variable;
  varName: string | null;
}

const inputSchema: JSONSchemaType<InputConfig> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    app: {
      type: 'object',
      additionalProperties: false,
      nullable: true,
      properties: {
        logLevel: { type: 'string', nullable: true, enum: logLevels },
        port: { type: 'integer', nullable: true },
        host: { type: 'string', nullable: true },
        swaggerEnabled: { type: 'boolean', nullable: true },
      },
    },
    browser: {
      type: 'object',
      additionalProperties: false,
      nullable: true,
      properties: {
        provider: {
          type: 'object',
          additionalProperties: false,
          nullable: true,
          discriminator: { propertyName: 'type' },
          required: ['type'],
          oneOf: [
            {
              type: 'object',
              properties: {
                type: { type: 'string', const: BrowserProviderType.Internal },
                debuggingPort1: { type: 'integer', nullable: true },
                debuggingPort2: { type: 'integer', nullable: true },
                autoRecycleEnabled: { type: 'boolean', nullable: true },
                autoRecycleAfterUptimeMillis: { type: 'integer', nullable: true, minimum: 0 },
                autoRecycleRetryAfterMillis: { type: 'integer', nullable: true, minimum: 0 },
                recycleDrainMillis: { type: 'integer', nullable: true, minimum: 0 },
                chromePath: { type: 'string', nullable: true },
                additionalArgs: { type: 'array', items: { type: 'string' }, nullable: true },
                overrideArgs: { type: 'array', items: { type: 'string' }, nullable: true },
              },
            },
            {
              type: 'object',
              required: ['staticDebuggerUrl'],
              properties: {
                type: { type: 'string', const: BrowserProviderType.ExternalStaticUrl },
                staticDebuggerUrl: { type: 'string' },
                reconnectIntervalMillis: { type: 'number', nullable: true, minimum: 0 },
              },
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', const: BrowserProviderType.ExternalHostPort },
                host: { type: 'string', nullable: true },
                port: { type: 'number', nullable: true },
                secure: { type: 'boolean', nullable: true },
                reconnectIntervalMillis: { type: 'number', nullable: true, minimum: 0 },
              },
            },
          ],
        },
        width: { type: 'integer', nullable: true, minimum: 160 },
        height: { type: 'integer', nullable: true, minimum: 160 },
        userAgent: { type: 'string', nullable: true },
      },
    },
    render: {
      type: 'object',
      additionalProperties: false,
      nullable: true,
      properties: {
        allowPartiaLoad: { type: 'boolean', nullable: true },
        expectedStatusCodes: { type: 'array', items: { type: 'integer' }, nullable: true },
        freshBrowserContext: { type: 'boolean', nullable: true },
        pageLoadTimeoutMillis: { type: 'integer', nullable: true, minimum: 0 },
        scriptToEvaluateOnNewDocument: { type: 'string', nullable: true },
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
    },
  },
};
