import { CompletionTrigger } from './abstract.js';
import { CompletionType } from './config.js';

export class AlwaysCompletionTrigger extends CompletionTrigger {
  public constructor() {
    super();
  }

  public async wait() {
    return CompletionType.Always;
  }
}
