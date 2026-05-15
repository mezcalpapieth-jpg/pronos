/**
 * GET  /api/protocol/admin/pending-markets?status=pending|approved|rejected
 * POST /api/protocol/admin/pending-markets
 *
 * Protocol-owned generated-market review queue. Shares generator specs
 * with Points, but keeps review state separate and approves directly
 * into on-chain protocol deployments.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { ensureProtocolSchema } from '../../_lib/protocol-schema.js';
import { withTransaction } from '../../_lib/db-tx.js';
import {
  deployMarketOnChain,
  deployParallelBinaryOnChain,
  isOnchainReady,
} from '../../_lib/onchain-trader.js';
import {
  ALLOWED_PROTOCOL_CATEGORIES,
  parallelLegQuestion,
  upsertProtocolMarketMetadata,
} from '../../_lib/protocol-market-admin.js';

const schemaSql = neon(process.env.DATABASE_URL);
const readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

function parseJsonb(v, fb) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
    if (cors) return cors;

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    if (req.method === 'GET') return list(req, res);
    if (req.method === 'POST') return review(req, res, admin);
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[protocol/admin/pending-markets] unhandled', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'server_error', detail: e?.message?.slice(0, 240) || null });
  }
}

async function autoRejectStaleRows() {
  await schemaSql`
    UPDATE protocol_pending_markets
    SET status = 'rejected',
        admin_note = COALESCE(NULLIF(admin_note, ''), 'auto-expired: end_time passed before approval'),
        reviewer = COALESCE(reviewer, 'system'),
        reviewed_at = COALESCE(reviewed_at, NOW())
    WHERE status = 'pending'
      AND end_time IS NOT NULL
      AND end_time < NOW()
  `;
  await schemaSql`
    UPDATE protocol_pending_markets
    SET status = 'rejected',
        admin_note = COALESCE(NULLIF(admin_note, ''), 'auto-rejected: fight outside 14-day import window'),
        reviewer = COALESCE(reviewer, 'system'),
        reviewed_at = COALESCE(reviewed_at, NOW())
    WHERE status = 'pending'
      AND source IN ('odds-api-boxing', 'espn-mma')
      AND start_time IS NOT NULL
      AND (
        start_time > NOW() + INTERVAL '14 days'
        OR (
          EXTRACT(MONTH FROM start_time AT TIME ZONE 'UTC') = 1
          AND EXTRACT(DAY FROM start_time AT TIME ZONE 'UTC') = 1
        )
      )
  `;
  await schemaSql`
    UPDATE protocol_pending_markets
    SET status = 'rejected',
        admin_note = COALESCE(NULLIF(admin_note, ''), 'auto-rejected: NBA tipoff still TBD'),
        reviewer = COALESCE(reviewer, 'system'),
        reviewed_at = COALESCE(reviewed_at, NOW())
    WHERE status = 'pending'
      AND source = 'espn-nba'
      AND start_time IS NOT NULL
      AND resolver_config->'series' IS NOT NULL
      AND EXTRACT(MINUTE FROM start_time AT TIME ZONE 'UTC') = 0
      AND EXTRACT(HOUR FROM start_time AT TIME ZONE 'UTC') IN (4, 5)
  `;
}

async function list(req, res) {
  const status = ['pending', 'approved', 'rejected', 'all'].includes(req.query.status)
    ? req.query.status
    : 'pending';
  await ensureProtocolSchema(schemaSql);

  try {
    await autoRejectStaleRows();
  } catch (e) {
    console.warn('[protocol/admin/pending-markets] auto-reject skipped', {
      code: e?.code,
      message: e?.message?.slice(0, 120),
    });
  }

  const rows = status === 'all'
    ? await readSql`
        SELECT p.*, m.status AS market_status
        FROM protocol_pending_markets p
        LEFT JOIN protocol_markets m ON m.id = p.approved_protocol_market_id
        ORDER BY
          CASE p.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
          CASE WHEN p.status = 'rejected' THEN p.reviewed_at END DESC NULLS LAST,
          CASE WHEN p.status = 'pending' THEN p.end_time END ASC NULLS LAST,
          p.created_at DESC
        LIMIT 2000
      `
    : await readSql`
        SELECT p.*, m.status AS market_status
        FROM protocol_pending_markets p
        LEFT JOIN protocol_markets m ON m.id = p.approved_protocol_market_id
        WHERE p.status = ${status}
        ORDER BY
          CASE WHEN p.status = 'rejected' THEN p.reviewed_at END DESC NULLS LAST,
          CASE WHEN p.status = 'pending' THEN p.end_time END ASC NULLS LAST,
          p.created_at DESC
        LIMIT 2000
      `;

  return res.status(200).json({
    pending: rows.map(r => ({
      id: r.id,
      source: r.source,
      sourceEventId: r.source_event_id,
      sourceData: parseJsonb(r.source_data, {}),
      question: r.question,
      category: r.category,
      icon: r.icon,
      outcomes: parseJsonb(r.outcomes, []),
      seedLiquidity: Number(r.seed_liquidity),
      startTime: r.start_time,
      endTime: r.end_time,
      ammMode: r.amm_mode,
      resolverType: r.resolver_type,
      resolverConfig: parseJsonb(r.resolver_config, null),
      categoryTags: parseJsonb(r.category_tags, []),
      geoTags: parseJsonb(r.geo_tags, []),
      topicTags: parseJsonb(r.topic_tags, []),
      status: r.status,
      adminNote: r.admin_note,
      reviewer: r.reviewer,
      reviewedAt: r.reviewed_at,
      approvedMarketId: r.approved_protocol_market_id,
      createdAt: r.created_at,
      marketStatus: r.market_status || null,
    })),
  });
}

function deployerConfig() {
  if (!isOnchainReady()) {
    const err = new Error('onchain_not_enabled');
    err.status = 503;
    err.detail = 'set TURNKEY_POLICIES_ENABLED + ONCHAIN_RPC_URL + ONCHAIN_COLLATERAL_ADDRESS';
    throw err;
  }
  const deployerSuborgId = process.env.ONCHAIN_DEPLOYER_SUBORG_ID;
  const deployerAddr = process.env.ONCHAIN_DEPLOYER_ADDRESS;
  if (!deployerSuborgId || !deployerAddr) {
    const err = new Error('deployer_not_configured');
    err.status = 503;
    err.detail = 'set ONCHAIN_DEPLOYER_SUBORG_ID + ONCHAIN_DEPLOYER_ADDRESS';
    throw err;
  }
  return { deployerSuborgId, deployerAddr };
}

function validatePendingRow(r) {
  if (!ALLOWED_PROTOCOL_CATEGORIES.has(r.category)) {
    const err = new Error('invalid_category'); err.status = 400; throw err;
  }
  const outcomes = parseJsonb(r.outcomes, []);
  if (!Array.isArray(outcomes) || outcomes.length < 2 || outcomes.length > 8) {
    const err = new Error('invalid_outcomes'); err.status = 400; throw err;
  }
  const seed = Number(r.seed_liquidity);
  if (!Number.isFinite(seed) || seed < 100) {
    const err = new Error('seed_too_small'); err.status = 400; throw err;
  }
  const endDate = r.end_time ? new Date(r.end_time) : null;
  if (!endDate || Number.isNaN(endDate.getTime()) || endDate <= new Date()) {
    const err = new Error('invalid_end_time'); err.status = 400;
    err.detail = 'end_time must be in the future at approval time';
    throw err;
  }
  return { outcomes, seed, endDate };
}

async function readPendingForApproval(pid) {
  return withTransaction(async (client) => {
    const rowRes = await client.query(
      `SELECT * FROM protocol_pending_markets WHERE id = $1 FOR UPDATE`,
      [pid],
    );
    if (rowRes.rows.length === 0) {
      const err = new Error('pending_not_found'); err.status = 404; throw err;
    }
    const r = rowRes.rows[0];
    if (r.status !== 'pending') {
      const err = new Error('already_reviewed'); err.status = 400;
      err.detail = `status=${r.status}`;
      throw err;
    }
    return r;
  });
}

async function markApproved(pid, reviewer, note, marketId) {
  await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE protocol_pending_markets
         SET status = 'approved',
             admin_note = $1,
             reviewer = $2,
             reviewed_at = NOW(),
             approved_protocol_market_id = $3
       WHERE id = $4 AND status = 'pending'
       RETURNING id`,
      [note || null, reviewer, marketId || null, pid],
    );
    if (result.rows.length === 0) {
      const err = new Error('already_reviewed'); err.status = 400; throw err;
    }
  });
}

async function approveOne(pid, reviewer, note) {
  const deployer = deployerConfig();
  const r = await readPendingForApproval(pid);
  const { outcomes, seed, endDate } = validatePendingRow(r);
  const sourceData = parseJsonb(r.source_data, {});
  const resolverConfig = parseJsonb(r.resolver_config, null);
  const outcomeImages = parseJsonb(r.outcome_images, null);
  const startIso = r.start_time ? new Date(r.start_time).toISOString() : null;
  const resolverSrc = 'Pronos auto-resolver';
  const ammMode = r.amm_mode === 'parallel' ? 'parallel' : 'unified';

  if (ammMode === 'parallel') {
    const result = await deployParallelBinaryOnChain({
      deployerSuborgId: deployer.deployerSuborgId,
      deployerAddr: deployer.deployerAddr,
      parentQuestion: String(r.question || '').trim(),
      category: r.category,
      outcomeLabels: outcomes,
      endTime: endDate.toISOString(),
      resolutionSource: resolverSrc,
      seedAmountPerLeg: seed,
    });
    let firstMarketId = null;
    for (let i = 0; i < result.legs.length; i++) {
      const leg = result.legs[i];
      const label = outcomes[i];
      const marketId = await upsertProtocolMarketMetadata(schemaSql, {
        result: { ...leg, chainId: result.chainId, factoryVariant: 'v1-binary' },
        question: parallelLegQuestion(String(r.question || ''), label),
        category: r.category,
        icon: r.icon || null,
        outcomes: ['Sí', 'No'],
        endTime: endDate.toISOString(),
        resolutionSource: resolverSrc,
        seedAmount: seed,
        sport: r.sport || null,
        league: r.league || null,
        outcomeImages: Array.isArray(outcomeImages) && outcomeImages[i] ? [outcomeImages[i], ''] : null,
        factoryVariant: 'v1-binary',
        source: r.source,
        sourceEventId: r.source_event_id,
        startTime: startIso,
        resolverType: r.resolver_type || null,
        resolverConfig,
        sourceData,
      });
      if (!firstMarketId) firstMarketId = marketId;
    }
    await markApproved(pid, reviewer, note, firstMarketId);
    return { id: pid, marketId: firstMarketId, autoDeploy: { chainId: result.chainId, legs: result.legs } };
  }

  const result = await deployMarketOnChain({
    deployerSuborgId: deployer.deployerSuborgId,
    deployerAddr: deployer.deployerAddr,
    question: String(r.question || '').trim(),
    category: r.category,
    outcomeCount: outcomes.length,
    outcomeLabels: outcomes,
    endTime: endDate.toISOString(),
    resolutionSource: resolverSrc,
    seedAmount: seed,
  });
  const marketId = await upsertProtocolMarketMetadata(schemaSql, {
    result,
    question: String(r.question || '').trim(),
    category: r.category,
    icon: r.icon || null,
    outcomes,
    endTime: endDate.toISOString(),
    resolutionSource: resolverSrc,
    seedAmount: seed,
    sport: r.sport || null,
    league: r.league || null,
    outcomeImages: Array.isArray(outcomeImages) && outcomeImages.length === outcomes.length ? outcomeImages : null,
    source: r.source,
    sourceEventId: r.source_event_id,
    startTime: startIso,
    resolverType: r.resolver_type || null,
    resolverConfig,
    sourceData,
  });
  await markApproved(pid, reviewer, note, marketId);
  return {
    id: pid,
    marketId,
    autoDeploy: {
      chainId: result.chainId,
      marketId: result.marketId,
      chainAddress: result.marketAddress,
      txHash: result.txHash,
      factoryVariant: result.factoryVariant,
    },
  };
}

async function review(req, res, admin) {
  const { id, action, note } = req.body || {};
  await ensureProtocolSchema(schemaSql);

  const pid = parseInt(id, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  if (action !== 'approve' && action !== 'reject' && action !== 'readd') {
    return res.status(400).json({ error: 'invalid_action' });
  }

  if (action === 'readd') {
    const result = await withTransaction(async (client) => {
      const rowRes = await client.query(
        `SELECT status FROM protocol_pending_markets WHERE id = $1 FOR UPDATE`,
        [pid],
      );
      if (rowRes.rows.length === 0) {
        const err = new Error('pending_not_found'); err.status = 404; throw err;
      }
      if (rowRes.rows[0].status !== 'rejected') {
        const err = new Error('not_rejected'); err.status = 400;
        err.detail = `status=${rowRes.rows[0].status}`;
        throw err;
      }
      await client.query(
        `UPDATE protocol_pending_markets
           SET status = 'pending',
               admin_note = NULL,
               reviewer = NULL,
               reviewed_at = NULL,
               approved_protocol_market_id = NULL
         WHERE id = $1`,
        [pid],
      );
      return { ok: true, action: 'readd', id: pid };
    });
    return res.status(200).json(result);
  }

  if (action === 'reject') {
    const result = await withTransaction(async (client) => {
      const rowRes = await client.query(
        `SELECT status FROM protocol_pending_markets WHERE id = $1 FOR UPDATE`,
        [pid],
      );
      if (rowRes.rows.length === 0) {
        const err = new Error('pending_not_found'); err.status = 404; throw err;
      }
      if (rowRes.rows[0].status !== 'pending') {
        const err = new Error('already_reviewed'); err.status = 400;
        err.detail = `status=${rowRes.rows[0].status}`;
        throw err;
      }
      await client.query(
        `UPDATE protocol_pending_markets
           SET status = 'rejected', admin_note = $1, reviewer = $2, reviewed_at = NOW()
         WHERE id = $3`,
        [note || null, admin.username, pid],
      );
      return { ok: true, action: 'reject', id: pid };
    });
    return res.status(200).json(result);
  }

  const approved = await approveOne(pid, admin.username, note);
  return res.status(200).json({ ok: true, action: 'approve', ...approved });
}
