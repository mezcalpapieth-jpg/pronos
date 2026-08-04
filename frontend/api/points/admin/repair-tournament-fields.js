/**
 * POST /api/points/admin/repair-tournament-fields
 * Body: { dryRun?: boolean, marketIds?: number[] }
 *
 * Repairs previously-approved tournament winner markets whose entrants
 * came from ranking fallbacks instead of a confirmed ESPN draw/field.
 * Invalid player legs are canceled and current holders receive their
 * remaining cost basis back via points_distributions.kind =
 * 'invalid_field_refund'. Missing confirmed entrants are added as new
 * parallel legs.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import {
  buildConfirmedTournamentField,
  listTournamentFieldRepairCandidates,
  repairTournamentFieldMarket,
} from '../../_lib/points-field-repair.js';

const schemaSql = neon(process.env.DATABASE_URL);

function normalizeMarketIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => Number.parseInt(v, 10))
    .filter(v => Number.isInteger(v) && v > 0);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const dryRun = req.body?.dryRun !== false;
  const marketIds = normalizeMarketIds(req.body?.marketIds);

  try {
    await ensurePointsSchema(schemaSql);

    const candidates = await withTransaction(async (client) => (
      listTournamentFieldRepairCandidates(client, { marketIds })
    ));

    const results = [];
    for (const market of candidates) {
      const confirmed = await buildConfirmedTournamentField(market);
      const result = await withTransaction(async (client) => (
        repairTournamentFieldMarket(client, market, confirmed, {
          dryRun,
          adminUsername: admin.username,
        })
      ));
      results.push(result);
    }

    const totalRefunded = results.reduce((sum, row) => sum + Number(row.totalRefunded || 0), 0);
    const refundCount = results.reduce((sum, row) => sum + Number(row.refundCount || 0), 0);

    return res.status(200).json({
      ok: true,
      dryRun,
      candidates: candidates.length,
      repaired: results.filter(r => r.ok && !r.skipped).length,
      skipped: results.filter(r => r.skipped).length,
      refundCount,
      totalRefunded,
      results,
    });
  } catch (e) {
    console.error('[admin/repair-tournament-fields] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'repair_tournament_fields_failed',
      detail: e?.message?.slice(0, 240) || null,
      code: e?.code || null,
    });
  }
}
