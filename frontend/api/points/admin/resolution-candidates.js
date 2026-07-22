/**
 * GET /api/points/admin/resolution-candidates?status=pending
 * POST /api/points/admin/resolution-candidates
 *   Body: { candidateId, action: 'confirm' | 'deny', outcomeIndex?, note? }
 *
 * Human review boundary for points markets that wake up via scheduler
 * but should not auto-settle without admin confirmation.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { bestEffortPersistResolvedCryptoMarketSnapshot } from '../../_lib/crypto-chart-snapshot.js';
import { formatPointsResolutionCandidate } from '../../_lib/points-resolution-candidates.js';

const sql = neon(process.env.DATABASE_URL || process.env.DATABASE_READ_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback = null) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function parsePositiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseOutcomeIndex(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function cleanNote(value) {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, 500) : null;
}

function candidateAuditPatch(candidate, admin, action, outcomeIndex = null) {
  return {
    resolutionCandidate: {
      id: Number(candidate.id),
      resolverType: candidate.resolver_type,
      source: candidate.source,
      sourceEventId: candidate.source_event_id,
      outcomeIndex,
      confidenceBps: Number(candidate.confidence_bps) || 0,
      observedAt: candidate.observed_at,
      evidenceUrl: candidate.evidence_url,
      action,
      reviewer: admin?.username || null,
      reviewedAt: new Date().toISOString(),
    },
  };
}

async function loadCandidate(candidateId) {
  const rows = await sql`
    SELECT
      c.*,
      m.id AS market_id,
      m.status AS market_status,
      m.amm_mode AS market_amm_mode,
      m.parent_id AS market_parent_id,
      m.outcomes
    FROM points_resolution_candidates c
    JOIN points_markets m ON m.id = c.points_market_id
    WHERE c.id = ${candidateId}
    LIMIT 1
  `;
  return rows[0] || null;
}

function errorResponse(res, err, fallbackStatus = 400) {
  return res.status(err?.status || fallbackStatus).json({
    error: err?.message || 'resolution_candidate_failed',
    detail: err?.detail || null,
  });
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  try {
    await ensurePointsSchema(schemaSql);

    if (req.method === 'GET') {
      const status = String(req.query?.status || 'pending').trim().toLowerCase();
      if (status !== 'pending') return res.status(400).json({ error: 'invalid_status' });

      const rows = await sql`
        SELECT COUNT(DISTINCT market_id)::int AS count
        FROM (
          SELECT c.points_market_id AS market_id
          FROM points_resolution_candidates c
          JOIN points_markets m ON m.id = c.points_market_id
          WHERE c.status = 'pending'
            AND m.status = 'active'
            AND m.parent_id IS NULL
            AND COALESCE(m.mode, 'points') = 'points'
            AND m.archived_at IS NULL
          UNION
          SELECT m.id AS market_id
          FROM points_markets m
          WHERE m.status = 'active'
            AND m.parent_id IS NULL
            AND COALESCE(m.mode, 'points') = 'points'
            AND m.archived_at IS NULL
            AND m.end_time IS NOT NULL
            AND m.end_time < NOW()
        ) actionable
      `;
      const pendingRows = await sql`
        SELECT COUNT(DISTINCT c.points_market_id)::int AS count
        FROM points_resolution_candidates c
        JOIN points_markets m ON m.id = c.points_market_id
        WHERE c.status = 'pending'
          AND m.status = 'active'
          AND m.parent_id IS NULL
          AND COALESCE(m.mode, 'points') = 'points'
          AND m.archived_at IS NULL
      `;
      const overdueRows = await sql`
        SELECT COUNT(*)::int AS count
        FROM points_markets m
        WHERE m.status = 'active'
          AND m.parent_id IS NULL
          AND COALESCE(m.mode, 'points') = 'points'
          AND m.archived_at IS NULL
          AND m.end_time IS NOT NULL
          AND m.end_time < NOW()
      `;

      return res.status(200).json({
        ok: true,
        status,
        pendingCount: Number(pendingRows[0]?.count || 0),
        overdueCount: Number(overdueRows[0]?.count || 0),
        count: Number(rows[0]?.count || 0),
      });
    }

    const candidateId = parsePositiveInt(req.body?.candidateId ?? req.body?.id);
    const action = String(req.body?.action || '').trim().toLowerCase();
    const note = cleanNote(req.body?.note);
    if (!candidateId) return res.status(400).json({ error: 'invalid_candidate_id' });
    if (!(action === 'confirm' || action === 'deny')) {
      return res.status(400).json({ error: 'invalid_action' });
    }

    const candidate = await loadCandidate(candidateId);
    if (!candidate) return res.status(404).json({ error: 'candidate_not_found' });
    if (candidate.status !== 'pending') {
      return res.status(409).json({ error: 'candidate_already_reviewed' });
    }

    const outcomes = parseJsonb(candidate.outcomes, []);

    if (action === 'deny') {
      const denied = await withTransaction(async (client) => {
        const r = await client.query(
          `UPDATE points_resolution_candidates
             SET status = 'denied',
                 reviewer = $1,
                 admin_note = $2,
                 reviewed_at = NOW()
           WHERE id = $3
             AND status = 'pending'
           RETURNING *`,
          [admin.username, note, candidateId],
        );
        if (r.rows.length === 0) {
          const err = new Error('candidate_already_reviewed'); err.status = 409; throw err;
        }

        await client.query(
          `UPDATE points_markets
              SET resolver_config = COALESCE(resolver_config, '{}'::jsonb) || $1::jsonb
            WHERE id = $2`,
          [JSON.stringify(candidateAuditPatch(candidate, admin, 'deny')), candidate.points_market_id],
        );

        return r.rows[0];
      });

      return res.status(200).json({
        ok: true,
        action,
        candidate: formatPointsResolutionCandidate(denied, outcomes),
      });
    }

    const bodyOutcome = parseOutcomeIndex(req.body?.outcomeIndex);
    const storedOutcome = parseOutcomeIndex(candidate.outcome_index);
    const outcome = bodyOutcome ?? storedOutcome;
    const outcomeCount = Array.isArray(outcomes) && outcomes.length > 0
      ? outcomes.length
      : Number(candidate.outcome_count || 2);
    if (!Number.isInteger(outcome) || outcome < 0 || outcome >= outcomeCount) {
      return res.status(400).json({ error: 'invalid_outcome' });
    }
    if (candidate.market_status !== 'active' || candidate.market_parent_id) {
      return res.status(400).json({ error: 'market_not_active' });
    }

    const result = await withTransaction(async (client) => {
      const mr = await client.query(
        `SELECT id, status, amm_mode, parent_id
           FROM points_markets
          WHERE id = $1
          FOR UPDATE`,
        [candidate.points_market_id],
      );
      if (mr.rows.length === 0) {
        const err = new Error('market_not_found'); err.status = 404; throw err;
      }
      const market = mr.rows[0];
      if (market.parent_id || market.status !== 'active') {
        const err = new Error('market_not_active'); err.status = 400; throw err;
      }

      const confirmed = await client.query(
        `UPDATE points_resolution_candidates
           SET status = 'confirmed',
               outcome_index = $1,
               reviewer = $2,
               admin_note = $3,
               reviewed_at = NOW()
         WHERE id = $4
           AND status = 'pending'
         RETURNING *`,
        [outcome, admin.username, note, candidateId],
      );
      if (confirmed.rows.length === 0) {
        const err = new Error('candidate_already_reviewed'); err.status = 409; throw err;
      }

      await client.query(
        `UPDATE points_markets
           SET status = 'resolved',
               outcome = $1,
               resolved_at = NOW(),
               resolved_by = $2,
               final_score = COALESCE($3, final_score),
               resolver_config = COALESCE(resolver_config, '{}'::jsonb) || $4::jsonb
         WHERE id = $5
           AND status = 'active'`,
        [
          outcome,
          admin.username,
          candidate.final_score || null,
          JSON.stringify(candidateAuditPatch(candidate, admin, 'confirm', outcome)),
          candidate.points_market_id,
        ],
      );

      if (market.amm_mode === 'parallel') {
        const legs = await client.query(
          `SELECT id FROM points_markets
            WHERE parent_id = $1
            ORDER BY id ASC
            FOR UPDATE`,
          [candidate.points_market_id],
        );
        if (outcome >= legs.rows.length) {
          const err = new Error('invalid_outcome');
          err.status = 400;
          err.detail = `parent has ${legs.rows.length} legs, winning index ${outcome} out of range`;
          throw err;
        }
        for (let i = 0; i < legs.rows.length; i++) {
          const legWinningOutcome = i === outcome ? 0 : 1;
          await client.query(
            `UPDATE points_markets
               SET status = 'resolved',
                   outcome = $1,
                   resolved_at = NOW(),
                   resolved_by = $2
             WHERE id = $3
               AND status = 'active'`,
            [legWinningOutcome, admin.username, legs.rows[i].id],
          );
        }
      }

      await bestEffortPersistResolvedCryptoMarketSnapshot(
        client,
        candidate.points_market_id,
        'admin/resolution-candidates',
      );

      return {
        candidate: confirmed.rows[0],
        ammMode: market.amm_mode || 'unified',
      };
    });

    return res.status(200).json({
      ok: true,
      action,
      outcome,
      candidate: formatPointsResolutionCandidate(result.candidate, outcomes),
      ammMode: result.ammMode,
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return errorResponse(res, e, e.status);
    }
    console.error('[points/admin/resolution-candidates] failed', {
      message: e?.message,
      code: e?.code,
    });
    return res.status(500).json({
      error: 'resolution_candidate_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
