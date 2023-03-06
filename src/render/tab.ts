import { Protocol } from 'devtools-protocol';
import { LogicError } from '../support/errors/common.js';
import { CancelToken, withTimeoutAsResult, willTimeout } from '../support/promise.js';
import { Stopwatch } from '../support/stopwatch.js';
import { CompletionTrigger, CompletionTriggerFactory } from './pageload/abstract.js';
import { RequestWatcher, Request, RequestReadyState, LoadedRequest } from '../browser/requests.js';
import { randomString64 } from '../support/crypto.js';
import { BrowserJs, DialogHandler } from './browser.js';
import { Logger } from '../support/logging.js';
import defaults from '../defaults.js';
import { CompletionType } from './pageload/config.js';
import { defaultCompletionTriggerFactory } from './pageload/factory.js';
import { CdpClient, createCdpClient } from '../support/cdp.js';

export async function render(options: Readonly<TabRenderOptions>) {
  const tab = new TabRenderer(options);
  return await tab.render();
}

class TabRenderer {
  private _url: string;
  private _resolvedUrl: string | null = null;
  private _options: Readonly<TabRenderOptionsInternal>;
  private _browserClient: CdpClient;
  private _browserContext: Protocol.Target.CreateBrowserContextResponse | null = null;
  private _target: Protocol.Target.CreateTargetResponse | null = null;
  private _client: CdpClient | null = null;
  private _domContentLoaded = false;
  private _requestWatcher: RequestWatcher;
  private _startedAt: bigint | null = null;
  private _completion: CompletionType | null = null;
  private _html: string | null = null;
  private _error: RenderError | null = null;
  private _perf: RendererPerfEntry[] = [];
  private _consoleMessages: Protocol.Console.ConsoleMessage[] = [];
  private _completionTrigger: CompletionTrigger;
  private _browserJs: BrowserJs;
  private _dialogHandler: DialogHandler;
  private _logger: Logger;

  public constructor(options: Readonly<TabRenderOptions>) {
    this._url = options.url;
    this._browserClient = options.browserClient;
    this._options = {
      ...options,
      allowPartialLoad: options.allowPartialLoad ?? defaults.allowPartialLoad,
      browserHeight: options.browserHeight ?? defaults.browser.height,
      browserWidth: options.browserWidth ?? defaults.browser.width,
      pageLoadTimeoutMillis: options.pageLoadTimeoutMillis ?? defaults.pageLoadTimeoutMillis,
      completionTriggerFactory: options.completionTriggerFactory ?? defaultCompletionTriggerFactory,
      freshBrowserContext: options.freshBrowserContext ?? defaults.freshBrowserContext,
      debug: options.debug ?? false,
    };
    this._logger = this._options.logger;
    this._requestWatcher = new RequestWatcher({ onlyInitial: !this._options.debug });
    this._completionTrigger = this._options.completionTriggerFactory();
    this._browserJs = new BrowserJs({
      contextKey: `__prenda_context_${randomString64(32)}`,
    });
    this._dialogHandler = new DialogHandler();
  }

  public async render() {
    if (this._startedAt !== null) {
      throw new LogicError('Render may only be called once.');
    }
    this._startedAt = process.hrtime.bigint();
    await this.renderImpl();
    return this.getResult();
  }

  private async renderImpl() {
    try {
      const createTabStopwatch = Stopwatch.start();
      await this.createTab();
      this._perf.push({
        type: 'create_tab',
        elapsedMillis: createTabStopwatch.stopMillis(),
      });

      if (this._error !== null) {
        return;
      }

      const loadPageStopwatch = Stopwatch.start();
      const timeout = await willTimeout(this.loadPage(), this._options.pageLoadTimeoutMillis);
      this._perf.push({
        type: 'load_page',
        elapsedMillis: loadPageStopwatch.stopMillis(),
      });

      if (this._error !== null) {
        return;
      }

      if (timeout) {
        if (!this._domContentLoaded) {
          this._error = { type: RenderErrorType.Timeout, message: null };
          return;
        }
        if (!this._options.allowPartialLoad) {
          this._error = { type: RenderErrorType.Timeout, message: null };
          return;
        }
        this._completion = CompletionType.PageLoadTimeout;
      }

      const readHtmlStopwatch = Stopwatch.start();
      await this.readHtml();
      this._perf.push({
        type: 'read_html',
        elapsedMillis: readHtmlStopwatch.stopMillis(),
      });
    } finally {
      try {
        await this.close();
      } catch (e) {
        // TODO: Log leak.
      }
    }
  }

