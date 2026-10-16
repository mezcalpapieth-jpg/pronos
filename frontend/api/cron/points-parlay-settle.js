/**
 * GET /api/cron/points-parlay-settle
 *
 * Compatibility route for cutoff collection and the atomic tournament freeze.
 * Before cutoff, winnings remain available for manual collection.
 */
import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { withTransaction } from '../_lib/db-tx.js';
import { snapshotActiveCycleAtCutoff } from '../_lib/points-cycle-snapshot.js';
import { stocksAreEnabled } from '../_lib/stock-marks.js';
import { ensureStockSchema } from '../_lib/stock-schema.js';

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
    if (stocksAreEnabled()) await ensureStockSchema(withTransaction);
    // Preserve manual collection until cutoff; use the same atomic freeze path.
    const result = await withTransaction(client => snapshotActiveCycleAtCutoff(client));
    return res.status(200).json({
      ok: true,
      ...result,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    console.error('[cron/points-parlay-settle] failed', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'parlay_settle_failed',
      detail: e?.message?.slice(0, 240) || null,
      elapsedMs: Date.now() - started,
    });
  }
}
