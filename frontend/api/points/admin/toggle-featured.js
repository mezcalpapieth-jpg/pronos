/**
 * POST /api/points/admin/toggle-featured
 *   body: { marketId?, pendingId?, featured?: boolean, tournamentFeatured?: boolean }
 *
 * Flip the `featured` or `tournament_featured` flag on either an already-created market
 * (`marketId` → points_markets) or a pending row in the admin queue
 * (`pendingId` → points_pending_markets). Exactly one id must be
 * provided, and exactly one flag must be provided. Pending flags carry
 * over into points_markets at approval time.
 *
 * Idempotent — a second call with the same value is a no-op.
 * Admin-only.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { attachPointsOpeningLiquidity } from '../../_lib/market-pricing.js';

const sql = neon(process.env.DATABASE_URL);

export async function updatePendingTournamentFeature(client, pendingId, tournamentFeatured) {
  const selected = await client.query('SELECT * FROM points_pending_markets WHERE id = $1 FOR UPDATE', [pendingId]);
  const row = selected.rows[0];
  if (!row) return [];
  const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
  const outcomes = parse(row.outcomes);
  const priced = attachPointsOpeningLiquidity({ ...row, outcomes,
    seed_liquidities: parse(row.seed_liquidities), source_data: parse(row.source_data) });
  const updated = await client.query(`UPDATE points_pending_markets
    SET tournament_featured = $2, seed_liquidity = $3, seed_liquidities = $4::jsonb, source_data = $5::jsonb
    WHERE id = $1 RETURNING id, featured, tournament_featured, seed_liquidity, seed_liquidities, source_data`,
  [pendingId, tournamentFeatured, priced.seed_liquidity, JSON.stringify(priced.seed_liquidities), JSON.stringify(priced.source_data)]);
  return updated.rows;
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const { marketId, pendingId, featured, tournamentFeatured } = req.body || {};
    const hasFeatured = typeof featured === 'boolean';
    const hasTournamentFeatured = typeof tournamentFeatured === 'boolean';
    if (hasFeatured === hasTournamentFeatured) {
      return res.status(400).json({ error: 'supply_exactly_one_feature_flag' });
    }
    const mid = Number.parseInt(marketId, 10);
    const pid = Number.parseInt(pendingId, 10);
    const hasMarket  = Number.isInteger(mid) && mid > 0;
    const hasPending = Number.isInteger(pid) && pid > 0;
    if (hasMarket === hasPending) {
      return res.status(400).json({ error: 'supply_exactly_one_of_marketId_pendingId' });
    }

    await ensurePointsSchema(sql);

    if (hasMarket) {
      if (hasTournamentFeatured) {
        const rows = await sql`
          UPDATE points_markets
          SET tournament_featured = ${tournamentFeatured}
          WHERE id = ${mid}
          RETURNING id, featured, tournament_featured, hidden_from_home
        `;
        if (rows.length === 0) {
          return res.status(404).json({ error: 'market_not_found' });
        }
        return res.status(200).json({
          ok: true,
          marketId: rows[0].id,
          featured: rows[0].featured,
          tournamentFeatured: rows[0].tournament_featured,
          hiddenFromHome: rows[0].hidden_from_home,
          reviewer: admin.username,
        });
      }

      // Clear auto_featured so the points-auto-feature cron leaves
      // this row alone going forward — a manual toggle wins until
      // someone toggles it again. Without this, an admin un-flame
      // would get re-flamed on the next cron tick if the game was
      // still live.
      const rows = await sql`
        UPDATE points_markets
        SET featured = ${featured},
            auto_featured = false,
            hidden_from_home = CASE WHEN ${featured} THEN false ELSE hidden_from_home END
        WHERE id = ${mid}
        RETURNING id, featured, tournament_featured, hidden_from_home
      `;
      if (rows.length === 0) {
        return res.status(404).json({ error: 'market_not_found' });
      }
      return res.status(200).json({
        ok: true,
        marketId: rows[0].id,
        featured: rows[0].featured,
        tournamentFeatured: rows[0].tournament_featured,
        hiddenFromHome: rows[0].hidden_from_home,
        reviewer: admin.username,
      });
    }

    const rows = hasTournamentFeatured
      ? await withTransaction(client => updatePendingTournamentFeature(client, pid, tournamentFeatured))
      : await sql`
          UPDATE points_pending_markets
          SET featured = ${featured}
          WHERE id = ${pid}
          RETURNING id, featured, tournament_featured
        `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'pending_not_found' });
    }
    return res.status(200).json({
      ok: true,
      pendingId: rows[0].id,
      featured: rows[0].featured,
      tournamentFeatured: rows[0].tournament_featured,
      seedLiquidity: rows[0].seed_liquidity == null ? null : Number(rows[0].seed_liquidity),
      seedLiquidities: rows[0].seed_liquidities,
      suggestedPricing: rows[0].source_data?.suggestedPricing || null,
      reviewer: admin.username,
    });
  } catch (e) {
    console.error('[admin/toggle-featured] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'toggle_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
