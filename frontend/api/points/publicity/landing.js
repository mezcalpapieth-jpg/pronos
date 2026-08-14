/**
 * POST /api/points/publicity/landing
 *
 * Pathless-ish social links can use root fragments like https://pronos.io/#a.
 * The browser reads the fragment after the app loads, posts it here, and then
 * the client removes the marker from the address bar.
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

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const source = normalizePublicitySource(req.body?.source);
  if (!source) return res.status(200).json({ ok: true, recorded: false, reason: 'invalid_source' });

  const limited = rateLimit(req, res, {
    key: `points-publicity-landing:${clientIp(req)}:${source}`,
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
    return res.status(200).json({ ok: true, recorded: true, source });
  } catch (e) {
    console.error('[points/publicity/landing] error', { message: e?.message, code: e?.code });
    return res.status(200).json({ ok: true, recorded: false });
  }
}
