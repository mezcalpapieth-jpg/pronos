// ─── Polymarket Gamma API Proxy ───────────────────────────────────────────────
// Proxies requests to https://gamma-api.polymarket.com to avoid CORS issues.
//
// Usage from frontend:
//   fetch('/api/gamma?path=/markets&active=true&limit=60')
//   → proxied to https://gamma-api.polymarket.com/markets?active=true&limit=60
//
// The `path` query param specifies the upstream endpoint path (e.g. /markets).
// All other query params are forwarded to the upstream URL.

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Extract `path` from query params, forward the rest to upstream
    const { path: upstreamPath = '/markets', ...rest } = req.query || {};

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
    res.status(502).json({ error: 'Gamma API unavailable', detail: err.message });
  }
}
