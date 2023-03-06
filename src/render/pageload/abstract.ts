import { BrowserJs, DialogHandler } from '../../render/browser.js';
import { CdpClient } from '../../support/cdp.js';
import { Logger } from '../../support/logging.js';
import { CompletionType } from './config.js';

export abstract class CompletionTrigger {
  protected _options!: Readonly<CompletionTriggerInitOptions>;

  protected get _client() {
    return this._options.client;
  }

  public async init(options: Readonly<CompletionTriggerInitOptions>): Promise<void> {
    this._options = options;
  }

  public async close(): Promise<void> {
    // Nothing to do.
  }

  public abstract wait(): Promise<CompletionType>;
}

export interface CompletionTriggerInitOptions {
  client: CdpClient;
  browserJs: BrowserJs;
  dialogHandler: DialogHandler;
  logger: Logger;
}

export type CompletionTriggerFactory = () => CompletionTrigger;
