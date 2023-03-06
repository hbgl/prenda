export type CompletionTriggerConfig =
  | RequestCompletionTriggerConfig
  | EventCompletionTriggerConfig
  | VariableCompletionTriggerConfig;

export enum CompletionTriggerType {
  Variable = 'variable',
  Event = 'event',
  Requests = 'requests',
  Never = 'never',
  Always = 'always',
}

export enum CompletionType {
  Variable = 'variable',
  Event = 'event',
  Requests = 'requests',
  PageLoadTimeout = 'page_load_timeout',
  Never = 'never',
  Always = 'always',
}

export interface RequestCompletionTriggerConfig {
  type: CompletionTriggerType.Requests;
  waitAfterLastRequestMillis?: number;
}

export interface EventCompletionTriggerConfig {
  type: CompletionTriggerType.Event;
  target?: string;
  eventName?: string;
}

export interface VariableCompletionTriggerConfig {
  type: CompletionTriggerType.Variable;
  varName?: string;
}
