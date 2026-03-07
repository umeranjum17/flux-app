import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@electron': path.resolve(__dirname, 'electron'),
    },
  },
});
