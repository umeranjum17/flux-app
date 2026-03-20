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
        'web-tree-sitter',
        'node-pty',
        'bufferutil',
        'utf-8-validate',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
