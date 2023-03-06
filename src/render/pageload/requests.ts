import { PromiseSource } from '../../support/promise.js';
import { Timeout } from '../../support/timeout.js';
import { CompletionTrigger, CompletionTriggerInitOptions } from './abstract.js';
import { Protocol } from 'devtools-protocol';
import defaults from '../../defaults.js';
import { CompletionType } from './config.js';

export class RequestsCompletionTrigger extends CompletionTrigger {
  private _waitAfterLastRequestMillis: number;
  private _timeout = Timeout.cleared();
  private _requestSource = new PromiseSource<void>();
  private _domContentLoadedSource = new PromiseSource<void>();
  private _pendingRequests = new Set<string>();
  private _handlers = {
    'Network.requestWillBeSent': (params: Protocol.Network.RequestWillBeSentEvent) => this.onRequestStart(params),
    'Network.loadingFinished': (params: Protocol.Network.LoadingFinishedEvent) => this.onRequestEnd(params),
    'Network.loadingFailed': (params: Protocol.Network.LoadingFinishedEvent) => this.onRequestEnd(params),
    'Page.domContentEventFired': () => this._domContentLoadedSource.resolve(),
  };

  public constructor(waitAfterLastRequestMillis?: number) {
    super();
    this._waitAfterLastRequestMillis =
      waitAfterLastRequestMillis ?? defaults.completionTrigger.requests.waitAfterLastRequestMillis;
  }

  public async init(options: CompletionTriggerInitOptions) {
    super.init(options);
    let key: keyof typeof this._handlers;
    for (key in this._handlers) {
      this._client.on(key, this._handlers[key]);
    }
  }

  public async close() {
    this._timeout.clear();
    let key: keyof typeof this._handlers;
    for (key in this._handlers) {
      this._client.removeListener(key, this._handlers[key]);
    }
    super.close();
  }

  public async wait() {
    await this._domContentLoadedSource.promise;
    await this._requestSource.promise;
    return CompletionType.Requests;
  }

  private onRequestStart(params: Protocol.Network.RequestWillBeSentEvent) {
    if (params.redirectResponse) {
      return;
    }
    this._pendingRequests.add(params.requestId);
    this._timeout.clear();
  }

  private onRequestEnd(params: Protocol.Network.LoadingFinishedEvent | Protocol.Network.LoadingFailedEvent) {
    if (!this._pendingRequests.delete(params.requestId)) {
      return;
    }
    if (this._pendingRequests.size === 0) {
      this._timeout = Timeout.create(() => {
        this._requestSource.resolve();
      }, this._waitAfterLastRequestMillis);
    }
  }
}
