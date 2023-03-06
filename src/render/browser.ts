import { randomString64 } from '../support/crypto.js';
import { Protocol } from 'devtools-protocol';
import { PromiseSource } from '../support/promise.js';
import { LogicError } from '../support/errors/common.js';
import { CdpClient } from '../support/cdp.js';

export interface BrowserJsOptions {
  contextKey: string;
}

/**
 * Provides several helper methods to generate JavaScript snippets
 * for running in the remote-controlled browser.
 */
export class BrowserJs {
  private _options: BrowserJsOptions;

  public constructor(options: BrowserJsOptions) {
    this._options = options;
  }

  public get readHtmlExpr() {
    return `(() => {
  if (!document.documentElement) {
    return '';
  }
  let doctypeStr = '';
  if (document.doctype !== null) {
      doctypeStr = new XMLSerializer().serializeToString(document.doctype);
  }
  return doctypeStr + document.documentElement.outerHTML;
})()`;
  }

  public get saveHtmlResult() {
    return this.set(ContextKey.HTML, this.readHtmlExpr);
  }

  public get getHtmlResult() {
    return this.get(ContextKey.HTML);
  }

  public get init() {
    const contextKeyJs = JSON.stringify(this._options.contextKey);
    return `(() => {
  if (self !== top) {
    return;
  }
  if (window[${contextKeyJs}]) {
    return;
  }
  Object.defineProperty(window, ${contextKeyJs}, { value: {} });
})();`;
  }

  public set(key: string, valueExpr: string) {
    const contextKeyJs = JSON.stringify(this._options.contextKey);
    const keyJs = JSON.stringify(key);
    return `window[${contextKeyJs}][${keyJs}] = ${valueExpr};`;
  }

  public get(key: string) {
    const contextKeyJs = JSON.stringify(this._options.contextKey);
    const keyJs = JSON.stringify(key);
    return `window[${contextKeyJs}][${keyJs}]`;
  }

  public get keys() {
    const contextKeyJs = JSON.stringify(this._options.contextKey);
    return `Object.keys(window[${contextKeyJs}])`;
  }
}

enum ContextKey {
  HTML = 'html',
}

let uniqueVarNameCounter = BigInt(0);
export function uniqueVarName(name?: string) {
  const id = ++uniqueVarNameCounter;
  const suffix = name ? `_${name}` : '';
  return `var_${id}${suffix}`;
}

export class DialogHandler {
  private _client?: CdpClient;
  private _magicDialogs: Map<string, MagicDialogEntry> = new Map();
  private _status = DialogHandlerStatus.Initial;
  private _handlers = {
    'Page.javascriptDialogOpening': (params: Protocol.Page.JavascriptDialogOpeningEvent) => this.onDialogOpened(params),
    'Page.javascriptDialogClosed': (params: Protocol.Page.JavascriptDialogClosedEvent) => this.onDialogClosed(params),
  };

  private static _magicDialogCounter = 0;

  public init(client: CdpClient) {
    if (this._status !== DialogHandlerStatus.Initial) {
      throw new LogicError(`Cannot start dialog handler: Invalid state ${this._status}.`);
    }
    this._client = client;
    let key: keyof typeof this._handlers;
    for (key in this._handlers) {
      this._client.on(key, this._handlers[key]);
    }
  }

  public close() {
    if (this._status === DialogHandlerStatus.Initial) {
      this._status = DialogHandlerStatus.Stopped;
      return;
    }
    if (this._status === DialogHandlerStatus.Stopped) {
      return;
    }
    if (this._client) {
      let key: keyof typeof this._handlers;
      for (key in this._handlers) {
        this._client.removeListener(key, this._handlers[key]);
      }
    }
    this._client = undefined;
    this._magicDialogs.clear();
    this._status = DialogHandlerStatus.Stopped;
  }

  public registerMagicDialog() {
    const id = DialogHandler._magicDialogCounter++;
    const message = `__prenda_magic_dialog_${id}_${randomString64(40)}`;
    const promiseSource = new PromiseSource<void>();
    this._magicDialogs.set(message, { promiseSource });
    return new MagicDialogHandle(message, promiseSource.promise, this);
  }

  public unregisterMagicDialog(message: string) {
    return this._magicDialogs.delete(message);
  }

  private async onDialogOpened(event: Protocol.Page.JavascriptDialogOpeningEvent) {
    try {
      await this._client!.Page.handleJavaScriptDialog({
        accept: true,
        promptText: event.defaultPrompt,
      });
    } catch (e) {
      // TODO: Log
    }
  }

  private onDialogClosed(event: Protocol.Page.JavascriptDialogClosedEvent) {
    const magicDialog = this._magicDialogs.get(event.userInput);
    if (magicDialog) {
      this._magicDialogs.delete(event.userInput);
      magicDialog.promiseSource.resolve();
    }
  }
}

export enum DialogHandlerStatus {
  Initial = 'initial',
  Running = 'running',
  Stopped = 'closed',
}

interface MagicDialogEntry {
  promiseSource: PromiseSource<void>;
}

export class MagicDialogHandle {
  public readonly message: string;
  public readonly promise: Promise<void>;
  private _dialogHandler: DialogHandler;
  private _closed = false;

  public constructor(message: string, promise: Promise<void>, dialogHandler: DialogHandler) {
    this.message = message;
    this.promise = promise;
    this._dialogHandler = dialogHandler;
  }

  public close() {
    if (this._closed) {
      return;
    }
    this._dialogHandler.unregisterMagicDialog(this.message);
    this._closed = true;
  }

  public get js() {
    const messageJs = JSON.stringify(this.message);
    return `prompt(${messageJs}, ${messageJs});`;
  }
}
