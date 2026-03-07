import { defineConfig } from 'vite';
import { builtinModules } from 'module';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@electron': path.resolve(__dirname, 'electron'),
    },
  },
  build: {
    rollupOptions: {
      external: [
        'better-sqlite3',
        'electron',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
