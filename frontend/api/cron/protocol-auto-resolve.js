/**
 * MVP protocol auto-resolver.
 *
 * Computes resolver outcomes with the same source readers as the points
 * resolver, then resolves the deployed market on-chain through the protocol
 * factory. The indexer remains authoritative for flipping DB status after it
 * sees MarketResolved; this cron only writes best-effort final-score metadata.
 */
import { neon } from '@neondatabase/serverless';
import { ensureProtocolSchema } from '../_lib/protocol-schema.js';
import {
  parseAutoResolverJsonb,
  resolveAutoResolverCandidate,
} from '../_lib/auto-resolver-core.js';
import {
  isOnchainReady,
  resolveMarketOnChain,
} from '../_lib/onchain-trader.js';
import { NEXT_OPPONENT_RECHECK_INTERVAL_HOURS } from '../_lib/sports-resolver-policy.js';

const schemaSql = neon(process.env.DATABASE_URL);
const readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const MAX_BINARY_DIRECTION_CATCHUP_PER_RUN = 12;

function isProtocolParallelCandidate(cfg, market) {
  if (!cfg || typeof cfg !== 'object') return false;
  if (cfg.shape === 'parallel') return true;
  if (Array.isArray(cfg.legs)) return true;
  const outcomeCount = Number(market?.outcome_count) || parseAutoResolverJsonb(market?.outcomes, []).length;
  return market?.resolver_type === 'weather_api'
    && Array.isArray(cfg.buckets)
    && outcomeCount === 2
    && cfg.buckets.length > outcomeCount;
}

function resolverConfigPatchForNextOpponent(cfg) {
  if (cfg?.source !== 'next-opponent') return null;
  return { nextOpponentLastCheckedAt: new Date().toISOString() };
}

async function patchResolverConfig(marketId, patch) {
  if (!patch || Object.keys(patch).length === 0) return;
  await schemaSql.query(
    `UPDATE protocol_markets
        SET resolver_config = COALESCE(resolver_config, '{}'::jsonb) || $1::jsonb
      WHERE id = $2
        AND status = 'active'`,
    [JSON.stringify(patch), marketId],
  );
}

async function patchFinalScore(marketId, finalScore) {
  if (finalScore == null || finalScore === '') return;
  await schemaSql.query(
    `UPDATE protocol_markets SET final_score = $1 WHERE id = $2`,
    [finalScore, marketId],
  );
}

function resolverSignerConfig() {
  const resolverSuborgId = process.env.ONCHAIN_RESOLVER_SUBORG_ID
    || process.env.ONCHAIN_DEPLOYER_SUBORG_ID;
  const resolverAddr = process.env.ONCHAIN_RESOLVER_ADDRESS
    || process.env.ONCHAIN_DEPLOYER_ADDRESS;
  if (!resolverSuborgId || !resolverAddr) {
    const err = new Error('resolver_not_configured');
    err.detail = 'set ONCHAIN_RESOLVER_SUBORG_ID + ONCHAIN_RESOLVER_ADDRESS (or ONCHAIN_DEPLOYER_*)';
    throw err;
  }
  return { resolverSuborgId, resolverAddr };
}

