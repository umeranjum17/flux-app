import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'main',
    root: '.',
    include: ['electron/**/__tests__/**/*.test.ts'],
    passWithNoTests: true,
    environment: 'node',
    setupFiles: ['test/setup-main.ts'],
    deps: {
      inline: ['electron', 'node-pty'],
    },
  },
  resolve: {
    alias: {
      '@electron': path.resolve(__dirname, 'electron'),
    },
  },
});
