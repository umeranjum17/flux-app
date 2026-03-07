import { useCallback } from 'react';

declare global {
  interface Window {
    api: {
      platform: string;
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;
      on(channel: string, callback: (...args: unknown[]) => void): () => void;
      off(channel: string, callback: (...args: unknown[]) => void): void;
    };
  }
}

export function useIpc() {
  const invoke = useCallback(async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
    return window.api.invoke(channel, ...args) as Promise<T>;
  }, []);

  const on = useCallback((channel: string, callback: (...args: unknown[]) => void) => {
    return window.api.on(channel, callback);
  }, []);

  return { invoke, on };
}
