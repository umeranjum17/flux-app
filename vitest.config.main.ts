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
      '@electron': '/home/umera/github/flux-app/electron',
    },
  },
});
