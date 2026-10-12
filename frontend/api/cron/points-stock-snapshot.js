import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { ensureStockSchema } from '../_lib/stock-schema.js';
import { withTransaction } from '../_lib/db-tx.js';
import { createStockData } from '../_lib/stock-data.js';
import { snapshotStockValuations, stocksAreEnabled } from '../_lib/stock-marks.js';
import { snapshotActiveCycleAtCutoff } from '../_lib/points-cycle-snapshot.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  if (!stocksAreEnabled()) return res.status(200).json({ ok: true, skipped: 'stocks_disabled' });
  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensurePointsSchema(sql);
    await ensureStockSchema(withTransaction);
    // The same minute cron retries a deferred cutoff photo; provider outages
    // leave the previous marks intact and never freeze an estimated winner.
    const cutoff = await withTransaction(db => snapshotActiveCycleAtCutoff(db, { now: new Date() }));
    if (cutoff.skipped !== 'before_cutoff') return res.status(200).json(cutoff);
    const market = await createStockData(sql).assets();
    const result = await withTransaction(db => snapshotStockValuations(db, { market }));
    return res.status(200).json(result);
  } catch (error) {
    console.error('[points-stock-snapshot]', { code: error.code, message: error.message });
    return res.status(503).json({ error: error.code || 'stock_snapshot_failed' });
  }
}
