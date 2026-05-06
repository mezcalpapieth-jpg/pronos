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

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { getMexicanNews, VALID_CATEGORIES } from '../_lib/news-mexico.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

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

    // Enrich items with admin-curated market links + filter out
    // admin-hidden items in a single DB pass per pageload.
    //
    // Hide matching: by URL OR by title. The same article often
    // re-enters the feed under different URL forms — e.g. an El
    // Universal piece appearing once via the www.eluniversal.com.mx
    // homepage scrape and again via the sanluis.eluniversal.com.mx
    // regional subdomain. Hiding the URL form the admin clicked on
    // doesn't catch the other form. The title is stable across these
    // variants, so we OR the lookups.
    let linkedByUrl = new Map();
    let hiddenUrls = new Set();
    let hiddenTitles = new Set();
    try {
      await ensurePointsSchema(schemaSql);
      const urls = data.items.map(i => i.url).filter(Boolean);
      const titles = data.items.map(i => i.title).filter(Boolean);
      if (urls.length > 0) {
        const [links, hidden] = await Promise.all([
          sql`
            SELECT nl.news_url, nl.market_id,
                   m.question AS market_question,
                   m.status   AS market_status,
                   m.category AS market_category,
                   m.icon     AS market_icon,
                   m.outcome  AS market_outcome
            FROM points_news_links nl
            LEFT JOIN points_markets m ON m.id = nl.market_id
            WHERE nl.news_url = ANY(${urls}::text[])
              AND nl.market_id IS NOT NULL
              AND (m.archived_at IS NULL OR m.id IS NULL)
          `,
          sql`
            SELECT news_url, news_title FROM points_news_hidden
            WHERE news_url   = ANY(${urls}::text[])
               OR news_title = ANY(${titles}::text[])
          `,
        ]);
        for (const r of links) {
          linkedByUrl.set(r.news_url, {
            marketId: Number(r.market_id),
            question: r.market_question,
            status:   r.market_status,
            category: r.market_category,
            icon:     r.market_icon,
            outcome:  r.market_outcome,
          });
        }
        for (const r of hidden) {
          if (r.news_url) hiddenUrls.add(r.news_url);
          if (r.news_title) hiddenTitles.add(r.news_title);
        }
      }
    } catch (e) {
      console.warn('[points/news] link/hide enrichment skipped', { code: e?.code, message: e?.message?.slice(0, 120) });
    }

    // Drop hidden items (URL OR title match) + decorate the rest.
    const enrichedItems = data.items
      .filter(i => !hiddenUrls.has(i.url) && !hiddenTitles.has(i.title))
      .map(i => ({ ...i, linkedMarket: linkedByUrl.get(i.url) || null }));

    // CDN-friendly: cache 60s at the edge while still letting our
    // module-level cache do most of the dedup work.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ ok: true, category, ...data, items: enrichedItems });
  } catch (e) {
    console.error('[points/news] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'news_failed' });
  }
}
