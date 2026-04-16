// ─── PRICE HISTORY ─────────────────────────────────────────────────────────────
// Proxies Polymarket CLOB `prices-history` for one or more clobTokenIds and
// returns a normalized shape the frontend can pass directly to <Sparkline>.
//
// Endpoint: GET /api/price-history
//
// Query params:
//   clobTokenIds   comma-separated list of clobTokenIds (required)
//   interval       "1h" | "6h" | "1d" | "1w" | "1m" | "max"    (default "1w")
//   fidelity       resolution in minutes                        (default 60)
//
// Response:
//   {
//     ok: true,
//     interval, fidelity,
//     history: {
//       "<clobTokenId>": [ { t: <unix seconds>, p: <0-100 number> }, ... ],
//       ...
//     }
//   }
//
// Edge-cached for 5 minutes so MarketsGrid's initial fetch doesn't hammer CLOB.

import { applyCors } from './_lib/cors.js';
import { rateLimit, clientIp } from './_lib/rate-limit.js';

const CLOB_BASE = 'https://clob.polymarket.com';

async function fetchOne(tokenId, interval, fidelity) {
  const url = `${CLOB_BASE}/prices-history?market=${encodeURIComponent(tokenId)}&interval=${interval}&fidelity=${fidelity}`;
  try {
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'pronos.io/1.0' },
    });
    if (!r.ok) return { tokenId, points: [], error: `HTTP ${r.status}` };
    const data = await r.json();
    // CLOB returns { history: [{ t: <unix>, p: <0..1> }, ...] }
    const raw = Array.isArray(data?.history) ? data.history : [];
    const points = raw
      .map(pt => ({
        t: Number(pt.t),
        p: Math.round(Number(pt.p) * 10000) / 100, // 0..100, two decimals
      }))
      .filter(pt => Number.isFinite(pt.t) && Number.isFinite(pt.p));
    return { tokenId, points };
  } catch (e) {
    return { tokenId, points: [], error: e.message };
  }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Rate limit upstream fanout. A single request with 120 tokenIds creates
  // 120 concurrent fetches to CLOB — a handful of those per second from the
  // same IP can easily trip Polymarket's rate limits and hurt every Pronos
  // user. 30/min/IP is plenty for normal browsing.
  const limited = rateLimit(req, res, {
    key: `price-history:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const raw = (req.query.clobTokenIds || '').trim();
  if (!raw) return res.status(400).json({ error: 'clobTokenIds required' });

  // Dedupe + cap to avoid runaway parallel fetches
  const ids = Array.from(new Set(raw.split(',').map(s => s.trim()).filter(Boolean))).slice(0, 120);

  const allowedIntervals = new Set(['1h', '6h', '1d', '1w', '1m', 'max']);
  const interval = allowedIntervals.has(req.query.interval) ? req.query.interval : '1w';
  const fidelity = Math.min(Math.max(parseInt(req.query.fidelity, 10) || 60, 1), 1440);

  try {
    // Batch upstream fetches so we don't open 120 parallel connections to
    // CLOB at once — that trips their per-IP rate limit and can return
    // 429s for every token. 10 parallel at a time is fast and polite.
    const BATCH_SIZE = 10;
    const history = {};
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(id => fetchOne(id, interval, fidelity)));
      for (const r of results) history[r.tokenId] = r.points;
    }

    // Edge cache — prices move, but 5 min is fine for sparklines
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ok: true, interval, fidelity, history });
  } catch (e) {
    console.error('price-history error:', { message: e?.message });
    return res.status(500).json({ ok: false, error: 'Upstream unavailable' });
  }
}
