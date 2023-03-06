import { LogicError } from '../support/errors/common.js';
import { secsToHrTime } from '../support/timestamp.js';
import { Protocol } from 'devtools-protocol';
import { PromiseSource } from '../support/promise.js';
import { CdpClient } from '../support/cdp.js';
import { subscribe, Subscription } from '../support/events/subscriptions.js';
import { PartialRecord } from '../support/types/utilities.js';
import { EventEmitter } from 'node:events';

enum RequestWatcherState {
  Initial = 'initial',
  Watching = 'watching',
  Closed = 'closed',
}

interface RequestWatcherEvents {
  pending: PendingRequest;
  request: LoadedRequest | FailedRequest;
}

export declare interface RequestWatcher {
  on<T extends keyof RequestWatcherEvents>(eventName: T, listener: (eventData: RequestWatcherEvents[T]) => void): this;
  once<T extends keyof RequestWatcherEvents>(
    eventName: T,
    listener: (eventData: RequestWatcherEvents[T]) => void
  ): this;
}

export interface RequestWatcherOptions {
  onlyInitial?: boolean;
}

interface InternalRequestWatcherOptions extends RequestWatcherOptions {
  onlyInitial: boolean;
}

// TODO: Implement only first request tracking.

export class RequestWatcher extends EventEmitter {
  private _options: InternalRequestWatcherOptions;
  private _state = RequestWatcherState.Initial;
  private _client: CdpClient | null = null;
  private _requests: Map<string, Request> = new Map();
  private _initialRequest: Request | null = null;
  private _initialRequestSource = new PromiseSource<LoadedRequest | FailedRequest>();
  private _clientSubs: PartialRecord<
    'onHttpRequest' | 'onHttpResponse' | 'onHttpFinished' | 'onHttpFailed',
    Subscription
  > = {};

  public constructor(options?: RequestWatcherOptions) {
    super();
    this._options = {
      onlyInitial: options?.onlyInitial ?? false,
    };
  }

  public get requests(): ReadonlyMap<string, Request> {
    return this._requests;
  }

  public get initialRequest() {
    if (this._initialRequest === null) {
      return null;
    }
    if (
      this._initialRequest.readyState !== RequestReadyState.Loaded &&
      this._initialRequest.readyState !== RequestReadyState.Failed
    ) {
      return null;
    }
    return this._initialRequest;
  }

  public get initialRequestPromise() {
    return this._initialRequestSource.promise;
  }

  public watch(client: CdpClient) {
    if (this._state !== RequestWatcherState.Initial) {
      throw new LogicError(`Invalid watcher state '${this._state}'.`);
    }
    this._client = client;

    this._clientSubs.onHttpRequest = subscribe(
      this._client,
      'Network.requestWillBeSent',
      this.onHttpRequest.bind(this)
    );
    this._clientSubs.onHttpResponse = subscribe(
      this._client,
      'Network.responseReceived',
      this.onHttpResponse.bind(this)
    );
    this._clientSubs.onHttpFinished = subscribe(
      this._client,
      'Network.loadingFinished',
      this.onHttpFinished.bind(this)
    );
    this._clientSubs.onHttpFailed = subscribe(this._client, 'Network.loadingFailed', this.onHttpFailed.bind(this));

    this._state = RequestWatcherState.Watching;
  }

  public close() {
    if (this._state === RequestWatcherState.Closed) {
      return;
    }
    let event: keyof typeof this._clientSubs;
    for (event in this._clientSubs) {
      const subscription = this._clientSubs[event];
      if (subscription) {
        subscription.unsubscribe();
        this._clientSubs[event] = undefined;
      }
    }
    this._state = RequestWatcherState.Closed;
  }

  private onHttpRequest(params: Protocol.Network.RequestWillBeSentEvent) {
    if (params.redirectResponse) {
      // The new request is caused by a redirect or the original request.
      // The request ID will be reused so there is no need add a new record.
      return;
    }

    if (this._options.onlyInitial) {
      this._clientSubs.onHttpRequest?.unsubscribe();
    }

    const request: PendingRequest = {
      readyState: RequestReadyState.Pending,
      id: params.requestId,
      url: params.request.url,
      sentAt: secsToHrTime(params.timestamp),
    };

    if (this._requests.has(request.id)) {
      // TODO: Log error
      return;
    }

    this._requests.set(request.id, request);
    if (!this._initialRequest) {
      this._initialRequest = request;
    }

    this.emit('pending', request);
  }

