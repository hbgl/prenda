import { BrowserHandle } from '../../browser/handle.js';

export interface BrowserProvider {
  get status(): BrowserProviderStatus;
  start(): Promise<void>;
  close(): Promise<void>;
  createHandle(): Promise<BrowserHandle | null>;
}

export enum BrowserProviderStatus {
  Initial = 'initial',
  Starting = 'starting',
  Running = 'running',
  Closing = 'closing',
  Closed = 'closed',
}

export type BrowserProviderFactory = () => BrowserProvider;
