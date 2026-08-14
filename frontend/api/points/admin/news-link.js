/**
 * Admin endpoint to link / unlink a news headline to an existing market.
 *
 *   POST /api/points/admin/news-link
 *     body: { newsUrl, newsTitle?, newsSource?, marketId }
 *     → upsert link
 *
 *   DELETE /api/points/admin/news-link?newsUrl=...
 *     → remove link
 *
 * The link is consumed by /api/points/news, which joins points_news_links
 * to enrich each item with a `linkedMarketId` (and a small bit of the
 * linked market's metadata) so the news card can render a "📊 Ver
 * mercado" CTA inline.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { canonicalizeUrl } from '../../_lib/news-mexico.js';

const sql = neon(process.env.DATABASE_URL);

function isValidUrl(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > 2048) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, DELETE, OPTIONS', credentials: true });
    if (cors) return cors;

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    await ensurePointsSchema(sql);

    if (req.method === 'POST') {
      const { newsUrl: rawUrl, newsTitle, newsSource, marketId } = req.body || {};
      if (!isValidUrl(rawUrl)) return res.status(400).json({ error: 'invalid_news_url' });
      // Store the canonical form so re-fetches that ship the URL with
      // different tracking params still match on lookup. Without this,
      // a vinculo set today disappears tomorrow when Google News
      // refreshes the feed with a new utm_source on the same article.
      const newsUrl = canonicalizeUrl(rawUrl);
      const mid = Number(marketId);
      if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });

      // Verify the market exists and isn't archived. Linking a soft-
      // deleted market would render a dead "Ver mercado" button.
      const exists = await sql`
        SELECT id FROM points_markets
        WHERE id = ${mid} AND archived_at IS NULL
        LIMIT 1
      `;
      if (exists.length === 0) return res.status(404).json({ error: 'market_not_found' });

      const titleClipped = typeof newsTitle === 'string' ? newsTitle.slice(0, 280) : null;
      const sourceClipped = typeof newsSource === 'string' ? newsSource.slice(0, 80) : null;

      await sql`
        INSERT INTO points_news_links (news_url, news_title, news_source, market_id, linked_by)
        VALUES (${newsUrl}, ${titleClipped}, ${sourceClipped}, ${mid}, ${admin.username})
        ON CONFLICT (news_url) DO UPDATE
          SET market_id = EXCLUDED.market_id,
              news_title = COALESCE(EXCLUDED.news_title, points_news_links.news_title),
              news_source = COALESCE(EXCLUDED.news_source, points_news_links.news_source),
              linked_by = EXCLUDED.linked_by,
              created_at = NOW()
      `;

      return res.status(200).json({ ok: true, marketId: mid });
    }

    if (req.method === 'DELETE') {
      const rawUrl = req.query.newsUrl || req.body?.newsUrl;
      if (!isValidUrl(rawUrl)) return res.status(400).json({ error: 'invalid_news_url' });
      // Match canonical form to delete what was actually stored.
      const newsUrl = canonicalizeUrl(rawUrl);
      await sql`DELETE FROM points_news_links WHERE news_url = ${newsUrl}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[admin/news-link] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'news_link_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
