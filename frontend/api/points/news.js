/**
 * GET /api/points/news[?category=<slug>][&limit=<n>]
 *
 * Public endpoint that returns the aggregated Mexican news feed.
 * Used by the /c/noticias page in the points-app.
 *
 *   category: one of NEWS_CATEGORIES (default 'featured' = all)
 *   limit:    1..60, default 60
 *
 * Caching: in-memory module cache inside _lib/news-mexico.js, 5-min TTL,
 * stale-while-revalidate. Per-IP rate-limit on top so a misbehaving
 * client doesn't hammer the underlying RSS feeds via cache misses.
 */

import { applyCors } from '../_lib/cors.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { getMexicanNews, VALID_CATEGORIES } from '../_lib/news-mexico.js';

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    // Per-IP rate limit. The cache TTL is 5min so most calls are
    // cheap (in-memory hit), but if someone scripts the endpoint we
    // still want a ceiling. 60/min is generous for normal browsing.
    const limited = rateLimit(req, res, {
      key: `news:${clientIp(req)}`,
      limit: 60,
      windowMs: 60_000,
    });
    if (limited) return;

    const rawCategory = String(req.query.category || 'featured').toLowerCase();
    const category = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : 'featured';
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(60, Math.floor(rawLimit))
      : 60;

    const data = await getMexicanNews({ category, limit });

    // CDN-friendly: cache 60s at the edge while still letting our
    // module-level cache do most of the dedup work.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ ok: true, category, ...data });
  } catch (e) {
    console.error('[points/news] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'news_failed' });
  }
}
