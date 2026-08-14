/**
 * POST /api/points/admin/convert-parallel-binary
 * Body: { marketId }
 *
 * Converts a two-leg UFC parallel parent into one unified binary
 * market when there is no current public exposure. Historical
 * round-trip trades are allowed; open orders or non-zero positions
 * still refuse the conversion.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { binaryPrices } from '../../_lib/amm-math.js';
import { seedLiquiditiesFromProbabilities } from '../../_lib/market-pricing.js';
import {
  parseJsonb,
  PRONOS_TREASURY_USERNAME,
  releaseOpenLimitOrdersForMarkets,
} from '../../_lib/points-limit-orders.js';

const schemaSql = neon(process.env.DATABASE_URL);

function httpError(message, status = 400, detail = null) {
  const err = new Error(message);
  err.status = status;
  err.detail = detail;
  return err;
}

function cleanLabels(value) {
  return parseJsonb(value, [])
    .map(v => String(v || '').trim())
    .filter(Boolean);
}

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function orderedLegsForOutcomes(legs, outcomes) {
  const byLabel = new Map();
  for (const leg of legs) {
    const key = normalizeLabel(leg.leg_label);
    if (key && !byLabel.has(key)) byLabel.set(key, leg);
  }
  const ordered = outcomes.map(label => byLabel.get(normalizeLabel(label))).filter(Boolean);
  return ordered.length === legs.length ? ordered : legs;
}

function orderedFighterIdsForOutcomes(cfg, outcomes) {
  if (Array.isArray(cfg?.fighterIds) && cfg.fighterIds.length === outcomes.length) {
    return cfg.fighterIds.map(id => String(id || ''));
  }
  const cfgLegs = Array.isArray(cfg?.legs) ? cfg.legs : [];
  if (cfgLegs.length === 0) return [];
  const byLabel = new Map();
  for (const leg of cfgLegs) {
    const key = normalizeLabel(leg?.label);
    if (key && !byLabel.has(key)) byLabel.set(key, leg);
  }
  return outcomes.map(label => String(byLabel.get(normalizeLabel(label))?.driverId || ''));
}

function yesProbabilityFromLeg(leg) {
  const reserves = parseJsonb(leg.reserves, []).map(Number);
  if (reserves.length < 2 || reserves.some(v => !Number.isFinite(v) || v <= 0)) return null;
  const [yes] = binaryPrices(reserves);
  return Number.isFinite(yes) && yes > 0 && yes < 1 ? yes : null;
}

function fallbackSeed(parent, legs) {
  const parentSeed = Number(parent.seed_liquidity || 0);
  if (Number.isFinite(parentSeed) && parentSeed >= 100) return parentSeed;
  const legSeeds = legs
    .map(leg => Number(leg.seed_liquidity || 0))
    .filter(v => Number.isFinite(v) && v >= 100);
  if (legSeeds.length > 0) {
    return legSeeds.reduce((sum, value) => sum + value, 0) / legSeeds.length;
  }
  return 800;
}

function publicActivityCounts(row) {
  return {
    trades: Number(row?.trades || 0),
    openOrders: Number(row?.open_orders || 0),
    positions: Number(row?.positions || 0),
  };
}

function hasCurrentPublicExposure(counts) {
  return counts.openOrders > 0 || counts.positions > 0;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const mid = Number.parseInt(req.body?.marketId, 10);
  if (!Number.isInteger(mid) || mid <= 0) {
    return res.status(400).json({ error: 'invalid_market_id' });
  }

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      const marketResult = await client.query(
        `SELECT id, question, status, amm_mode, parent_id, outcomes, reserves,
                seed_liquidity, seed_liquidities, resolver_type, resolver_config,
                source, source_data, sport, league
           FROM points_markets
          WHERE id = $1
          FOR UPDATE`,
        [mid],
      );
      if (marketResult.rows.length === 0) throw httpError('market_not_found', 404);

      const market = marketResult.rows[0];
      if (market.parent_id) {
        throw httpError('cannot_convert_leg_directly', 400, `Market ${mid} is a child leg.`);
      }
      if (market.status !== 'active') {
        throw httpError('market_not_active', 400, `Current status is ${market.status}.`);
      }
      if (market.amm_mode !== 'parallel') {
        throw httpError('market_not_parallel', 400, `Current AMM mode is ${market.amm_mode || 'unified'}.`);
      }

      const cfg = parseJsonb(market.resolver_config, {});
      if (market.resolver_type !== 'sports_api' || cfg?.source !== 'espn-mma') {
        throw httpError('unsupported_conversion', 400, 'Only ESPN MMA UFC fight markets can be converted.');
      }

      const legResult = await client.query(
        `SELECT id, parent_id, leg_label, status, reserves, seed_liquidity
           FROM points_markets
          WHERE parent_id = $1
          ORDER BY id ASC
          FOR UPDATE`,
        [mid],
      );
      const legs = legResult.rows;
      if (legs.length !== 2 || legs.some(leg => leg.status !== 'active')) {
        throw httpError('invalid_parallel_shape', 400, 'Expected exactly two active child legs.');
      }

      const fallbackOutcomes = legs.map(leg => String(leg.leg_label || '').trim()).filter(Boolean);
      const outcomes = cleanLabels(market.outcomes);
      const nextOutcomes = outcomes.length === 2 ? outcomes : fallbackOutcomes;
      if (nextOutcomes.length !== 2) {
        throw httpError('invalid_outcomes', 400, 'Expected exactly two fighter outcomes.');
      }

      const relatedIds = [Number(market.id), ...legs.map(leg => Number(leg.id))];
      const activity = await client.query(
        `SELECT
           (SELECT COUNT(*)::int
              FROM points_trades
             WHERE market_id = ANY($1::int[])
               AND username <> $2) AS trades,
           (SELECT COUNT(*)::int
              FROM points_limit_orders
             WHERE market_id = ANY($1::int[])
               AND status = 'open'
               AND username <> $2) AS open_orders,
           (SELECT COUNT(*)::int
              FROM points_positions
             WHERE market_id = ANY($1::int[])
               AND username <> $2
               AND (shares > 0 OR cost_basis > 0)) AS positions`,
        [relatedIds, PRONOS_TREASURY_USERNAME],
      );
      const counts = publicActivityCounts(activity.rows[0]);
      if (hasCurrentPublicExposure(counts)) {
        throw httpError('parallel_market_has_exposure', 409, {
          ...counts,
          hint: 'Cancel/refund this market and create a fresh binary version instead.',
        });
      }

      const orderedLegs = orderedLegsForOutcomes(legs, nextOutcomes);
      const probabilities = orderedLegs.map(yesProbabilityFromLeg);
      const validProbabilities = probabilities.every(p => Number.isFinite(p) && p > 0 && p < 1)
        ? probabilities
        : [0.5, 0.5];
      const seedLiquidity = fallbackSeed(market, orderedLegs);
      const priced = seedLiquiditiesFromProbabilities(validProbabilities, {
        seedLiquidity,
        minProbability: 0.01,
      });
      if (priced.error || !Array.isArray(priced.seedLiquidities) || priced.seedLiquidities.length !== 2) {
        throw httpError('pricing_failed', 500, priced.error || null);
      }

      await releaseOpenLimitOrdersForMarkets(client, relatedIds, {
        reason: 'parallel_to_binary_conversion',
        status: 'cancelled',
      });

      const nextResolverConfig = {
        ...cfg,
        shape: 'binary',
        homeName: nextOutcomes[0],
        awayName: nextOutcomes[1],
        fighterIds: orderedFighterIdsForOutcomes(cfg, nextOutcomes),
      };
      delete nextResolverConfig.legs;

      const sourceData = parseJsonb(market.source_data, {});
      const nextSourceData = {
        ...(sourceData && typeof sourceData === 'object' ? sourceData : {}),
        convertedFromParallel: {
          at: new Date().toISOString(),
          by: admin.username,
          previousShape: 'parallel',
          legIds: orderedLegs.map(leg => Number(leg.id)),
        },
      };

      await client.query(
        `UPDATE points_markets
            SET amm_mode = 'unified',
                outcomes = $2::jsonb,
                reserves = $3::jsonb,
                seed_liquidity = $4,
                seed_liquidities = $3::jsonb,
                resolver_config = $5::jsonb,
                source_data = $6::jsonb
          WHERE id = $1`,
        [
          mid,
          JSON.stringify(nextOutcomes),
          JSON.stringify(priced.seedLiquidities),
          seedLiquidity,
          JSON.stringify(nextResolverConfig),
          JSON.stringify(nextSourceData),
        ],
      );

      await client.query(
        `UPDATE points_markets
            SET status = 'canceled',
                outcome = NULL,
                resolved_at = NOW(),
                resolved_by = $2
          WHERE parent_id = $1
            AND status = 'active'`,
        [mid, admin.username],
      );

      return {
        ok: true,
        marketId: mid,
        ammMode: 'unified',
        outcomes: nextOutcomes,
        reserves: priced.seedLiquidities,
        canceledLegIds: orderedLegs.map(leg => Number(leg.id)),
      };
    });

    return res.status(200).json(result);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail || null });
    }
    console.error('[admin/convert-parallel-binary] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'convert_parallel_binary_failed',
      detail: e?.message?.slice(0, 240) || null,
      code: e?.code || null,
    });
  }
}
