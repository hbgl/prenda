import { Defer } from '../support/defer.js';
import { render, RenderErrorResult, RenderErrorType, RenderResult } from './tab.js';
import { CompletionTriggerFactory } from './pageload/abstract.js';
import { Logger, nullLogger } from '../support/logging.js';
import { BrowserProvider, BrowserProviderFactory } from '../browser/providers/provider.js';

export class RenderManager {
  private _options: Readonly<RenderManagerOptionsInternal>;
  private _browserProvider: BrowserProvider;
  private _logger: Logger;

  constructor(options: Readonly<RenderManagerOptions>) {
    this._logger = options.logger ?? nullLogger;
    this._options = {
      ...options,
      logger: options.logger ?? nullLogger,
    };
    this._browserProvider = options.browserProviderFactory();
  }

  public get status() {
    return this._browserProvider.status;
  }

  public async start() {
    this._logger.info('Render manager starting.');
    await this._browserProvider.start();
    this._logger.info('Render manager started.');
  }

  public async stop() {
    this._logger.info('Render manager stopping.');
    await this._browserProvider.close();
    this._logger.info('Render manager stopped.');
  }

  public async render(options: RenderCallOptions): Promise<RenderResult> {
    return await Defer.asyncScope(async defer => {
      const browserHandle = await this._browserProvider.createHandle();
      if (browserHandle === null) {
        return RenderErrorResult.create({
          type: RenderErrorType.BrowserUnavailable,
        });
      }
      defer.add(() => browserHandle.close());

      const result = await render({
        logger: this._options.logger,
        url: options.url,
        browserClient: browserHandle.client,
        allowPartialLoad: options.allowPartialLoad ?? this._options.allowPartialLoad,
        browserHeight: options.browserHeight ?? this._options.browserHeight,
        browserWidth: options.browserWidth ?? this._options.browserWidth,
        completionTriggerFactory: options.completionTriggerFactory ?? this._options.completionTriggerFactory,
        expectedStatusCodes: options.expectedStatusCodes ?? this._options.expectedStatusCodes,
        freshBrowserContext: options.freshBrowserContext ?? this._options.freshBrowserContext,
        pageLoadTimeoutMillis: options.pageLoadTimeoutMillis ?? this._options.pageLoadTimeoutMillis,
        scriptToEvaluateOnNewDocument:
          options.scriptToEvaluateOnNewDocument ?? this._options.scriptToEvaluateOnNewDocument,
      });

      return result;
    });
  }
}

export interface RenderManagerOptions {
  browserProviderFactory: BrowserProviderFactory;
  logger?: Logger;
  pageLoadTimeoutMillis?: number;
  browserWidth?: number;
  browserHeight?: number;
  allowPartialLoad?: boolean;
  userAgent?: string;
  freshBrowserContext?: boolean;
  completionTriggerFactory?: CompletionTriggerFactory;
  expectedStatusCodes?: ReadonlyArray<number>;
  scriptToEvaluateOnNewDocument?: string;
}

interface RenderManagerOptionsInternal extends RenderManagerOptions {
  logger: Logger;
}

export interface RenderCallOptions {
  url: string;
  pageLoadTimeoutMillis?: number;
  browserWidth?: number;
  browserHeight?: number;
  allowPartialLoad?: boolean;
  freshBrowserContext?: boolean;
  completionTriggerFactory?: CompletionTriggerFactory;
  expectedStatusCodes?: ReadonlyArray<number>;
  scriptToEvaluateOnNewDocument?: string;
}
