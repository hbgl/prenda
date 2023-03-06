import {
  BrowserProviderType,
  ExternalBrowserProviderHostPortConfig,
  InternalBrowserProviderConfig,
} from './app/config.js';
import {
  CompletionTriggerType,
  EventCompletionTriggerConfig,
  RequestCompletionTriggerConfig,
  VariableCompletionTriggerConfig,
} from './render/pageload/config.js';
import { identity } from './support/types/utilities.js';
import { DeepReadonly } from 'ts-essentials';

const defaults = {
  pageLoadTimeoutMillis: 10 * 1000,
  allowPartialLoad: false,
  freshBrowserContext: false,
  app: {
    port: 8585,
    host: 'localhost',
    logLevel: 'info',
    swaggerEnabled: true,
  },
  browser: {
    width: 1920,
    height: 1080,
    providerType: BrowserProviderType.Internal as BrowserProviderType.Internal,
    provider: {
      internal: identity<Omit<InternalBrowserProviderConfig, 'type'>>({
        debuggingPort1: 9222,
        debuggingPort2: 9223,
        autoRecycleEnabled: true,
        autoRecycleAfterUptimeMillis: 30 * 60 * 1000,
        autoRecycleRetryAfterMillis: 10 * 1000,
        recycleDrainMillis: 60 * 1000,
      }),
      external_host_port: identity<Omit<ExternalBrowserProviderHostPortConfig, 'type' | 'reconnectIntervalMillis'>>({
        host: 'localhost',
        port: 9222,
        secure: false,
      }),
    },
    externalProviderReconnectIntervalMillis: 3000,
  },
  completionTriggerType: CompletionTriggerType.Requests as CompletionTriggerType.Requests,
  completionTrigger: {
    requests: identity<Required<Omit<RequestCompletionTriggerConfig, 'type'>>>({
      waitAfterLastRequestMillis: 2 * 1000,
    }),
    event: identity<Required<Omit<EventCompletionTriggerConfig, 'type'>>>({
      target: 'window',
      eventName: 'prerender_done',
    }),
    variable: identity<Required<Omit<VariableCompletionTriggerConfig, 'type'>>>({
      varName: 'prerender_done',
    }),
  },
};

export default defaults as DeepReadonly<typeof defaults>;
