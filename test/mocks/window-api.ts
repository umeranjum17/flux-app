import { vi } from 'vitest';

type Listener = (...args: any[]) => void;

export interface MockApi {
  invoke: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  platform: string;
  _listeners: Map<string, Set<Listener>>;
  _emit(channel: string, data: unknown): void;
}

export function createMockApi(): MockApi {
  const listeners = new Map<string, Set<Listener>>();

  const api: MockApi = {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((channel: string, callback: Listener) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(callback);
      return () => {
        listeners.get(channel)?.delete(callback);
      };
    }),
    off: vi.fn(),
    platform: 'linux',
    _listeners: listeners,
    _emit(channel: string, data: unknown) {
      const cbs = listeners.get(channel);
      if (cbs) {
        for (const cb of cbs) cb(data);
      }
    },
  };

  return api;
}
