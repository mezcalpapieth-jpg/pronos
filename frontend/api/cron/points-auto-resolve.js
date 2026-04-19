/**
 * Points-app auto-resolver.
 *
 * Scans points_markets for active rows whose trading window has closed
 * AND whose resolver_type is one we know how to settle automatically.
 * Today: only 'chainlink_price' (reads the feed via JSON-RPC, compares
 * to resolver_config.threshold, flips status=resolved). Future resolver
 * types (sports_api, polymarket_mirror) plug into the same dispatch.
 *
 * Intentionally a SEPARATE cron from /api/cron/auto-resolve — that one
 * is MVP-only and handles Polymarket-backed on-chain markets, which
 * doesn't apply to the off-chain points app.
 *
 * Env vars:
 *   DATABASE_URL   (required)
 *   CRON_SECRET    (required in production)
 *   CHAINLINK_RPC_URL  (optional — override default public RPC)
 *
 * GET /api/cron/points-auto-resolve              — run the resolver
 * GET /api/cron/points-auto-resolve?dry=1        — log candidates + feed
 *                                                  reads without writing
 */

import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { withTransaction } from '../_lib/db-tx.js';
import { readChainlinkPrice, comparePrice } from '../_lib/chainlink.js';

const schemaSql = neon(process.env.DATABASE_URL);
const readSql   = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

function parseJsonb(v, fb) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

export default async function handler(req, res) {
  // Same cron-guard pattern as every other /api/cron/* endpoint.
  const secret = process.env.CRON_SECRET;
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);
  if (!secret) {
    if (isVercelDeploy) {
      return res.status(503).json({ error: 'CRON_SECRET not configured' });
    }
    // Local dev — allow through.
  } else {
    const provided = req.query.key || (req.headers.authorization || '').replace('Bearer ', '');
    if (provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  }

  const dry = req.query.dry === '1' || req.query.dry === 'true';
  const started = Date.now();

  try {
    await ensurePointsSchema(schemaSql);

    // Only parents — parallel legs are resolved via the parent cascade
    // path elsewhere (admin resolve on the parent fans out to legs).
    // Chainlink-resolved markets are always unified binary today.
    const candidates = await readSql`
      SELECT id, question, end_time, resolver_type, resolver_config, outcomes
      FROM points_markets
      WHERE status = 'active'
        AND resolver_type = 'chainlink_price'
        AND end_time IS NOT NULL
        AND end_time < NOW()
        AND parent_id IS NULL
      LIMIT 100
    `;

    const report = {
      checked: candidates.length,
      resolved: [],
      errors: [],
      dryRun: dry,
    };

    for (const m of candidates) {
      const cfg = parseJsonb(m.resolver_config, null);
      if (!cfg?.feedAddress || !cfg?.op || cfg.threshold == null || cfg.yesOutcome == null) {
        report.errors.push({ id: m.id, error: 'invalid_resolver_config' });
        continue;
      }

      let price;
      try {
        price = await readChainlinkPrice({
          feedAddress: cfg.feedAddress,
          chainId: cfg.chainId,
        });
      } catch (e) {
        report.errors.push({ id: m.id, error: `feed_read_failed: ${e.message}` });
        continue;
      }

      const yes = comparePrice(price, cfg.op, Number(cfg.threshold));
      const yesIdx = Number(cfg.yesOutcome);
      const winningIdx = yes ? yesIdx : (1 - yesIdx);

      if (dry) {
        report.resolved.push({
          id: m.id,
          priceAtResolve: price,
          op: cfg.op,
          threshold: cfg.threshold,
          winningIdx,
          dry: true,
        });
        continue;
      }

      try {
        await withTransaction(async (client) => {
          // Guard: only flip if still active — tolerates admin resolving
          // the market manually between our SELECT and UPDATE.
          const r = await client.query(
            `UPDATE points_markets
               SET status = 'resolved', outcome = $1,
                   resolved_at = NOW(), resolved_by = 'chainlink'
             WHERE id = $2 AND status = 'active'
             RETURNING id`,
            [winningIdx, m.id],
          );
          if (r.rows.length === 0) {
            const err = new Error('not_active_at_write'); err.benign = true; throw err;
          }
        });
        report.resolved.push({
          id: m.id,
          priceAtResolve: price,
          op: cfg.op,
          threshold: cfg.threshold,
          winningIdx,
        });
      } catch (e) {
        if (e.benign) continue; // already resolved by admin — fine
        report.errors.push({ id: m.id, error: `write_failed: ${e.message}` });
      }
    }

    return res.status(200).json({
      ok: true,
      tookMs: Date.now() - started,
      ...report,
    });
  } catch (e) {
    console.error('[cron/points-auto-resolve] fatal', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'resolve_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