  private async createTab() {
    try {
      if (this._options.freshBrowserContext) {
        this._browserContext = await this._browserClient.Target.createBrowserContext({});
      }
      this._target = await this._browserClient.Target.createTarget({
        url: 'about:blank',
        browserContextId: this._browserContext?.browserContextId,
      });

      const targetUrl = new URL(this._browserClient.webSocketUrl);
      targetUrl.pathname = `/devtools/page/${encodeURIComponent(this._target!.targetId)}`;

      this._client = await createCdpClient({
        target: targetUrl.toString(),
      });

      const { Page, Network } = this._client;

      await Promise.all([Page.enable(), Network.enable({})]);

      if (this._options.debug) {
        const { Console } = this._client;
        await Console.enable();
        this._client.on('Console.messageAdded', params => {
          this._consoleMessages.push(params.message);
        });
      }

      // Handle dialogs like alert, confirm, prompt, etc.
      this._dialogHandler.init(this._client);

      Page.on('domContentEventFired', () => {
        this._domContentLoaded = true;
      });

      await Page.addScriptToEvaluateOnNewDocument({
        source: this._browserJs.init,
      });

      this._completionTrigger.init({
        client: this._client,
        browserJs: this._browserJs,
        dialogHandler: this._dialogHandler,
        logger: this._options.logger,
      });

      this._requestWatcher.watch(this._client);

      if (this._options.scriptToEvaluateOnNewDocument !== undefined) {
        await Page.addScriptToEvaluateOnNewDocument({
          source: this._options.scriptToEvaluateOnNewDocument,
        });
      }
    } catch (e) {
      this._error = {
        type: RenderErrorType.TabCreationFailed,
        message: (e as Error).message,
      };
    }
  }

  private async loadPage() {
    const { Emulation, Page } = this._client!;

    Emulation.setDeviceMetricsOverride({
      width: this._options.browserWidth,
      height: this._options.browserHeight,
      screenWidth: this._options.browserWidth,
      screenHeight: this._options.browserHeight,
      deviceScaleFactor: 0,
      mobile: false,
    });

    const cancelToken = CancelToken.when(() => this._error !== null);

    // Navigate to URL.
    await Page.navigate({ url: this._url });
    if (cancelToken.isCanceled()) {
      return;
    }

    // Verify that the initial request was successful.
    const initialRequest = await this._requestWatcher.initialRequestPromise;
    if (cancelToken.isCanceled()) {
      return;
    }

    this._resolvedUrl = initialRequest.url;
    if (initialRequest.readyState !== RequestReadyState.Loaded) {
      this._error = {
        type: RenderErrorType.InitialRequestFailed,
        message: initialRequest.errorText,
      };
      return;
    }
    if (!this.initialRequestStatusOk(initialRequest)) {
      this._error = {
        type: RenderErrorType.InitialRequestStatus,
        message: `HTTP status ${initialRequest.statusCode} of initial request is unexpected.`,
      };
      return;
    }

    if (this._options.onInitialRequest) {
      this._options.onInitialRequest({ client: this._client! });
    }

    const completion = await this._completionTrigger.wait();

    if (cancelToken.isCanceled()) {
      return;
    }
    this._completion = completion;
  }

  private async readHtml() {
    const { Runtime } = this._client!;

    const htmlResult = await Runtime.evaluate({
      expression: `${this._browserJs.getHtmlResult} ?? ${this._browserJs.readHtmlExpr}`,
    });
    const html = htmlResult.result.value ?? null;
    if (html === null) {
      throw new Error('Unable to read HTML from page.');
    }
    this._html = html;
  }

  private getResult(): RenderResult {
    const requests = [...this._requestWatcher.requests.values()];
    requests.sort((a, b) => {
      if (a.sentAt > b.sentAt) {
        return 1;
      }
      if (a.sentAt < b.sentAt) {
        return -1;
      }
      return 0;
    });

    let httpStatus: number | undefined = undefined;
    let headers: Record<string, string> | undefined = undefined;
    const initialRequest = this._requestWatcher.initialRequest;
    if (initialRequest && initialRequest.responseReceivedAt !== undefined) {
      httpStatus = initialRequest.statusCode;
      headers = { ...initialRequest.headers };
    }

    const result: RenderResultBase = {
      startedAt: this._startedAt!,
      completedAt: process.hrtime.bigint(),
      httpStatus,
      headers,
      debug: this._options.debug
        ? {
            perf: this._perf,
            requests,
            consoleMessages: this._consoleMessages,
          }
        : undefined,
    };

    if (this._error !== null) {
      const errorResult: RenderErrorResult = {
        ...result,
        ...this._error,
        ok: false,
      };
      return errorResult;
    }

    const htmlResult: RenderHtmlResult = {
      ...result,
      ok: true,
      resolvedUrl: this._resolvedUrl!,
      completion: this._completion!,
      headers: headers!,
      html: this._html!,
      httpStatus: httpStatus!,
    };

    return htmlResult;
  }

