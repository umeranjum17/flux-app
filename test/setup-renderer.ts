import { vi, beforeEach } from 'vitest';
import { createMockApi } from './mocks/window-api';
import '@testing-library/jest-dom/vitest';

let mockApi: ReturnType<typeof createMockApi>;

beforeEach(() => {
  mockApi = createMockApi();
  (globalThis as any).window = globalThis.window ?? {};
  (window as any).api = mockApi;

  // Reset all Zustand stores
  vi.resetModules();
});

export { mockApi };
