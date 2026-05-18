/**
 * POST /api/protocol/cre/resolve-market
 *
 * Chainlink CRE intake boundary for future automated protocol resolution.
 * This endpoint is intentionally secret-gated and validates the CRE report
 * against the protocol market before it touches Turnkey or the factory.
 *
 * Body: {
 *   resolverType: 'chainlink-cre' | 'chainlink-cre-ai',
 *   status: 'ready' | 'dry-run' | 'candidate',
 *   protocolMarketId,
 *   source,
 *   sourceEventId,
 *   outcomeIndex,
 *   outcomeCount,
 *   confidenceBps,
 *   observedAt,
 *   finalScore?,
 *   evidenceUrl?,
 *   evidence?,
 *   rationale?
 * }
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensureProtocolSchema } from '../../_lib/protocol-schema.js';
import {
  assertAuthorizedCreRequest,
  normalizeProtocolResolutionReport,
  validateProtocolResolutionReportForMarket,
} from '../../_lib/protocol-resolution-report.js';
import {
  buildResolutionCandidateInsert,
  formatResolutionCandidate,
} from '../../_lib/protocol-resolution-candidates.js';
import { resolveMarketOnChain, isOnchainReady } from '../../_lib/onchain-trader.js';

const sql = neon(process.env.DATABASE_URL || process.env.DATABASE_READ_URL);

function boolQuery(value) {
  return value === true || value === '1' || value === 'true';
}

function numberEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function errorResponse(res, err, fallbackStatus = 400) {
  return res.status(err?.status || fallbackStatus).json({
    error: err?.message || 'cre_resolution_failed',
    detail: err?.detail || null,
  });
}

function creAuditPatch(report) {
  return {
    chainlinkCre: {
      resolverType: report.resolverType,
      source: report.source,
      sourceEventId: report.sourceEventId,
      outcomeIndex: report.outcomeIndex,
      outcomeCount: report.outcomeCount,
      confidenceBps: report.confidenceBps,
      observedAt: report.observedAt,
      evidenceUrl: report.evidenceUrl,
      submittedAt: new Date().toISOString(),
    },
  };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: false });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    assertAuthorizedCreRequest(req, process.env.CRE_RESOLUTION_WEBHOOK_SECRET);
  } catch (e) {
    return errorResponse(res, e, 401);
  }

  let report;
  try {
    report = normalizeProtocolResolutionReport(req.body?.report || req.body || {}, {
      maxAgeMs: numberEnv('CRE_RESOLUTION_MAX_AGE_MS', 6 * 60 * 60 * 1000),
    });
  } catch (e) {
    return errorResponse(res, e, 400);
  }

  const dryRun = boolQuery(req.query?.dry)
    || req.body?.dryRun === true
    || report.status === 'dry-run';

  try {
    await ensureProtocolSchema(sql);

    const rows = await sql`
      SELECT
        id,
      status,
      market_id,
      factory_address,
      protocol_version,
      outcome_count,
      outcomes,
      source,
      source_event_id,
      resolver_type,
        resolver_config
      FROM protocol_markets
      WHERE id = ${report.protocolMarketId}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'market_not_found' });
    }

    const market = rows[0];
    validateProtocolResolutionReportForMarket(report, market, {
      minConfidenceBps: numberEnv('CRE_RESOLUTION_MIN_CONFIDENCE_BPS', 9000),
    });

    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        report,
        market: {
          id: market.id,
          chainMarketId: market.market_id,
          factoryAddress: market.factory_address,
          protocolVersion: market.protocol_version,
        },
      });
    }

    const queueCandidate = report.status === 'candidate' || report.resolverType === 'chainlink-cre-ai';
    if (queueCandidate) {
      const candidate = buildResolutionCandidateInsert(report);
      const inserted = await sql`
        INSERT INTO protocol_resolution_candidates (
          protocol_market_id,
          resolver_type,
          source,
          source_event_id,
          outcome_index,
          outcome_count,
          confidence_bps,
          observed_at,
          final_score,
          evidence_url,
          evidence,
          rationale,
          raw_report,
          status
        ) VALUES (
          ${candidate.protocol_market_id},
          ${candidate.resolver_type},
          ${candidate.source},
          ${candidate.source_event_id},
          ${candidate.outcome_index},
          ${candidate.outcome_count},
          ${candidate.confidence_bps},
          ${candidate.observed_at},
          ${candidate.final_score},
          ${candidate.evidence_url},
          ${JSON.stringify(candidate.evidence)}::jsonb,
          ${candidate.rationale},
          ${JSON.stringify(report)}::jsonb,
          ${candidate.status}
        )
        RETURNING *
      `;

      return res.status(200).json({
        ok: true,
        dryRun: false,
        candidateQueued: true,
        candidate: formatResolutionCandidate(inserted[0], market.outcomes),
      });
    }

    if (!isOnchainReady()) {
      return res.status(503).json({
        error: 'onchain_not_enabled',
        detail: 'set TURNKEY_POLICIES_ENABLED + ONCHAIN_RPC_URL + ONCHAIN_COLLATERAL_ADDRESS',
      });
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
      factoryAddress: market.factory_address,
      factoryVariant: market.protocol_version === 'v2' ? 'v2' : 'v1',
      marketId: market.market_id,
      outcome: report.outcomeIndex,
    });

    await sql`
      UPDATE protocol_markets
      SET
        final_score = COALESCE(${report.finalScoreText}, final_score),
        resolver_config = COALESCE(resolver_config, '{}'::jsonb) || ${JSON.stringify(creAuditPatch(report))}::jsonb
      WHERE id = ${report.protocolMarketId}
    `;

    return res.status(200).json({
      ok: true,
      dryRun: false,
      report,
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
    console.error('[protocol/cre/resolve-market] failed', {
      message: e?.message,
      code: e?.code,
    });
    return res.status(500).json({
      error: 'cre_resolution_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
