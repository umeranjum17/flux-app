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
        'electron',
        'sqlite',
        'node:sqlite',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
