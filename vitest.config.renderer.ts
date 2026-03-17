import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'renderer',
    root: '.',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
    setupFiles: ['test/setup-renderer.ts'],
    css: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
