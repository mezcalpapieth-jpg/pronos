// ─── Polymarket Gamma API Proxy ───────────────────────────────────────────────
// Proxies requests to https://gamma-api.polymarket.com to avoid CORS issues.
// Vercel route: /api/gamma?* → this function
//
// Usage from frontend:
//   fetch('/api/gamma/markets?active=true&limit=60')
//   → proxied to https://gamma-api.polymarket.com/markets?active=true&limit=60

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  // Allow CORS from same origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Extract the path after /api/gamma
    // req.url will be something like /api/gamma/markets?active=true&...
    // We need the part after /api/gamma
    const rawUrl = req.url || '/';
    // Remove /api/gamma prefix to get the upstream path + query
    const upstreamPath = rawUrl.replace(/^\/api\/gamma/, '') || '/';
    const upstreamUrl = `${GAMMA_BASE}${upstreamPath}`;

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
