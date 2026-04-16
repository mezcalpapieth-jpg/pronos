// ─── Polymarket Gamma API Proxy ───────────────────────────────────────────────
// Proxies requests to https://gamma-api.polymarket.com to avoid CORS issues.
//
// Usage from frontend:
//   fetch('/api/gamma?path=/markets&active=true&limit=60')
//   → proxied to https://gamma-api.polymarket.com/markets?active=true&limit=60
//
// The `path` query param specifies the upstream endpoint path (e.g. /markets).
// It MUST match one of ALLOWED_PATHS below — otherwise the request is rejected.
// This prevents SSRF attacks where an attacker uses our server as a relay to
// probe internal endpoints on the Gamma host or crafted paths.

import { applyCors } from './_lib/cors.js';
import { rateLimit, clientIp } from './_lib/rate-limit.js';

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

// Allowlist of upstream paths we actually use from the frontend.
// Add more here as new routes are needed — never accept arbitrary paths.
const ALLOWED_PATHS = new Set([
  '/markets',
  '/events',
]);

// Allowlist for path prefixes that take a slug/id suffix, e.g.:
//   /markets/{slug}
//   /events/{id}
const ALLOWED_PATH_PREFIXES = [
  '/markets/',
  '/events/',
];

// Safe characters for a slug/id segment — letters, digits, dash, underscore.
// No slashes, no dots, no query separators — that would break out of the
// intended endpoint into another URL structure.
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;

function isAllowedPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return false;
  if (ALLOWED_PATHS.has(path)) return true;
  for (const prefix of ALLOWED_PATH_PREFIXES) {
    if (path.startsWith(prefix)) {
      const tail = path.slice(prefix.length);
      // Tail must be a single safe segment — no nested paths.
      if (SAFE_SEGMENT.test(tail)) return true;
    }
  }
  return false;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;

  // Rate limit gamma proxy usage so pronos.io doesn't become a free
  // amplification relay to Polymarket's upstream. 120/min per IP is
  // comfortably above normal browsing (even an admin page load fires
  // maybe 10 gamma calls) but cuts off scrapers.
  const limited = rateLimit(req, res, {
    key: `gamma:${clientIp(req)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return;

  try {
    // Extract `path` from query params, forward the rest to upstream
    const { path: upstreamPath = '/markets', ...rest } = req.query || {};

    if (!isAllowedPath(upstreamPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    // Build upstream query string from remaining params
    const qs = new URLSearchParams(rest).toString();
    const upstreamUrl = `${GAMMA_BASE}${upstreamPath}${qs ? '?' + qs : ''}`;

    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'pronos.io/1.0',
      },
    });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    const body = await upstream.text();

    res.status(upstream.status)
       .setHeader('Content-Type', contentType)
       .setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')
       .end(body);
  } catch (err) {
    console.error('Gamma proxy error:', err);
    res.status(502).json({ error: 'Gamma API unavailable' });
  }
}
