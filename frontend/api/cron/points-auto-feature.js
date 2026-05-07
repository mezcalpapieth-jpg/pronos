/**
 * GET /api/cron/points-auto-feature  (Vercel cron, every 5 min)
 *
 * Auto-toggles points_markets.featured based on whether the market
 * is currently in its game window (start_time <= NOW() < end_time).
 *
 * Two passes per tick:
 *   1. ON  — flip featured=true on any active market that JUST entered
 *            its game window. We only target rows currently
 *            featured=false so admin-featured rows are never touched.
 *            We stamp auto_featured=true so we know to clean up when
 *            the game ends.
 *
 *   2. OFF — flip featured=false on any row we previously auto-
 *            featured that is no longer live (game ended, market got
 *            resolved, end_time passed, etc). Admin-featured rows
 *            (auto_featured=false) are not touched.
 *
 * The result: live games appear with the trending flame in the admin
 * UI without a manual click; the flame goes out when the game ends
 * unless an admin re-featured it manually in between (which would
 * have set auto_featured=false via the toggle endpoint).
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. We
 * accept that or `?key=${INDEXER_KEY}` for manual triggers.
 */
import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';

const sql = neon(process.env.DATABASE_URL);

function authorized(req) {
  const auth = req.headers.authorization || '';
  const bearerOk = process.env.CRON_SECRET
    && auth === `Bearer ${process.env.CRON_SECRET}`;
  const key = req.query?.key;
  const keyOk = process.env.INDEXER_KEY && key === process.env.INDEXER_KEY;
  return bearerOk || keyOk;
}

export default async function handler(req, res) {
  if (!authorized(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    await ensurePointsSchema(sql);

    // Pass 1 — light up live markets that aren't currently featured.
    // parent_id IS NULL excludes parallel-binary leg rows; the parent
    // carries the displayed featured state.
    const lit = await sql`
      UPDATE points_markets
         SET featured = true,
             auto_featured = true
       WHERE status = 'active'
         AND parent_id IS NULL
         AND start_time IS NOT NULL
         AND start_time <= NOW()
         AND end_time > NOW()
         AND featured = false
       RETURNING id
    `;

    // Pass 2 — turn off the auto-featured ones that are no longer live.
    // Only touches rows we set ourselves (auto_featured=true), so any
    // admin-featured market keeps its flame even after the game ends.
    const dimmed = await sql`
      UPDATE points_markets
         SET featured = false,
             auto_featured = false
       WHERE auto_featured = true
         AND (
              status != 'active'
           OR end_time IS NULL
           OR end_time <= NOW()
           OR start_time IS NULL
           OR start_time > NOW()
         )
       RETURNING id
    `;

    return res.status(200).json({
      ok: true,
      lit: lit.length,
      dimmed: dimmed.length,
      now: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[cron/points-auto-feature] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'auto_feature_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