export async function runProtocolAutoResolve({ dry = false, limit = 50 } = {}) {
  const started = Date.now();
  await ensureProtocolSchema(schemaSql);
  const cappedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);

  const candidates = await readSql`
    SELECT m.id, m.question, m.start_time, m.end_time, m.resolver_type, m.resolver_config,
           m.outcomes, m.protocol_version, m.outcome_count, m.market_id, m.factory_address,
           m.sport, m.league, pm.source_data AS pending_source_data
      FROM protocol_markets m
      LEFT JOIN LATERAL (
        SELECT source_data
          FROM protocol_pending_markets
         WHERE approved_protocol_market_id = m.id
         ORDER BY id DESC
         LIMIT 1
      ) pm ON true
     WHERE m.status = 'active'
       AND m.resolver_type IN ('chainlink_price', 'api_price', 'weather_api', 'api_chart', 'api_transcript', 'sports_api')
       AND m.end_time IS NOT NULL
       AND (
         m.end_time < NOW()
         OR (
           m.resolver_type = 'sports_api'
           AND m.resolver_config->>'source' IN ('espn', 'football-data')
           AND m.resolver_config->>'shape' IN ('binary', 'draw3')
           AND m.start_time IS NOT NULL
           AND m.start_time < NOW() - INTERVAL '90 minutes'
         )
         OR (
           m.resolver_type = 'sports_api'
           AND m.resolver_config->>'source' = 'next-opponent'
           AND m.end_time > NOW()
           AND (
             m.resolver_config->>'nextOpponentLastCheckedAt' IS NULL
             OR NULLIF(m.resolver_config->>'nextOpponentLastCheckedAt', '')::timestamptz
                  < NOW() - (${NEXT_OPPONENT_RECHECK_INTERVAL_HOURS}::int * INTERVAL '1 hour')
           )
         )
       )
     ORDER BY
       CASE WHEN m.resolver_config->>'shape' = 'binary-direction' THEN 1 ELSE 0 END,
       m.end_time ASC
     LIMIT ${cappedLimit}
  `;

  const report = {
    checked: candidates.length,
    resolved: [],
    errors: [],
    deferred: [],
    dryRun: dry,
  };

  let binaryDirectionCatchups = 0;

  for (const m of candidates) {
    const cfg = parseAutoResolverJsonb(m.resolver_config, null);
    if (!cfg) {
      report.errors.push({ id: m.id, error: 'missing_resolver_config' });
      continue;
    }

    if (isProtocolParallelCandidate(cfg, m)) {
      report.deferred.push({ id: m.id, reason: 'protocol_parallel_not_supported' });
      continue;
    }

    const isBinaryDirectionCatchup = m.resolver_type === 'chainlink_price'
      && cfg.shape === 'binary-direction';
    if (isBinaryDirectionCatchup && binaryDirectionCatchups >= MAX_BINARY_DIRECTION_CATCHUP_PER_RUN) {
      report.deferred.push({ id: m.id, reason: 'binary_direction_catchup_limit' });
      continue;
    }
    if (isBinaryDirectionCatchup) binaryDirectionCatchups += 1;

    let decision;
    try {
      decision = await resolveAutoResolverCandidate(m);
    } catch (e) {
      if (e?.benign) {
        const deferred = {
          id: m.id,
          reason: e.message || 'deferred',
          ...(e.info || {}),
        };
        const patch = resolverConfigPatchForNextOpponent(cfg);
        if (!dry && patch) {
          try {
            await patchResolverConfig(m.id, patch);
            deferred.nextOpponentLastCheckedAt = patch.nextOpponentLastCheckedAt;
          } catch (patchErr) {
            deferred.checkPatchError = patchErr?.message?.slice(0, 160) || 'patch_failed';
          }
        }
        report.deferred.push(deferred);
        continue;
      }
      report.errors.push({ id: m.id, error: `resolve_failed: ${e.message}` });
      continue;
    }

    const { winningIdx, finalScore, resolverInfo, resolverConfigPatch } = decision;
    const outcomeCount = Number(m.outcome_count) || parseAutoResolverJsonb(m.outcomes, []).length || 2;
    if (!Number.isInteger(winningIdx) || winningIdx < 0 || winningIdx >= outcomeCount) {
      report.errors.push({ id: m.id, error: `invalid winningIdx ${winningIdx}` });
      continue;
    }

    if (dry) {
      report.resolved.push({ id: m.id, winningIdx, finalScore, ...resolverInfo, dry: true });
      continue;
    }

    try {
      if (!isOnchainReady()) throw new Error('onchain_not_enabled');
      const { resolverSuborgId, resolverAddr } = resolverSignerConfig();
      const tx = await resolveMarketOnChain({
        resolverSuborgId,
        resolverAddr,
        factoryAddress: m.factory_address,
        factoryVariant: m.protocol_version === 'v2' ? 'v2' : 'v1',
        marketId: m.market_id,
        outcome: winningIdx,
      });

      let metadataWarning = null;
      try {
        await patchFinalScore(m.id, finalScore);
        await patchResolverConfig(m.id, resolverConfigPatch);
      } catch (metadataErr) {
        metadataWarning = metadataErr?.message?.slice(0, 160) || 'metadata_patch_failed';
      }

      report.resolved.push({
        id: m.id,
        winningIdx,
        finalScore,
        txHash: tx.txHash,
        blockNumber: tx.blockNumber,
        ...resolverInfo,
        metadataWarning,
      });
    } catch (e) {
      report.errors.push({ id: m.id, error: `onchain_resolve_failed: ${e.message}` });
    }
  }

  return {
    ok: true,
    tookMs: Date.now() - started,
    ...report,
  };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);
  if (!secret) {
    if (isVercelDeploy) {
      return res.status(503).json({ error: 'CRON_SECRET not configured' });
    }
  } else {
    const provided = req.query.key || (req.headers.authorization || '').replace('Bearer ', '');
    if (provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  }

  const dry = req.query.dry === '1' || req.query.dry === 'true';
  const limit = Number.parseInt(req.query.limit, 10);
  try {
    const result = await runProtocolAutoResolve({ dry, limit });
    return res.status(200).json(result);
  } catch (e) {
    console.error('[cron/protocol-auto-resolve] fatal', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'resolve_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
