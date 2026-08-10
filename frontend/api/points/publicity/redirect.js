/**
 * GET /api/points/publicity/redirect?source=instagram|tiktok|x
 *
 * Clean social-bio links (/i, /t, /x and /points/... aliases) rewrite here
 * in production. The endpoint records a daily aggregate, stores a short-lived
 * source cookie, then redirects into the public points home.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { clientIp, rateLimit } from '../../_lib/rate-limit.js';
import {
  ensurePublicityVisitorId,
  hashPublicityVisitorKey,
  normalizePublicitySource,
  setPublicityCookies,
} from '../../_lib/publicity.js';

const sql = neon(process.env.DATABASE_URL);

function redirectTarget(source) {
  if (!source) return '/points/';
  const params = new URLSearchParams({
    utm_source: source,
    utm_medium: 'social',
    utm_campaign: 'bio',
  });
  return `/points/?${params.toString()}`;
}

function redirect(res, source) {
  res.setHeader('Cache-Control', 'no-store, no-cache');
  res.setHeader('Location', redirectTarget(source));
  return res.status(302).end();
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, HEAD, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const source = normalizePublicitySource(req.query?.source || req.query?.s);
  if (!source) return redirect(res, null);
  if (req.method === 'HEAD') return redirect(res, source);

  const limited = rateLimit(req, res, {
    key: `points-publicity:${clientIp(req)}:${source}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return;

  const visitorId = ensurePublicityVisitorId(req);
  const visitorKey = hashPublicityVisitorKey(visitorId);
  setPublicityCookies(req, res, { visitorId, source });

  try {
    await ensurePointsSchema(sql);
    const uniqueRows = await sql`
      INSERT INTO points_publicity_visitors (visitor_key, source, day, first_seen_at)
      VALUES (${visitorKey}, ${source}, CURRENT_DATE, NOW())
      ON CONFLICT DO NOTHING
      RETURNING 1
    `;
    const uniqueVisitor = uniqueRows.length > 0 ? 1 : 0;
    await sql`
      INSERT INTO points_publicity_daily (
        source, day, visits, unique_visitors, conversions, last_seen_at
      )
      VALUES (${source}, CURRENT_DATE, 1, ${uniqueVisitor}, 0, NOW())
      ON CONFLICT (source, day) DO UPDATE
      SET visits = points_publicity_daily.visits + 1,
          unique_visitors = points_publicity_daily.unique_visitors + EXCLUDED.unique_visitors,
          last_seen_at = NOW()
    `;
  } catch (e) {
    console.error('[points/publicity/redirect] error', { message: e?.message, code: e?.code });
  }

  return redirect(res, source);
}
