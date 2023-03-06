import CDP from 'chrome-remote-interface';
import { EventEmitter } from 'node:events';

/**
 * A wrapper around {@link CDP.Client} that adds some missing type
 * declarations and a custom 'close' event.
 */
export type CdpClient = CDP.Client & CdpClientEx & EventEmitter;

export declare interface CdpClientEx {
  on(eventName: 'close', listener: () => void): this;
}

export interface CdpClientEx {
  port: number;
  host: string;
  secure: boolean;
  useHostName: boolean;
  local: boolean;
  webSocketUrl: string;
}

export type CreateCdpClientOptions = Omit<CDP.Options, 'host' | 'port' | 'target' | 'secure'> & {
  target: string;
};

export async function createCdpClient(options: CreateCdpClientOptions) {
  const targetUrl = new URL(options.target);
  const client = (await CDP({
    ...options,
    host: targetUrl.hostname,
    port: Number(targetUrl.port),
    secure: targetUrl.protocol === 'wss',
  })) as CdpClient;

  // We need more than 10 but 1000 ought to be enough.
  client.setMaxListeners(1000);

  // Monkey patch an event when the client is closed.
  let closed = false;
  const superClose = client.close.bind(client);
  client.close = async () => {
    if (closed) {
      return;
    }
    await superClose();
    closed = true;
    client.emit('close');
  };

  return client;
}
