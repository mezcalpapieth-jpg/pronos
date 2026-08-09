import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { randomUUID } from 'crypto';
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
import {
  buildVideoAccessCookie,
  readVideoAccessCookie,
  verifyVideoAccessCookie,
  verifyVideoAccessPassword,
} from '../api/_lib/video-access-gate.js';

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

function pointsRootDeckDevMiddleware() {
  return {
    name: 'points-root-deck-dev-middleware',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (process.env.BUILD_TARGET !== 'points') return next();
        const rawUrl = req.url || '';
        const [pathname, query = ''] = rawUrl.split('?');
        if (pathname === '/deck') {
          req.url = `/points/${query ? `?${query}` : ''}`;
          return next();
        }
        if (pathname.startsWith('/deck/')) {
          req.url = `/points/${pathname.slice('/deck/'.length)}${query ? `?${query}` : ''}`;
          return next();
        }
        return next();
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

function videoAccessDevGate() {
  return {
    name: 'video-access-dev-gate',
    configureServer(server) {
      server.middlewares.use('/api/video-access', async (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          return res.end();
        }

        if (req.method === 'GET') {
          const cookie = readVideoAccessCookie(req.headers);
          return sendJson(res, 200, { ok: verifyVideoAccessCookie(cookie) });
        }

        if (req.method !== 'POST') {
          return sendJson(res, 405, { error: 'GET or POST only' });
        }

        const body = await readRequestJson(req);
        const result = verifyVideoAccessPassword(body.password);
        if (!result.ok) {
          return sendJson(res, result.status, { error: result.error });
        }

        return sendJson(res, 200, { ok: true }, {
          'Set-Cookie': buildVideoAccessCookie({ headers: req.headers }),
        });
      });
    },
  };
}

function parseCookies(header = '') {
  const cookies = {};
  for (const item of String(header || '').split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function deckDevApiMiddleware() {
  const cookieName = 'pronos_deck_session';
  const now = () => new Date().toISOString();
  const invites = [{
    id: 1,
    label: 'Francisco M.',
    emailHint: '',
    code: 'Chiavari',
    active: true,
    createdBy: 'dev',
    createdAt: now(),
    revokedAt: null,
  }];
  const sessions = new Map();
  const events = [];
  const questions = [];

  function publicSession(session) {
    const invite = invites.find(item => item.id === session?.inviteId);
    if (!session || !invite?.active) return null;
    return {
      id: session.id,
      viewerEmail: session.viewerEmail,
      language: session.language || 'en',
      inviteId: session.inviteId,
      inviteLabel: invite.label,
      inviteEmailHint: invite.emailHint || null,
      startedAt: session.startedAt,
      lastSeenAt: session.lastSeenAt,
    };
  }

  function readSession(req) {
    const sessionId = parseCookies(req.headers.cookie)[cookieName];
    return publicSession(sessions.get(sessionId));
  }

  function makeDashboard() {
    const bySlide = new Map();
    for (const event of events) {
      if (!event.durationMs || event.durationMs <= 0) continue;
      const key = `${event.language || 'en'}:${event.slideNumber || 0}`;
      const current = bySlide.get(key) || {
        language: event.language || 'en',
        slideNumber: event.slideNumber || 0,
        totalMs: 0,
        sessions: new Set(),
        events: 0,
      };
      current.totalMs += event.durationMs;
      current.sessions.add(event.sessionId);
      current.events += 1;
      bySlide.set(key, current);
    }

    const minutes = ms => Math.round((Number(ms || 0) / 60000) * 10) / 10;
    const sessionRows = [...sessions.values()]
      .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
      .map(session => {
        const sessionEvents = events.filter(event => event.sessionId === session.id);
        const totalMs = sessionEvents.reduce((sum, event) => sum + Number(event.durationMs || 0), 0);
        const lastSlide = sessionEvents.reduce((max, event) => Math.max(max, Number(event.slideNumber || 0)), 0);
        const invite = invites.find(item => item.id === session.inviteId);
        const bySlide = new Map();
        for (const event of sessionEvents) {
          if (!event.durationMs || event.durationMs <= 0) continue;
          const key = `${event.language || 'en'}:${event.slideNumber || 0}`;
          const current = bySlide.get(key) || {
            language: event.language || 'en',
            slideNumber: event.slideNumber || 0,
            totalMs: 0,
            events: 0,
            lastEventAt: event.createdAt,
          };
          current.totalMs += Number(event.durationMs || 0);
          current.events += 1;
          if (new Date(event.createdAt) > new Date(current.lastEventAt)) current.lastEventAt = event.createdAt;
          bySlide.set(key, current);
        }
        return {
          id: session.id,
          viewerEmail: session.viewerEmail,
          language: session.language || 'en',
          inviteLabel: invite?.label || null,
          inviteEmailHint: invite?.emailHint || null,
          startedAt: session.startedAt,
          lastSeenAt: session.lastSeenAt,
          totalMinutes: minutes(totalMs),
          lastSlide,
          slideBreakdown: [...bySlide.values()]
            .sort((a, b) => a.language.localeCompare(b.language) || a.slideNumber - b.slideNumber)
            .map(row => ({
              language: row.language,
              slideNumber: row.slideNumber,
              totalMinutes: minutes(row.totalMs),
              events: row.events,
              lastEventAt: row.lastEventAt,
            })),
        };
      });

    return {
      admin: 'local-dev',
      summary: {
        sessions: sessions.size,
        viewers: new Set([...sessions.values()].map(session => session.viewerEmail.toLowerCase())).size,
        totalMinutes: minutes(events.reduce((sum, event) => sum + Number(event.durationMs || 0), 0)),
        questions: questions.length,
      },
      slides: [...bySlide.values()]
        .sort((a, b) => a.language.localeCompare(b.language) || a.slideNumber - b.slideNumber)
        .map(row => ({
          language: row.language,
          slideNumber: row.slideNumber,
          totalMinutes: minutes(row.totalMs),
          avgMinutes: row.sessions.size ? minutes(row.totalMs / row.sessions.size) : 0,
          sessions: row.sessions.size,
          events: row.events,
        })),
      sessions: sessionRows.slice(0, 80),
      questions: questions.slice(-100).reverse(),
      invites: invites.slice().reverse().map(invite => {
        const inviteSessions = [...sessions.values()].filter(session => session.inviteId === invite.id);
        const inviteSessionIds = new Set(inviteSessions.map(session => session.id));
        const totalMs = events
          .filter(event => inviteSessionIds.has(event.sessionId))
          .reduce((sum, event) => sum + Number(event.durationMs || 0), 0);
        return {
          id: invite.id,
          label: invite.label,
          emailHint: invite.emailHint || null,
          active: invite.active && !invite.revokedAt,
          createdBy: invite.createdBy,
          createdAt: invite.createdAt,
          revokedAt: invite.revokedAt,
          shareCode: invite.code,
          sessions: inviteSessions.length,
          viewers: new Set(inviteSessions.map(session => session.viewerEmail.toLowerCase())).size,
          totalMinutes: minutes(totalMs),
        };
      }),
    };
  }

  return {
    name: 'deck-dev-api-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/deck/')) return next();

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          return res.end();
        }

        if (url.pathname === '/api/deck/session' && req.method === 'GET') {
          const session = readSession(req);
          if (!session) return sendJson(res, 401, { error: 'deck_session_required' });
          return sendJson(res, 200, { session });
        }

        if (url.pathname === '/api/deck/session' && req.method === 'DELETE') {
          return sendJson(res, 200, { ok: true }, {
            'Set-Cookie': `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
          });
        }

        if (url.pathname === '/api/deck/auth' && req.method === 'POST') {
          const body = await readRequestJson(req);
          const email = String(body.email || '').trim().toLowerCase();
          const code = String(body.code || '').trim();
          const language = body.language === 'es' ? 'es' : 'en';
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return sendJson(res, 400, { error: 'invalid_email' });
          }
          const invite = invites.find(item => item.active && !item.revokedAt && item.code === code);
          if (!invite) return sendJson(res, 401, { error: 'invalid_invite' });

          const session = {
            id: randomUUID(),
            inviteId: invite.id,
            viewerEmail: email,
            language,
            startedAt: now(),
            lastSeenAt: now(),
          };
          sessions.set(session.id, session);
          return sendJson(res, 200, {
            ok: true,
            session: publicSession(session),
            emailMatchesInvite: !invite.emailHint || invite.emailHint.toLowerCase() === email,
          }, {
            'Set-Cookie': `${cookieName}=${encodeURIComponent(session.id)}; Path=/; Max-Age=1209600; HttpOnly; SameSite=Lax`,
          });
        }

        if (url.pathname === '/api/deck/events' && req.method === 'POST') {
          const session = readSession(req);
          if (!session) return sendJson(res, 401, { error: 'deck_session_required' });
          const body = await readRequestJson(req);
          const storedSession = sessions.get(session.id);
          if (storedSession) storedSession.lastSeenAt = now();
          events.push({
            id: randomUUID(),
            sessionId: session.id,
            slideNumber: Number(body.slideNumber || 0),
            durationMs: Math.max(0, Number(body.durationMs || 0)),
            eventType: String(body.eventType || 'slide_view').slice(0, 40),
            language: body.language === 'es' ? 'es' : 'en',
            createdAt: now(),
          });
          return sendJson(res, 200, { ok: true });
        }

        if (url.pathname === '/api/deck/questions' && req.method === 'POST') {
          const session = readSession(req);
          if (!session) return sendJson(res, 401, { error: 'deck_session_required' });
          const body = await readRequestJson(req);
          const question = String(body.question || '').trim().slice(0, 1200);
          if (!question) return sendJson(res, 400, { error: 'question_required' });
          const row = {
            id: randomUUID(),
            viewerEmail: session.viewerEmail,
            language: body.language === 'es' ? 'es' : 'en',
            slideNumber: Number(body.slideNumber || 0) || null,
            question,
            status: 'open',
            createdAt: now(),
            inviteLabel: session.inviteLabel,
          };
          questions.push(row);
          return sendJson(res, 200, { ok: true, question: { id: row.id, createdAt: row.createdAt } });
        }

        if (url.pathname === '/api/deck/admin/dashboard' && req.method === 'GET') {
          return sendJson(res, 200, makeDashboard());
        }

        if (url.pathname === '/api/deck/admin/invites' && req.method === 'GET') {
          return sendJson(res, 200, { invites: makeDashboard().invites });
        }

        if (url.pathname === '/api/deck/admin/invites' && req.method === 'POST') {
          const body = await readRequestJson(req);
          if (body.action === 'revoke') {
            const invite = invites.find(item => item.id === Number(body.id));
            if (!invite) return sendJson(res, 404, { error: 'invite_not_found' });
            invite.active = false;
            invite.revokedAt = now();
            return sendJson(res, 200, { ok: true, invite });
          }

          if (body.action === 'reset_code') {
            const invite = invites.find(item => item.id === Number(body.id) && item.active && !item.revokedAt);
            if (!invite) return sendJson(res, 404, { error: 'invite_not_found' });
            const code = String(body.code || `PRONOS-${randomUUID().slice(0, 8).toUpperCase()}`).trim();
            if (code.length < 6) return sendJson(res, 400, { error: 'code_too_short' });
            if (invites.some(item => item.id !== invite.id && item.code === code && item.active)) {
              return sendJson(res, 409, { error: 'invite_code_exists' });
            }
            invite.code = code;
            return sendJson(res, 200, {
              ok: true,
              code,
              invite: {
                id: invite.id,
                label: invite.label,
                emailHint: invite.emailHint || null,
                active: invite.active,
                createdBy: invite.createdBy,
                createdAt: invite.createdAt,
                revokedAt: invite.revokedAt,
                shareCode: code,
              },
            });
          }

          const label = String(body.label || '').trim().slice(0, 120);
          const emailHint = String(body.emailHint || '').trim().toLowerCase();
          const code = String(body.code || `PRONOS-${randomUUID().slice(0, 8).toUpperCase()}`).trim();
          if (!label) return sendJson(res, 400, { error: 'label_required' });
          if (code.length < 6) return sendJson(res, 400, { error: 'code_too_short' });
          if (invites.some(item => item.code === code && item.active)) {
            return sendJson(res, 409, { error: 'invite_code_exists' });
          }
          const invite = {
            id: invites.reduce((max, item) => Math.max(max, item.id), 0) + 1,
            label,
            emailHint,
            code,
            active: true,
            createdBy: 'local-dev',
            createdAt: now(),
            revokedAt: null,
          };
          invites.push(invite);
          return sendJson(res, 200, {
            ok: true,
            code,
            invite: {
              id: invite.id,
              label: invite.label,
              emailHint: invite.emailHint || null,
              active: invite.active,
              createdBy: invite.createdBy,
              createdAt: invite.createdAt,
              shareCode: code,
            },
          });
        }

        return sendJson(res, 404, { error: 'deck_dev_route_not_found' });
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
// Both apps live under sub-paths; pronos.io/ now redirects to /points/
// and /mvp remains the gated preview. Both builds get isolated output
// folders that we can safely empty on each build (no shared siblings).
const isPoints = process.env.BUILD_TARGET === 'points';

export default defineConfig({
  plugins: [pointsRootDeckDevMiddleware(), sharedCssDevMiddleware(), mvpAccessDevGate(), videoAccessDevGate(), deckDevApiMiddleware(), turnkeyBrowserNodecryptoStub(), react()],
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
