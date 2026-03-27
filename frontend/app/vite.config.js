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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@privy-io')) {
            return 'privy';
          }
          if (id.includes('node_modules/@walletconnect')) {
            return 'walletconnect';
          }
          if (id.includes('node_modules/@reown')) {
            return 'reown';
          }
          if (id.includes('node_modules/viem')) {
            return 'viem';
          }
          if (id.includes('node_modules/ox')) {
            return 'ox';
          }
          if (id.includes('node_modules/ethers')) {
            return 'ethers';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) {
            return 'react-vendor';
          }
          return null;
        },
      },
    },
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