  private onHttpResponse(params: ResponseEvent) {
    const request = this._requests.get(params.requestId);
    if (request === undefined) {
      // TODO: Log
      return;
    }
    if (this._options.onlyInitial) {
      this._clientSubs.onHttpResponse?.unsubscribe();
    }
    if (request.readyState !== RequestReadyState.Pending) {
      // TODO: Log invalid state
      return;
    }
    const response = params.response;
    const respondedRequest: RespondedRequest = {
      ...request,
      readyState: RequestReadyState.Response,
      responseReceivedAt: secsToHrTime(params.timestamp),
      statusCode: response.status,
      headers: Object.assign({}, response.headers),
      fromDiskCache: response.fromDiskCache ?? false,
    };
    Object.assign(request, respondedRequest);
  }

  private onHttpFinished(params: Protocol.Network.LoadingFinishedEvent) {
    const request = this._requests.get(params.requestId);
    if (request === undefined) {
      // TODO: Log
      return;
    }
    if (this._options.onlyInitial) {
      this._clientSubs.onHttpFinished?.unsubscribe();
    }
    if (request.readyState !== RequestReadyState.Response) {
      // TODO: Log invalid state
      return;
    }
    const loadedRequest: LoadedRequest = {
      ...request,
      readyState: RequestReadyState.Loaded,
      completedAt: secsToHrTime(params.timestamp),
    };
    Object.assign(request, loadedRequest);
    this.onRequestDone(loadedRequest);
  }

  private onHttpFailed(params: Protocol.Network.LoadingFailedEvent) {
    const request = this._requests.get(params.requestId);
    if (request === undefined) {
      // TODO: Log
      return;
    }
    if (this._options.onlyInitial) {
      this._clientSubs.onHttpFailed?.unsubscribe();
    }
    if (request.readyState !== RequestReadyState.Pending && request.readyState !== RequestReadyState.Response) {
      // TODO: Log invalid state
      return;
    }
    const failedRequest: FailedRequest = {
      responseReceivedAt: undefined,
      ...request,
      readyState: RequestReadyState.Failed,
      completedAt: secsToHrTime(params.timestamp),
      errorText: params.errorText,
    };
    Object.assign(request, failedRequest);
    this.onRequestDone(failedRequest);
  }

  private onRequestDone(request: LoadedRequest | FailedRequest) {
    if (request.id === this._initialRequest?.id) {
      this._initialRequestSource.resolve(request);
    }
    this.emit('request', request);
  }
}

export enum RequestReadyState {
  Pending = 'pending',
  Response = 'response',
  Loaded = 'loaded',
  Failed = 'failed',
}

export type RequestProps = {
  id: string;
  url: string;
  sentAt: bigint;
};

export type RespondedRequestProps = RequestProps & {
  responseReceivedAt: bigint;
  statusCode: number;
  headers: Record<string, string>;
  fromDiskCache: boolean;
};

export type MaybeResponseProps = RespondedRequestProps | { responseReceivedAt: undefined };

export type FailedRequestProps = RequestProps &
  MaybeResponseProps & {
    completedAt: bigint;
    errorText: string;
  };

export type LoadedRequestProps = RespondedRequestProps & {
  completedAt: bigint;
};

export type PendingRequest = RequestProps & {
  readyState: RequestReadyState.Pending;
};

export type RespondedRequest = RespondedRequestProps & {
  readyState: RequestReadyState.Response;
};

export type LoadedRequest = LoadedRequestProps & {
  readyState: RequestReadyState.Loaded;
};

export type FailedRequest = FailedRequestProps & {
  readyState: RequestReadyState.Failed;
};

export type Request = PendingRequest | RespondedRequest | LoadedRequest | FailedRequest;

interface ResponseEvent {
  /**
   * Request identifier.
   */
  requestId: Protocol.Network.RequestId;
  /**
   * Loader identifier. Empty string if the request is fetched from worker.
   */
  loaderId: Protocol.Network.LoaderId;
  /**
   * Timestamp.
   */
  timestamp: Protocol.Network.MonotonicTime;
  /**
   * Resource type.
   */
  type?: Protocol.Network.ResourceType;
  /**
   * Response data.
   */
  response: Protocol.Network.Response;
  /**
   * Frame identifier.
   */
  frameId?: Protocol.Page.FrameId;
}
