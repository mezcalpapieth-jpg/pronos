/**
 * GET /api/protocol/admin/resolution-candidates?status=pending
 * POST /api/protocol/admin/resolution-candidates
 *   Body: { candidateId, action: 'confirm' | 'deny', note? }
 *
 * Human review boundary for AI-monitored resolution candidates. AI can
 * propose an outcome with evidence, but only an admin confirmation
 * calls resolveMarket on-chain.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { ensureProtocolSchema } from '../../_lib/protocol-schema.js';
import { formatResolutionCandidate } from '../../_lib/protocol-resolution-candidates.js';
import { resolveMarketOnChain, isOnchainReady } from '../../_lib/onchain-trader.js';

const sql = neon(process.env.DATABASE_URL || process.env.DATABASE_READ_URL);

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

function errorResponse(res, err, fallbackStatus = 400) {
  return res.status(err?.status || fallbackStatus).json({
    error: err?.message || 'resolution_candidate_failed',
    detail: err?.detail || null,
  });
}

async function loadCandidate(candidateId) {
  const rows = await sql`
    SELECT
      c.*,
      m.id AS market_db_id,
      m.status AS market_status,
      m.market_id AS chain_market_id,
      m.factory_address,
      m.protocol_version,
      m.outcome_count AS market_outcome_count,
      m.outcomes
    FROM protocol_resolution_candidates c
    JOIN protocol_markets m ON m.id = c.protocol_market_id
    WHERE c.id = ${candidateId}
    LIMIT 1
  `;
  return rows[0] || null;
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
    await ensureProtocolSchema(sql);

    if (req.method === 'GET') {
      const status = String(req.query?.status || 'pending').trim().toLowerCase();
      if (status !== 'pending') {
        return res.status(400).json({ error: 'invalid_status' });
      }
      const rows = await sql`
        SELECT COUNT(DISTINCT market_id)::int AS count
        FROM (
          SELECT c.protocol_market_id AS market_id
          FROM protocol_resolution_candidates c
          JOIN protocol_markets m ON m.id = c.protocol_market_id
          WHERE c.status = 'pending'
            AND m.status = 'active'
          UNION
          SELECT m.id AS market_id
          FROM protocol_markets m
          WHERE m.status = 'active'
            AND m.end_time IS NOT NULL
            AND m.end_time < NOW()
        ) actionable
      `;
      const pendingRows = await sql`
        SELECT COUNT(DISTINCT c.protocol_market_id)::int AS count
        FROM protocol_resolution_candidates c
        JOIN protocol_markets m ON m.id = c.protocol_market_id
        WHERE c.status = 'pending'
          AND m.status = 'active'
      `;
      const overdueRows = await sql`
        SELECT COUNT(*)::int AS count
        FROM protocol_markets
        WHERE status = 'active'
          AND end_time IS NOT NULL
          AND end_time < NOW()
      `;
      const pendingCount = Number(pendingRows[0]?.count || 0);
      const overdueCount = Number(overdueRows[0]?.count || 0);
      const count = Number(rows[0]?.count || 0);
      return res.status(200).json({
        ok: true,
        status,
        pendingCount,
        overdueCount,
        count,
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

    if (action === 'deny') {
      const denied = await sql`
        UPDATE protocol_resolution_candidates
        SET
          status = 'denied',
          reviewer = ${admin.username},
          admin_note = ${note},
          reviewed_at = NOW()
        WHERE id = ${candidateId}
          AND status = 'pending'
        RETURNING *
      `;

      await sql`
        UPDATE protocol_markets
        SET resolver_config = COALESCE(resolver_config, '{}'::jsonb)
          || ${JSON.stringify(candidateAuditPatch(candidate, admin, 'deny', parseOutcomeIndex(candidate.outcome_index)))}::jsonb
        WHERE id = ${candidate.protocol_market_id}
      `;

      return res.status(200).json({
        ok: true,
        action,
        candidate: formatResolutionCandidate(denied[0], candidate.outcomes),
      });
    }

    if (!isOnchainReady()) {
      return res.status(503).json({
        error: 'onchain_not_enabled',
        detail: 'set TURNKEY_POLICIES_ENABLED + ONCHAIN_RPC_URL + ONCHAIN_COLLATERAL_ADDRESS',
      });
    }
    if (candidate.market_status !== 'active') {
      return res.status(400).json({ error: 'market_not_active' });
    }

    const outcomeCount = Number(candidate.market_outcome_count) || 2;
    const bodyOutcome = parseOutcomeIndex(req.body?.outcomeIndex);
    const storedOutcome = parseOutcomeIndex(candidate.outcome_index);
    const outcome = bodyOutcome ?? storedOutcome;
    if (!Number.isInteger(outcome) || outcome < 0 || outcome >= outcomeCount) {
      return res.status(400).json({ error: 'invalid_outcome' });
    }
    if (!candidate.factory_address || !candidate.chain_market_id) {
      return res.status(500).json({ error: 'market_missing_chain_metadata' });
    }

    const resolverSuborgId = process.env.ONCHAIN_RESOLVER_SUBORG_ID
      || process.env.ONCHAIN_DEPLOYER_SUBORG_ID;
    const resolverAddr = process.env.ONCHAIN_RESOLVER_ADDRESS
      || process.env.ONCHAIN_DEPLOYER_ADDRESS;
    if (!resolverSuborgId || !resolverAddr) {
      return res.status(503).json({
        error: 'resolver_not_configured',
        detail: 'set ONCHAIN_RESOLVER_SUBORG_ID + ONCHAIN_RESOLVER_ADDRESS (or fall back to ONCHAIN_DEPLOYER_*)',
      });
    }

    const result = await resolveMarketOnChain({
      resolverSuborgId,
      resolverAddr,
      factoryAddress: candidate.factory_address,
      factoryVariant: candidate.protocol_version === 'v2' ? 'v2' : 'v1',
      marketId: candidate.chain_market_id,
      outcome,
    });

    const confirmed = await sql`
      UPDATE protocol_resolution_candidates
      SET
        status = 'confirmed',
        outcome_index = ${outcome},
        reviewer = ${admin.username},
        admin_note = ${note},
        reviewed_at = NOW()
      WHERE id = ${candidateId}
        AND status = 'pending'
      RETURNING *
    `;

    await sql`
      UPDATE protocol_markets
      SET
        status = 'resolved',
        outcome = ${outcome},
        resolved_at = NOW(),
        final_score = COALESCE(${candidate.final_score}, final_score),
        resolver_config = COALESCE(resolver_config, '{}'::jsonb)
          || ${JSON.stringify(candidateAuditPatch(candidate, admin, 'confirm', outcome))}::jsonb
      WHERE id = ${candidate.protocol_market_id}
    `;

    return res.status(200).json({
      ok: true,
      action,
      candidate: formatResolutionCandidate(confirmed[0], candidate.outcomes),
      marketId: result.marketId,
      outcome: result.outcome,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      chainId: result.chainId,
      factoryVariant: result.factoryVariant,
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return errorResponse(res, e, e.status);
    }
    console.error('[protocol/admin/resolution-candidates] failed', {
      message: e?.message,
      code: e?.code,
    });
    return res.status(500).json({
      error: 'resolution_candidate_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
