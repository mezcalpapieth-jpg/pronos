import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: '/mvp/',
  build: {
    outDir: '../mvp',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '/css': path.resolve(__dirname, '../css'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://pronos.io',
        changeOrigin: true,
      },
    },
  },
});
