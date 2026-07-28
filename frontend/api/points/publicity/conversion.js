/**
 * POST /api/points/publicity/conversion
 *
 * When an authenticated points user is present after landing from a social
 * bio link, attribute that username once to the stored publicity source.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { clientIp, rateLimit } from '../../_lib/rate-limit.js';
import { readSession } from '../../_lib/session.js';
import {
  hashPublicityVisitorKey,
  readPublicityCookies,
} from '../../_lib/publicity.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let session = null;
  try {
    session = readSession(req, res);
  } catch {
    return res.status(200).json({ ok: true, recorded: false });
  }
  if (!session?.username) {
    return res.status(200).json({ ok: true, recorded: false, reason: 'not_authenticated' });
  }

  const limited = rateLimit(req, res, {
    key: `points-publicity-conversion:${clientIp(req)}:${session.username}`,
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return;

  const { visitorId, source } = readPublicityCookies(req);
  if (!source) {
    return res.status(200).json({ ok: true, recorded: false, reason: 'no_source' });
  }
  const visitorKey = visitorId ? hashPublicityVisitorKey(visitorId) : null;

  try {
    await ensurePointsSchema(sql);
    const rows = await sql`
      INSERT INTO points_publicity_attributions (username, source, visitor_key, converted_at)
      VALUES (${session.username}, ${source}, ${visitorKey}, NOW())
      ON CONFLICT (username) DO NOTHING
      RETURNING username
    `;
    const recorded = rows.length > 0;
    if (recorded) {
      await sql`
        INSERT INTO points_publicity_daily (
          source, day, visits, unique_visitors, conversions, last_seen_at
        )
        VALUES (${source}, CURRENT_DATE, 0, 0, 1, NOW())
        ON CONFLICT (source, day) DO UPDATE
        SET conversions = points_publicity_daily.conversions + 1,
            last_seen_at = NOW()
      `;
    }
    return res.status(200).json({ ok: true, recorded, source });
  } catch (e) {
    console.error('[points/publicity/conversion] error', { message: e?.message, code: e?.code });
    return res.status(200).json({ ok: true, recorded: false });
  }
}
