/**
 * POST /api/points/admin/progress-world-cup          — apply
 * POST /api/points/admin/progress-world-cup?dry=1    — preview
 *
 * Runs the World Cup knockout-stage progression. Reads resolved WC
 * group markets, computes standings, and — if all 12 groups are
 * complete — builds R32 match specs and upserts them into the
 * pending-markets queue. Admin still approves each R32 row
 * individually (or uses "Aprobar todos") before they go live.
 *
 * Later rounds (R16 / QF / SF / Final) are out of scope here; same
 * pattern can spawn them once each previous round resolves. For now
 * this endpoint unblocks the first knockout spawn, which is the
 * high-friction step.
 *
 * Admin-only.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { computeStandings, bestThirds, buildR32Specs } from '../../_lib/wc-progression.js';
import { upsertPending } from '../../_lib/run-generators.js';

const sql = neon(process.env.DATABASE_URL);
const readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

function parseJsonb(v, fb) {
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const dry = req.query.dry === '1' || req.query.dry === 'true';
    await ensurePointsSchema(sql);

    // Pull every resolved WC market. We only need the rows where
    // source_data encodes the group + home/away, so filter by
    // category + status at the SQL level and decode JSON client-side.
    const rows = await readSql`
      SELECT id, question, status, outcome, reserves, outcomes,
             category, icon, end_time, resolved_at, amm_mode
      FROM points_markets
      WHERE category = 'world-cup'
        AND status = 'resolved'
        AND parent_id IS NULL
      LIMIT 500
    `;

    // The /admin/markets payload doesn't ship source_data; query it
    // directly here so standings can index by group + team codes.
    const dataRows = await readSql`
      SELECT m.id,
             pm.source_data,
             pm.question AS pending_question
      FROM points_markets m
      JOIN points_pending_markets pm ON pm.approved_market_id = m.id
      WHERE m.category = 'world-cup' AND m.parent_id IS NULL
    `;
    const sourceDataById = new Map();
    for (const r of dataRows) {
      sourceDataById.set(r.id, parseJsonb(r.source_data, null));
    }

    const decorated = rows.map(r => ({
      id: r.id,
      question: r.question,
      status: r.status,
      outcome: r.outcome,
      sourceData: sourceDataById.get(r.id) || null,
    }));

    const { standings, matchesResolved, matchesExpected, allGroupsComplete } =
      computeStandings(decorated);
    const thirds = bestThirds(standings);

    if (!allGroupsComplete) {
      return res.status(200).json({
        ok: true,
        dryRun: dry,
        phase: 'group-stage',
        complete: false,
        matchesResolved,
        matchesExpected,
        standings,
        note: 'Grupos incompletos — R32 aún no generable. Resolvé los partidos de fase de grupos y vuelve a correr.',
      });
    }

    // All groups resolved → build R32 specs.
    const specs = buildR32Specs(standings);
    if (dry) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        phase: 'r32',
        complete: true,
        specsToInsert: specs.length,
        thirds,
        standings,
        sample: specs.slice(0, 3),
      });
    }
    const report = await upsertPending(sql, specs);
    return res.status(200).json({
      ok: true,
      dryRun: false,
      phase: 'r32',
      specsToInsert: specs.length,
      ...report,
      thirds,
      reviewer: admin.username,
    });
  } catch (e) {
    console.error('[admin/progress-world-cup] error', {
      message: e?.message, code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'progress_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
