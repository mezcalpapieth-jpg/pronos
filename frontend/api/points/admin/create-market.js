/**
 * POST /api/points/admin/create-market
 * Body: {
 *   question, category, icon?, endTime,
 *   outcomes: string[],   // 2 to 10 outcomes — 2 = binary Sí/No,
 *                          // more = multi-outcome (Liga MX winner etc.)
 *   seedLiquidity
 * }
 *
 * Creates a new market with N equal reserves of seedLiquidity each.
 * Binary (N=2) is fully tradeable. Multi-outcome (N>2) is created with
 * the right reserves shape but trading stays binary-only in this release
 * — the UI disables the buy panel for multi markets until the AMM math
 * for N>2 is shipped. Admin-only endpoint.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { initialReserves } from '../../_lib/amm-math.js';

const sql = neon(process.env.DATABASE_URL);

const ALLOWED_CATEGORIES = new Set([
  'general', 'mexico', 'politica', 'deportes', 'finanzas', 'crypto', 'musica',
]);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const { question, category, icon, endTime, outcomes, seedLiquidity } = req.body || {};
  const seed = Number(seedLiquidity);
  if (typeof question !== 'string' || question.trim().length < 8) {
    return res.status(400).json({ error: 'invalid_question' });
  }
  if (!ALLOWED_CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'invalid_category' });
  }
  if (!Array.isArray(outcomes) || outcomes.length < 2 || outcomes.length > 10) {
    return res.status(400).json({ error: 'outcome_count_out_of_range' });
  }
  if (!outcomes.every(o => typeof o === 'string' && o.trim().length > 0)) {
    return res.status(400).json({ error: 'invalid_outcomes' });
  }
  // Reject duplicate outcome labels (case-insensitive) — they'd make the
  // buy UI confusing and break option-index lookups.
  const normalizedOutcomes = outcomes.map(o => o.trim());
  const lowerSet = new Set(normalizedOutcomes.map(o => o.toLowerCase()));
  if (lowerSet.size !== normalizedOutcomes.length) {
    return res.status(400).json({ error: 'duplicate_outcomes' });
  }
  if (!Number.isFinite(seed) || seed < 100) {
    return res.status(400).json({ error: 'seed_too_small' });
  }
  const endDate = endTime ? new Date(endTime) : null;
  if (!endDate || isNaN(endDate.getTime()) || endDate <= new Date()) {
    return res.status(400).json({ error: 'invalid_end_time' });
  }

  try {
    await ensurePointsSchema(sql);
    const reserves = initialReserves(seed, normalizedOutcomes.length);
    const rows = await sql`
      INSERT INTO points_markets
        (question, category, icon, outcomes, reserves, seed_liquidity, end_time, status, created_by)
      VALUES (
        ${question.trim()},
        ${category},
        ${icon || null},
        ${JSON.stringify(normalizedOutcomes)}::jsonb,
        ${JSON.stringify(reserves)}::jsonb,
        ${seed},
        ${endDate.toISOString()},
        'active',
        ${admin.username}
      )
      RETURNING id
    `;
    return res.status(200).json({ ok: true, marketId: rows[0].id });
  } catch (e) {
    console.error('[admin/create-market] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'create_failed' });
  }
}
