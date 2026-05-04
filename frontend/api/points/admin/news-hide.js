/**
 * Admin endpoint to hide / unhide news items from the /c/noticias feed.
 *
 *   POST /api/points/admin/news-hide
 *     body: { newsUrl, newsTitle? }
 *     → upsert into points_news_hidden
 *
 *   DELETE /api/points/admin/news-hide?newsUrl=...
 *     → un-hide (item reappears on next cache refresh)
 *
 * Persistent: news.js LEFT JOINs points_news_hidden and drops
 * matching items, so a hide survives cache refreshes even when the
 * same article re-enters the feed from a different outlet's batch.
 *
 * Idempotent on POST via ON CONFLICT — re-hiding the same URL
 * doesn't error.
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
      const { newsUrl: rawUrl, newsTitle } = req.body || {};
      if (!isValidUrl(rawUrl)) return res.status(400).json({ error: 'invalid_news_url' });
      // Canonicalize so a re-enter of the same article (with fresh
      // tracking params) still matches the hide flag.
      const newsUrl = canonicalizeUrl(rawUrl);
      const titleClipped = typeof newsTitle === 'string' ? newsTitle.slice(0, 280) : null;

      await sql`
        INSERT INTO points_news_hidden (news_url, news_title, hidden_by)
        VALUES (${newsUrl}, ${titleClipped}, ${admin.username})
        ON CONFLICT (news_url) DO UPDATE
          SET news_title = COALESCE(EXCLUDED.news_title, points_news_hidden.news_title),
              hidden_by = EXCLUDED.hidden_by,
              hidden_at = NOW()
      `;

      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const rawUrl = req.query.newsUrl || req.body?.newsUrl;
      if (!isValidUrl(rawUrl)) return res.status(400).json({ error: 'invalid_news_url' });
      const newsUrl = canonicalizeUrl(rawUrl);
      await sql`DELETE FROM points_news_hidden WHERE news_url = ${newsUrl}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[admin/news-hide] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'news_hide_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
