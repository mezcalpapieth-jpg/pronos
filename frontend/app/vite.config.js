import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Two build targets share this Vite project:
//   - MVP    (Privy, on-chain, USDC)     — default, outputs to ../mvp/  served at /mvp/
//   - Points (Turnkey, off-chain, MXNP)  — BUILD_TARGET=points, outputs to ../ root, served at /
//
// The points app writes index.html + assets/ directly into frontend/ (the
// Vercel outputDirectory root) so pronos.io/ naturally resolves without
// needing Vercel rewrites. emptyOutDir is false for the points build so
// we don't wipe frontend/mvp/, frontend/api/, frontend/css/, etc.
const isPoints = process.env.BUILD_TARGET === 'points';

export default defineConfig({
  plugins: [react()],
  base: isPoints ? '/' : '/mvp/',
  root: isPoints ? path.resolve(__dirname, 'points') : __dirname,
  build: {
    outDir: isPoints
      ? path.resolve(__dirname, '..')        // → frontend/ root
      : path.resolve(__dirname, '../mvp'),   // → frontend/mvp/
    emptyOutDir: !isPoints,                  // keep siblings of frontend/index.html
    rollupOptions: isPoints ? {
      output: {
        // Isolate points-app assets under /assets/ (safe since Vite's
        // build pipeline only writes into this prefix and we don't touch
        // anything else at the frontend/ root).
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    } : {},
  },
  resolve: {
    alias: {
      '/css': path.resolve(__dirname, '../css'),
      '@app': path.resolve(__dirname, 'src'),
    },
  },
  // Dev-server proxy. Default target = localhost vercel-dev so a
  // running `vercel dev` instance handles /api/*. Set
  // VITE_API_PROXY_TARGET=https://pronos.io to talk directly to
  // production from a local dev server (only useful for read-only
  // smoke tests — write endpoints reject cross-origin requests via
  // the M7 CSRF guard in api/_lib/cors.js).
  //
  // M9 from the 2026-03-31 security audit: previous default was
  // https://pronos.io, which made local dev forms hit live data —
  // easy way to mistakenly write to prod from a feature branch.
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
