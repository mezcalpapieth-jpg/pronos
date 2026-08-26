/**
 * GET /api/cron/points-tournament-snapshot
 *
 * Non-destructive tournament cutoff photo. It freezes the active cycle
 * leaderboard in points_cycle_snapshots once the configured Mexico City
 * cutoff has passed, but does not close the cycle, clear positions, cancel
 * orders, or reset balances. The full rollover remains an admin action for
 * the September 1 cycle reset.
 */
import { neon } from '@neondatabase/serverless';

import { ensurePointsSchema } from '../_lib/points-schema.js';
import { withTransaction } from '../_lib/db-tx.js';
import { snapshotActiveCycleAtCutoff } from '../_lib/points-cycle-snapshot.js';

const sql = neon(process.env.DATABASE_URL);

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);
  if (!secret) return !isVercelDeploy;
  const auth = req.headers.authorization || '';
  const provided = req.query?.key || auth.replace(/^Bearer\s+/i, '');
  return provided === secret;
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const started = Date.now();
  try {
    await ensurePointsSchema(sql);
    const result = await withTransaction((client) => (
      snapshotActiveCycleAtCutoff(client, { now: new Date() })
    ));
    return res.status(200).json({
      ...result,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    console.error('[cron/points-tournament-snapshot] failed', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'tournament_snapshot_failed',
      detail: e?.message?.slice(0, 240) || null,
      elapsedMs: Date.now() - started,
    });
  }
}
