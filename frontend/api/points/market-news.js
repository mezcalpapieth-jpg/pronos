/**
 * GET /api/points/market-news?marketId=X[&limit=6]
 *
 * Public inverse lookup for admin-curated news links. /api/points/news
 * decorates each article with its linked market; this endpoint lets the
 * market detail sidebar show the articles linked to the current market.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const limited = rateLimit(req, res, {
      key: `market-news:${clientIp(req)}`,
      limit: 120,
      windowMs: 60_000,
    });
    if (limited) return;

    const marketId = Number(req.query.marketId || req.query.id);
    if (!Number.isInteger(marketId) || marketId <= 0) {
      return res.status(400).json({ error: 'invalid_market_id' });
    }

    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(12, Math.floor(rawLimit))
      : 6;

    await ensurePointsSchema(schemaSql);

    const rows = await sql`
      SELECT nl.news_url, nl.news_title, nl.news_source, nl.created_at
      FROM points_news_links nl
      INNER JOIN points_markets m ON m.id = nl.market_id
      WHERE nl.market_id = ${marketId}
        AND nl.market_id IS NOT NULL
        AND m.archived_at IS NULL
      ORDER BY nl.created_at DESC, nl.id DESC
      LIMIT ${limit}
    `;

    const items = rows.map(row => ({
      url: row.news_url,
      title: row.news_title,
      source: row.news_source,
      linkedAt: row.created_at,
    }));

    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30, stale-while-revalidate=120');
    return res.status(200).json({ ok: true, marketId, items });
  } catch (e) {
    console.error('[points/market-news] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'market_news_failed' });
  }
}
