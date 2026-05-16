import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeModuleSegment = `${path.sep}node_modules${path.sep}`;

function matchesNodeModule(id, names) {
  return names.some((name) => (
    id.includes(`${nodeModuleSegment}${name}${path.sep}`)
    || id.includes(`${nodeModuleSegment}${name}.js`)
  ));
}

function manualChunks(id) {
  if (!id.includes(nodeModuleSegment)) return null;

  if (matchesNodeModule(id, ['react', 'react-dom', 'scheduler'])) {
    return 'react-vendor';
  }

  if (matchesNodeModule(id, ['react-router', 'react-router-dom', '@remix-run/router'])) {
    return 'router-vendor';
  }

  if (matchesNodeModule(id, ['@sentry'])) {
    return 'sentry-vendor';
  }

  if (matchesNodeModule(id, ['@safe-global'])) {
    return 'safe-vendor';
  }

  if (matchesNodeModule(id, ['ethers', '@ethersproject', 'bn.js', 'elliptic'])) {
    return 'ethers-vendor';
  }

  if (matchesNodeModule(id, ['viem', 'abitype', 'ox', '@scure', '@adraffy'])) {
    return 'viem-vendor';
  }

  if (matchesNodeModule(id, ['@peculiar', 'reflect-metadata', 'asn1js', 'pvtsutils', 'pvutils', 'tsyringe'])) {
    return 'crypto-vendor';
  }

  if (matchesNodeModule(id, ['@turnkey', '@hpke', '@noble', 'jose', 'buffer', 'base-x', 'bs58', 'bs58check', 'cross-fetch', 'node-fetch'])) {
    return 'turnkey-vendor';
  }

  return 'vendor';
}

function normalizeViteId(id = '') {
  return id.replaceAll(path.win32.sep, path.posix.sep);
}

export function turnkeyBrowserNodecryptoStub() {
  const stubPath = path.resolve(__dirname, 'src/lib/turnkeyNodecryptoBrowserStub.js');

  return {
    name: 'turnkey-browser-nodecrypto-stub',
    enforce: 'pre',
    resolveId(source, importer) {
      const normalizedSource = normalizeViteId(source);
      const normalizedImporter = normalizeViteId(importer);
      const isNodecryptoImport = normalizedSource === './nodecrypto.mjs'
        || normalizedSource === './nodecrypto.js'
        || normalizedSource.endsWith('/node_modules/@turnkey/api-key-stamper/dist/nodecrypto.mjs')
        || normalizedSource.endsWith('/node_modules/@turnkey/api-key-stamper/dist/nodecrypto.js')
        || normalizedSource.endsWith('/@turnkey/api-key-stamper/dist/nodecrypto.mjs')
        || normalizedSource.endsWith('/@turnkey/api-key-stamper/dist/nodecrypto.js');
      const fromApiKeyStamper = normalizedImporter.endsWith('/node_modules/@turnkey/api-key-stamper/dist/index.mjs')
        || normalizedImporter.endsWith('/node_modules/@turnkey/api-key-stamper/dist/index.js');

      if (isNodecryptoImport && (fromApiKeyStamper || normalizedSource.includes('/@turnkey/api-key-stamper/dist/'))) {
        return stubPath;
      }

      return null;
    },
  };
}

// Two build targets share this Vite project:
//   - MVP    (Privy, on-chain, USDC)     — default, outputs to ../mvp/    served at /mvp/
//   - Points (Turnkey, off-chain, MXNP)  — BUILD_TARGET=points, outputs to ../points/ served at /points/
//
// Both apps now live under sub-paths so pronos.io/ can serve a static
// marketing landing page (frontend/index.html, hand-written, not a
// Vite output). Both builds get isolated output folders that we can
// safely empty on each build (no shared siblings).
const isPoints = process.env.BUILD_TARGET === 'points';

export default defineConfig({
  plugins: [turnkeyBrowserNodecryptoStub(), react()],
  base: isPoints ? '/points/' : '/mvp/',
  root: isPoints ? path.resolve(__dirname, 'points') : __dirname,
  build: {
    outDir: isPoints
      ? path.resolve(__dirname, '../points')   // → frontend/points/
      : path.resolve(__dirname, '../mvp'),     // → frontend/mvp/
    emptyOutDir: true,                          // safe on both — own folder
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  resolve: {
    alias: {
      '/css': path.resolve(__dirname, '../css'),
      '@app': path.resolve(__dirname, 'src'),
      crypto: path.resolve(__dirname, 'src/lib/browserCryptoModule.js'),
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
