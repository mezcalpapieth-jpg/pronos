/**
 * POST /api/points/admin/backfill-resolvers           — apply
 * POST /api/points/admin/backfill-resolvers?dry=1     — preview
 *
 * One-shot migration that patches already-approved points_markets
 * rows whose resolver_type is still NULL.
 *
 * Flow:
 *   1. Run every generator inline — same pool as the daily cron.
 *   2. For each spec with a resolver_type, UPDATE points_markets via
 *      the (source, source_event_id) → approved_market_id chain on
 *      points_pending_markets.
 *
 * We bypass the pending-table "is this row's own resolver_type set?"
 * check that the previous version used: pending rows frozen at
 * status='approved' were never refreshed by the DO UPDATE upsert,
 * so the join emptied out even though fresh generator output knows
 * the right value. Going straight from spec → approved market
 * sidesteps that entirely.
 *
 * Idempotent — the WHERE clause pins writes to rows that still have
 * resolver_type IS NULL.
 *
 * Admin-only.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

import { generateSoccerMarkets }        from '../../_lib/market-gen/soccer.js';
import { generateEspnSoccerMarkets }    from '../../_lib/market-gen/espn-soccer.js';
import { generateCryptoMarkets }        from '../../_lib/market-gen/crypto.js';
import { generateStockMarkets }         from '../../_lib/market-gen/stocks.js';
import { generateWeatherMarkets }       from '../../_lib/market-gen/weather.js';
import { generateMlbMarkets }           from '../../_lib/market-gen/mlb.js';
import { generateNbaMarkets }           from '../../_lib/market-gen/nba.js';
import { generateF1Markets }            from '../../_lib/market-gen/f1.js';
import { generateFxMarkets }            from '../../_lib/market-gen/fx.js';
import { generateFuelMarkets }          from '../../_lib/market-gen/fuel.js';
import { generateChartsMarkets }        from '../../_lib/market-gen/charts.js';
import { generateYouTubeMarkets }       from '../../_lib/market-gen/youtube.js';
import { generateEntertainmentMarkets } from '../../_lib/market-gen/entertainment.js';

const sql = neon(process.env.DATABASE_URL);

// Same registry as cron/generate-markets-pending.
const GENERATORS = [
  generateSoccerMarkets, generateEspnSoccerMarkets,
  generateCryptoMarkets, generateStockMarkets, generateFxMarkets, generateFuelMarkets,
  generateWeatherMarkets,
  generateMlbMarkets, generateNbaMarkets, generateF1Markets,
  generateChartsMarkets, generateYouTubeMarkets, generateEntertainmentMarkets,
];

async function collectSpecs() {
  const out = [];
  for (const run of GENERATORS) {
    try {
      const specs = await run();
      if (Array.isArray(specs)) out.push(...specs);
    } catch (e) {
      console.error('[admin/backfill-resolvers] generator failed', { message: e?.message });
    }
  }
  return out;
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const dryRun = req.query.dry === '1' || req.query.dry === 'true';
    await ensurePointsSchema(sql);

    const specs = (await collectSpecs()).filter(s => s && s.resolver_type);

    if (specs.length === 0) {
      return res.status(200).json({
        ok: true,
        dryRun,
        candidateCount: 0,
        updatedCount: 0,
        note: 'No generator returned any spec with a resolver_type — nothing to retrofit.',
      });
    }

    if (dryRun) {
      // Preview = count how many NULL-resolver approved markets the
      // fresh specs would touch. Matches the wet-run where clause
      // exactly so the dry count is truthful.
      const rows = [];
      for (const s of specs) {
        const r = await sql`
          SELECT m.id AS market_id
          FROM points_markets m
          JOIN points_pending_markets pm ON pm.approved_market_id = m.id
          WHERE pm.source = ${s.source}
            AND pm.source_event_id = ${s.source_event_id}
            AND m.resolver_type IS NULL
            AND m.status = 'active'
            AND m.parent_id IS NULL
          LIMIT 1
        `;
        if (r.length > 0) {
          rows.push({
            marketId: r[0].market_id,
            source: s.source,
            sourceEventId: s.source_event_id,
            resolverType: s.resolver_type,
          });
        }
      }
      return res.status(200).json({
        dryRun: true,
        candidateCount: rows.length,
        candidates: rows.slice(0, 50),
        specsTotal: specs.length,
      });
    }

    const updated = [];
    const byResolverType = {};
    for (const s of specs) {
      const r = await sql`
        UPDATE points_markets m
        SET resolver_type   = ${s.resolver_type},
            resolver_config = ${s.resolver_config ? JSON.stringify(s.resolver_config) : null}::jsonb
        FROM points_pending_markets pm
        WHERE pm.source = ${s.source}
          AND pm.source_event_id = ${s.source_event_id}
          AND pm.approved_market_id = m.id
          AND m.resolver_type IS NULL
          AND m.status = 'active'
          AND m.parent_id IS NULL
        RETURNING m.id
      `;
      for (const row of r) {
        updated.push({ marketId: row.id, resolverType: s.resolver_type });
        byResolverType[s.resolver_type] = (byResolverType[s.resolver_type] || 0) + 1;
      }
    }

    return res.status(200).json({
      ok: true,
      updatedCount: updated.length,
      byResolverType,
      updated,
      reviewer: admin.username,
    });
  } catch (e) {
    console.error('[admin/backfill-resolvers] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'backfill_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
