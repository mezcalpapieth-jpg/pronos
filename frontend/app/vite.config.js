import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  MVP_ACCESS_COOKIE_NAME,
  buildMvpAccessCookie,
  readCookie,
  verifyMvpAccessCookie,
  verifyMvpAccessPassword,
} from '../api/_lib/mvp-access-gate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const nodeModuleSegment = `${path.sep}node_modules${path.sep}`;

const rootEnv = loadEnv(process.env.NODE_ENV || 'development', repoRoot, '');
for (const [key, value] of Object.entries(rootEnv)) {
  if (process.env[key] == null) process.env[key] = value;
}

function matchesNodeModule(id, names) {
  return names.some((name) => (
    id.includes(`${nodeModuleSegment}${name}${path.sep}`)
    || id.includes(`${nodeModuleSegment}${name}.js`)
  ));
}

function manualChunks(id) {
  if (!id.includes(nodeModuleSegment)) return null;

  if (matchesNodeModule(id, [
    'react-globe.gl',
    'globe.gl',
    'three',
    'three-globe',
    'three-render-objects',
    'three-conic-polygon-geometry',
    'three-geojson-geometry',
    'three-slippy-map-globe',
    '@tweenjs/tween.js',
    '@turf/boolean-point-in-polygon',
    'accessor-fn',
    'd3-array',
    'd3-color',
    'd3-delaunay',
    'd3-format',
    'd3-geo',
    'd3-geo-voronoi',
    'd3-interpolate',
    'd3-octree',
    'd3-scale',
    'd3-scale-chromatic',
    'd3-selection',
    'd3-time',
    'd3-time-format',
    'd3-tricontour',
    'data-bind-mapper',
    'delaunator',
    'earcut',
    'float-tooltip',
    'frame-ticker',
    'h3-js',
    'index-array-by',
    'jerrypick',
    'kapsule',
    'lodash-es',
    'polished',
    'point-in-polygon-hao',
    'robust-predicates',
    'loose-envify',
    'object-assign',
    'prop-types',
    'react-kapsule',
    'react-is',
    'tinycolor2',
    'topojson-client',
    'tslib',
    'world-atlas',
    '@turf/helpers',
    '@turf/invariant',
  ])) {
    return 'globe-vendor';
  }

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

function readRequestJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(payload));
}

function sendText(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(body);
}

function sharedCssDevMiddleware() {
  const cssDir = path.resolve(__dirname, '../css');
  const prefixes = ['/css/', '/mvp/css/', '/points/css/'];

  return {
    name: 'shared-css-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] || '';
        const prefix = prefixes.find(item => url.startsWith(item));
        if (!prefix) return next();

        const relativePath = decodeURIComponent(url.slice(prefix.length));
        if (!relativePath || relativePath.includes('..') || path.isAbsolute(relativePath)) {
          return sendText(res, 400, 'Bad CSS path', { 'Content-Type': 'text/plain' });
        }

        try {
          const file = path.join(cssDir, relativePath);
          const body = await fs.readFile(file, 'utf8');
          return sendText(res, 200, body, {
            'Content-Type': 'text/css; charset=utf-8',
            'Cache-Control': 'no-cache',
          });
        } catch {
          return next();
        }
      });
    },
  };
}

function mvpAccessDevGate() {
  return {
    name: 'mvp-access-dev-gate',
    configureServer(server) {
      server.middlewares.use('/api/mvp-access', async (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          return res.end();
        }

        if (req.method === 'GET') {
          const cookie = readCookie(req.headers, MVP_ACCESS_COOKIE_NAME);
          return sendJson(res, 200, { ok: verifyMvpAccessCookie(cookie) });
        }

        if (req.method !== 'POST') {
          return sendJson(res, 405, { error: 'GET or POST only' });
        }

        const body = await readRequestJson(req);
        const result = verifyMvpAccessPassword(body.password);
        if (!result.ok) {
          return sendJson(res, result.status, { error: result.error });
        }

        return sendJson(res, 200, { ok: true }, {
          'Set-Cookie': buildMvpAccessCookie({ headers: req.headers }),
        });
      });
    },
  };
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
  plugins: [sharedCssDevMiddleware(), mvpAccessDevGate(), turnkeyBrowserNodecryptoStub(), react()],
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
