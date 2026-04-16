import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Two build targets share this Vite project:
//   - MVP    (Privy, on-chain, USDC)     — default build, outputs to ../mvp/
//   - Points (Turnkey, off-chain, MXNP)  — BUILD_TARGET=points, outputs to ../points/
//
// Only one builds at a time. The MVP uses the default index.html at the project
// root. The points app has its own entry at points/index.html and swaps `root`
// so Vite treats that as the source folder while still resolving `@app/...`
// imports back into the shared src/ tree.
const isPoints = process.env.BUILD_TARGET === 'points';

export default defineConfig({
  plugins: [react()],
  base: isPoints ? '/points/' : '/mvp/',
  root: isPoints ? path.resolve(__dirname, 'points') : __dirname,
  build: {
    outDir: isPoints
      ? path.resolve(__dirname, '../points')
      : path.resolve(__dirname, '../mvp'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '/css': path.resolve(__dirname, '../css'),
      // Let the points-app source import shared components from the MVP tree
      // without duplicating files.
      '@app': path.resolve(__dirname, 'src'),
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
