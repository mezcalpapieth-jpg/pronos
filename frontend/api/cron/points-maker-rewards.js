/**
 * Daily maker-reward payout for Points limit orders.
 *
 * Open bids/asks accrue while they rest near the AMM price. This cron
 * pays the accrued amount once per day, capped per user so the reward
 * feels meaningful without making one account farm the whole pool.
 *
 * Env vars:
 *   DATABASE_URL   (required)
 *   CRON_SECRET    (required in production; optional locally)
 *
 * GET /api/cron/points-maker-rewards       — pay accrued maker rewards
 * GET /api/cron/points-maker-rewards?dry=1 — report candidate count only
 */

import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { withTransaction } from '../_lib/db-tx.js';
import {
  MAKER_REWARD_MAX_DAILY_PER_USER,
  payDailyMakerRewards,
} from '../_lib/points-limit-orders.js';

const schemaSql = neon(process.env.DATABASE_URL);
const readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

function authorizeCron(req, res) {
  const secret = process.env.CRON_SECRET;
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);
  if (!secret) {
    if (isVercelDeploy) {
      res.status(503).json({ error: 'CRON_SECRET not configured' });
      return false;
    }
    return true;
  }
  const provided = req.query.key || (req.headers.authorization || '').replace('Bearer ', '');
  if (provided !== secret) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!authorizeCron(req, res)) return;

  const dryRun = req.query.dry === '1' || req.query.dry === 'true';
  const maxOrders = Number.parseInt(req.query.limit, 10) || 500;
  const started = Date.now();

  try {
    await ensurePointsSchema(schemaSql);

    if (dryRun) {
      const candidates = await readSql`
        SELECT COUNT(*)::int AS count
          FROM points_limit_orders o
          JOIN points_markets m ON m.id = o.market_id
         WHERE o.status = 'open'
           AND COALESCE(m.mode, 'points') = 'points'
           AND m.status = 'active'
           AND (m.end_time IS NULL OR m.end_time > NOW())
      `;
      return res.status(200).json({
        ok: true,
        dryRun: true,
        candidates: Number(candidates[0]?.count || 0),
        elapsedMs: Date.now() - started,
      });
    }

    const report = await withTransaction((client) => payDailyMakerRewards(client, { maxOrders }));
    return res.status(200).json({
      ok: true,
      ...report,
      dailyCap: MAKER_REWARD_MAX_DAILY_PER_USER,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    console.error('[cron/points-maker-rewards] failed', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'maker_rewards_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
