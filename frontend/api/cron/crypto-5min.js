/**
 * /api/cron/crypto-5min — Crypto 5-min market boundary processor.
 *
 * Production: invoked indirectly by the existing every-minute Vercel cron
 * (see indexer.js, which calls runCrypto5MinTick at the end of each tick).
 * That avoids burning a second Vercel cron slot.
 *
 * Manual / preview testing: hit this endpoint directly with the cron
 * secret. By default the lifecycle is gated on VERCEL_ENV='production',
 * but the `force=1` query param overrides for admin testing.
 *
 *   POST /api/cron/crypto-5min?key=$CRON_SECRET           # production
 *   POST /api/cron/crypto-5min?key=$CRON_SECRET&dry=1     # report what'd run
 *   POST /api/cron/crypto-5min?key=$CRON_SECRET&force=1   # bypass prod gate
 *
 * Returns the per-asset report from runCrypto5MinTick.
 */

import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { runCrypto5MinTick } from '../_lib/crypto-5min.js';

const schemaSql = neon(process.env.DATABASE_URL);
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  // Same auth pattern as the other points crons — accept Authorization
  // Bearer or ?key= query param. Local dev (no VERCEL_ENV) is allowed
  // through without a secret so admins can poke it offline.
  const secret = process.env.CRON_SECRET;
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);
  if (secret) {
    const provided = req.query.key
      || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  } else if (isVercelDeploy) {
    return res.status(503).json({ error: 'CRON_SECRET not configured' });
  }

  const dry = req.query.dry === '1' || req.query.dry === 'true';
  const force = req.query.force === '1' || req.query.force === 'true';

  try {
    await ensurePointsSchema(schemaSql);
    const result = await runCrypto5MinTick({ sql, dry, force });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error('[cron/crypto-5min] fatal', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'crypto_5min_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
