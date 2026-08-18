/**
 * POST /api/points/admin/reopen-canceled-market
 * Body: { marketId, note? }
 *
 * Sends an annulled market back to the pending admin queue. This does not
 * reopen the canceled market and does not touch balances, positions, trades,
 * or refunds. Approval will create a fresh market from the pending spec.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';

const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function jsonParam(value, fallback = null) {
  return JSON.stringify(value ?? fallback);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const { marketId, note } = req.body || {};
  const mid = Number.parseInt(marketId, 10);
  if (!Number.isInteger(mid) || mid <= 0) {
    return res.status(400).json({ error: 'invalid_market_id' });
  }
  const noteText = typeof note === 'string' && note.trim()
    ? note.trim().slice(0, 240)
    : 'manual-reopened from canceled market';

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      const marketRes = await client.query(
        `SELECT id, status, parent_id, source, source_event_id, question, category, icon,
                outcomes, seed_liquidity, seed_liquidities, start_time, end_time,
                amm_mode, outcome_images, resolver_type, resolver_config, sport, league,
                featured, tournament_featured, category_tags, geo_tags, topic_tags
           FROM points_markets
          WHERE id = $1
          FOR UPDATE`,
        [mid],
      );
      if (marketRes.rows.length === 0) {
        const err = new Error('market_not_found'); err.status = 404; throw err;
      }
      const market = marketRes.rows[0];
      if (market.parent_id) {
        const err = new Error('cannot_reopen_leg_directly');
        err.status = 400;
        err.detail = `Market ${mid} is a leg of parent ${market.parent_id}. Reopen the parent instead.`;
        throw err;
      }
      if (market.status !== 'canceled') {
        const err = new Error('market_not_canceled');
        err.status = 400;
        err.detail = `Current status is ${market.status}.`;
        throw err;
      }

      const originalPending = await client.query(
        `SELECT id, status
           FROM points_pending_markets
          WHERE approved_market_id = $1
          ORDER BY reviewed_at DESC NULLS LAST, id DESC
          LIMIT 1
          FOR UPDATE`,
        [mid],
      );

      if (originalPending.rows.length > 0) {
        const pending = originalPending.rows[0];
        if (pending.status !== 'pending') {
          await client.query(
            `UPDATE points_pending_markets
                SET status = 'pending',
                    admin_note = $2,
                    reviewer = $3,
                    reviewed_at = NOW(),
                    approved_market_id = $1
              WHERE id = $4`,
            [mid, noteText, admin.username || 'admin', pending.id],
          );
        }
        return {
          ok: true,
          action: 'reopen_canceled_market',
          marketId: mid,
          pendingId: Number(pending.id),
          reusedPending: true,
          alreadyPending: pending.status === 'pending',
        };
      }

      const source = `manual-reopen:${market.source || 'market'}`;
      const sourceEventId = `market-${mid}`;
      const duplicatePending = await client.query(
        `SELECT id, status
           FROM points_pending_markets
          WHERE source = $1
            AND source_event_id = $2
          LIMIT 1
          FOR UPDATE`,
        [source, sourceEventId],
      );
      if (duplicatePending.rows.length > 0) {
        const pending = duplicatePending.rows[0];
        if (pending.status !== 'pending') {
          await client.query(
            `UPDATE points_pending_markets
                SET status = 'pending',
                    admin_note = $2,
                    reviewer = $3,
                    reviewed_at = NOW(),
                    approved_market_id = $1
              WHERE id = $4`,
            [mid, noteText, admin.username || 'admin', pending.id],
          );
        }
        return {
          ok: true,
          action: 'reopen_canceled_market',
          marketId: mid,
          pendingId: Number(pending.id),
          reusedPending: true,
          alreadyPending: pending.status === 'pending',
        };
      }

      const outcomes = parseJsonb(market.outcomes, ['Sí', 'No']);
      const seedLiquidities = parseJsonb(market.seed_liquidities, null);
      const outcomeImages = parseJsonb(market.outcome_images, null);
      const resolverConfig = parseJsonb(market.resolver_config, null);
      const categoryTags = parseJsonb(market.category_tags, []);
      const geoTags = parseJsonb(market.geo_tags, []);
      const topicTags = parseJsonb(market.topic_tags, []);
      const sourceData = {
        reopenedFromCanceledMarketId: mid,
        reopenedFromSource: market.source || null,
        reopenedFromSourceEventId: market.source_event_id || null,
      };

      const inserted = await client.query(
        `INSERT INTO points_pending_markets
           (source, source_event_id, source_data,
            question, category, icon, outcomes, seed_liquidity, seed_liquidities,
            start_time, end_time, amm_mode, outcome_images,
            resolver_type, resolver_config, sport, league,
            featured, tournament_featured, category_tags, geo_tags, topic_tags,
            status, admin_note, reviewer, reviewed_at, approved_market_id)
         VALUES
           ($1, $2, $3::jsonb,
            $4, $5, $6, $7::jsonb, $8, $9::jsonb,
            $10, $11, $12, $13::jsonb,
            $14, $15::jsonb, $16, $17,
            $18, $19, $20::jsonb, $21::jsonb, $22::jsonb,
            'pending', $23, $24, NOW(), $25)
         RETURNING id`,
        [
          source,
          sourceEventId,
          jsonParam(sourceData, {}),
          market.question,
          market.category,
          market.icon || null,
          jsonParam(outcomes, ['Sí', 'No']),
          Number(market.seed_liquidity || 1000),
          seedLiquidities ? jsonParam(seedLiquidities) : null,
          market.start_time || null,
          market.end_time,
          market.amm_mode === 'parallel' ? 'parallel' : 'unified',
          outcomeImages ? jsonParam(outcomeImages) : null,
          market.resolver_type || null,
          resolverConfig ? jsonParam(resolverConfig) : null,
          market.sport || null,
          market.league || null,
          market.featured === true,
          market.tournament_featured === true,
          jsonParam(categoryTags, []),
          jsonParam(geoTags, []),
          jsonParam(topicTags, []),
          noteText,
          admin.username || 'admin',
          mid,
        ],
      );

      return {
        ok: true,
        action: 'reopen_canceled_market',
        marketId: mid,
        pendingId: Number(inserted.rows[0].id),
        reusedPending: false,
        alreadyPending: false,
      };
    });

    return res.status(200).json(result);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail || null });
    }
    console.error('[admin/reopen-canceled-market] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'reopen_failed',
      detail: e?.message?.slice(0, 240) || null,
      code: e?.code || null,
    });
  }
}
