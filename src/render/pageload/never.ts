import { never } from '../../support/promise.js';
import { CompletionTrigger } from './abstract.js';
import { CompletionType } from './config.js';

export class NeverCompletionTrigger extends CompletionTrigger {
  public constructor() {
    super();
  }

  public async wait() {
    await never;
    return CompletionType.Never;
  }
}