  private initialRequestStatusOk(request: LoadedRequest) {
    if (!this._options.expectedStatusCodes) {
      return true;
    }
    if (request.statusCode === null) {
      return false;
    }
    return this._options.expectedStatusCodes.includes(request.statusCode);
  }

  private async close() {
    try {
      this._dialogHandler.close();
    } catch (e: any) {
      this._logger.warn(`Unable to close dialog handler: ${e.message}`);
    }
    try {
      this._requestWatcher.close();
    } catch (e: any) {
      this._logger.warn(`Unable to close request watcher: ${e.message}`);
    }
    try {
      this._completionTrigger.close();
    } catch (e: any) {
      this._logger.warn(`Unable to close completion trigger: ${e.message}`);
    }
    if (this._client) {
      try {
        await this._client.close();
      } catch (e: any) {
        this._logger.warn(`Unable to close CDP client: ${e.message}`);
      }
    }
    if (this._target) {
      const targetId = this._target.targetId;
      try {
        await this._browserClient.Target.closeTarget({ targetId });
      } catch (e: any) {
        this._logger.warn(`Unable to close target ${targetId}: ${e.message}`);
      }
    }
    if (this._browserContext) {
      const browserContextId = this._browserContext.browserContextId;
      try {
        await this._browserClient.Target.disposeBrowserContext({
          browserContextId,
        });
      } catch (e: any) {
        this._logger.warn(`Unable to close browser context ${browserContextId}: ${e.message}`);
      }
    }
  }
}

export interface TabRenderOptions {
  url: string;
  browserClient: CdpClient;
  logger: Logger;
  browserWidth?: number;
  browserHeight?: number;
  allowPartialLoad?: boolean;
  pageLoadTimeoutMillis?: number;
  completionTriggerFactory?: CompletionTriggerFactory;
  expectedStatusCodes?: ReadonlyArray<number>;
  freshBrowserContext?: boolean;
  scriptToEvaluateOnNewDocument?: string;
  debug?: boolean;
  onInitialRequest?: (params: { client: CdpClient }) => void;
}

interface TabRenderOptionsInternal extends TabRenderOptions {
  url: string;
  browserClient: CdpClient;
  logger: Logger;
  browserWidth: number;
  browserHeight: number;
  allowPartialLoad: boolean;
  pageLoadTimeoutMillis: number;
  completionTriggerFactory: CompletionTriggerFactory;
  expectedStatusCodes?: ReadonlyArray<number>;
  freshBrowserContext: boolean;
  scriptToEvaluateOnNewDocument?: string;
  debug: boolean;
}

export enum RenderErrorType {
  TabCreationFailed = 'tab_creation_failed',
  InitialRequestFailed = 'initial_request_failed',
  InitialRequestStatus = 'initial_request_status',
  Timeout = 'timeout',
  BrowserUnavailable = 'browser_unavailable',
}

export interface RenderResultBase {
  startedAt: bigint;
  completedAt: bigint;
  debug?: RenderResultDebug;
  httpStatus?: number;
  headers?: Record<string, string>;
}

export interface RenderResultDebug {
  perf: RendererPerfEntry[];
  requests: Readonly<Request>[];
  consoleMessages?: Readonly<Protocol.Console.ConsoleMessage[]>;
}

export interface RenderError {
  type: RenderErrorType;
  message: string | null;
}

export interface RenderErrorResult extends RenderResultBase {
  ok: false;
  type: RenderErrorType;
  message: string | null;
}

export interface RenderErrorResultCreateProps {
  startedAt?: bigint;
  completedAt?: bigint;
  type: RenderErrorType;
  message?: string;
  perf?: RendererPerfEntry[];
  requests?: Readonly<Request>[];
}

export class RenderErrorResult {
  public static create(props: RenderErrorResultCreateProps): RenderErrorResult {
    let now: bigint | undefined = undefined;

    return {
      ok: false,
      startedAt: props.startedAt ?? now ?? (now = process.hrtime.bigint()),
      completedAt: props.completedAt ?? now ?? (now = process.hrtime.bigint()),
      type: props.type,
      message: props.type ?? null,
    };
  }
}

export interface RenderHtmlResult extends RenderResultBase {
  ok: true;
  resolvedUrl: string;
  httpStatus: number;
  headers: Record<string, string>;
  html: string;
  completion: CompletionType;
}

export type RenderResult = RenderHtmlResult | RenderErrorResult;

export interface RendererPerfEntry {
  type: 'create_tab' | 'load_page' | 'read_html';
  elapsedMillis: number;
}
