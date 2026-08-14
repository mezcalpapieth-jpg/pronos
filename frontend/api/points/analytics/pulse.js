/**
 * POST /api/points/analytics/pulse
 *
 * Lightweight authenticated heartbeat for admin engagement analytics.
 * Stores only daily aggregate seconds per username, plus the last path
 * seen, so admin can compare time spent without keeping a raw session log.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { readSession } from '../../_lib/session.js';
import { clientIp, rateLimit } from '../../_lib/rate-limit.js';

const sql = neon(process.env.DATABASE_URL);

function cleanPath(value) {
  const path = String(value || '').trim();
  if (!path || path.length > 240) return null;
  if (!path.startsWith('/')) return null;
  return path;
}

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
    return res.status(200).json({ ok: true, recorded: false });
  }

  const limited = rateLimit(req, res, {
    key: `points-site-time:${clientIp(req)}:${session.username}`,
    limit: 8,
    windowMs: 60_000,
  });
  if (limited) return;

  const rawSeconds = Number(req.body?.seconds);
  const seconds = Math.max(0, Math.min(120, Math.round(rawSeconds || 0)));
  if (seconds < 1) {
    return res.status(200).json({ ok: true, recorded: false });
  }

  try {
    await ensurePointsSchema(sql);
    await sql`
      INSERT INTO points_site_time_daily (username, day, seconds, last_path, last_seen_at)
      VALUES (${session.username}, CURRENT_DATE, ${seconds}, ${cleanPath(req.body?.path)}, NOW())
      ON CONFLICT (username, day) DO UPDATE
      SET seconds = points_site_time_daily.seconds + EXCLUDED.seconds,
          last_path = COALESCE(EXCLUDED.last_path, points_site_time_daily.last_path),
          last_seen_at = NOW()
    `;
    return res.status(200).json({ ok: true, recorded: true });
  } catch (e) {
    console.error('[points/analytics/pulse] error', { message: e?.message, code: e?.code });
    return res.status(200).json({ ok: true, recorded: false });
  }
}
