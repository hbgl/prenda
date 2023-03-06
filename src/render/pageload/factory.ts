import defaults from '../../defaults.js';
import { CompletionTriggerConfig, CompletionTriggerType, CompletionType } from './config.js';
import { EventCompletionTrigger } from './event.js';
import { RequestsCompletionTrigger } from './requests.js';
import { VariableCompletionTrigger } from './variable.js';

export function makeCompletionTriggerFactory(config: CompletionTriggerConfig) {
  switch (config.type) {
    case CompletionTriggerType.Event:
      return () =>
        new EventCompletionTrigger(
          config.target ?? defaults.completionTrigger.event.target,
          config.eventName ?? defaults.completionTrigger.event.eventName
        );
    case CompletionTriggerType.Requests:
      return () =>
        new RequestsCompletionTrigger(
          config.waitAfterLastRequestMillis ?? defaults.completionTrigger.requests.waitAfterLastRequestMillis
        );
    case CompletionTriggerType.Variable:
      return () => new VariableCompletionTrigger(config.varName ?? defaults.completionTrigger.variable.varName);
  }
}

export const defaultCompletionTriggerFactory = makeCompletionTriggerFactory({
  type: defaults.completionTriggerType,
});
