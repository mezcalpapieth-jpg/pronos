/**
 * Admin queue for agent-generated markets awaiting approval.
 *
 * GET  /api/points/admin/pending-markets?status=pending|approved|rejected
 *   → list rows (most-recent first)
 * POST /api/points/admin/pending-markets
 *   body: { id, action: 'approve' | 'reject', note? }
 *   approve → copy spec into points_markets + mark approved
 *   reject  → mark rejected (row stays so re-runs stay idempotent)
 *
 * Both operations run inside one transaction so we never half-create a
 * market and forget to mark the queue row.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { initialReserves } from '../../_lib/amm-math.js';

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

    if (req.method === 'GET')  return list(req, res);
    if (req.method === 'POST') return review(req, res, admin);
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[admin/pending-markets] unhandled', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'server_error', detail: e?.message?.slice(0, 240) || null });
  }
}

async function list(req, res) {
  const status = ['pending', 'approved', 'rejected', 'all'].includes(req.query.status)
    ? req.query.status
    : 'pending';
  await ensurePointsSchema(schemaSql);

  // Auto-expire stale pendings BEFORE the list query runs. Any row
  // whose end_time has already passed is no longer approvable — the
  // event it was generated for already started/ended — so we flip
  // it to 'rejected' with a marker note. This keeps the pending
  // queue trimmed to actionable candidates and prevents the same
  // dead rows from cluttering the admin UI on every load.
  //
  // The COALESCE on admin_note preserves any human note that was
  // already there, only filling in the auto-expire reason when the
  // slot is empty. `reviewer = 'system'` distinguishes it from a
  // manual rejection. Idempotent — already-rejected rows are skipped
  // by the WHERE.
  try {
    await schemaSql`
      UPDATE points_pending_markets
      SET status = 'rejected',
          admin_note = COALESCE(NULLIF(admin_note, ''), 'auto-expired: end_time passed before approval'),
          reviewer = COALESCE(reviewer, 'system'),
          reviewed_at = COALESCE(reviewed_at, NOW())
      WHERE status = 'pending'
        AND end_time IS NOT NULL
        AND end_time < NOW()
    `;
  } catch (e) {
    // Don't block the list on the cleanup query — log and continue.
    // The list itself still returns even if cleanup fails.
    console.warn('[admin/pending-markets] auto-expire skipped', { code: e?.code, message: e?.message?.slice(0, 120) });
  }

  // LEFT JOIN points_markets so approved rows carry the current
  // `featured` flag (and market status) back to the admin UI. Pending
  // / rejected rows have no approved_market_id and the join returns
  // nulls — which we surface as `featured: null` below so the UI
  // knows "no toggle applicable".
  const rows = status === 'all'
    ? await readSql`
        SELECT p.*, mk.featured AS market_featured, mk.status AS market_status
        FROM points_pending_markets p
        LEFT JOIN points_markets mk ON mk.id = p.approved_market_id
        ORDER BY p.created_at DESC
        LIMIT 2000
      `
    : await readSql`
        SELECT p.*, mk.featured AS market_featured, mk.status AS market_status
        FROM points_pending_markets p
        LEFT JOIN points_markets mk ON mk.id = p.approved_market_id
        WHERE p.status = ${status}
        ORDER BY
          CASE p.status WHEN 'pending' THEN 0 ELSE 1 END,
          p.end_time ASC NULLS LAST,
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
      status: r.status,
      adminNote: r.admin_note,
      reviewer: r.reviewer,
      reviewedAt: r.reviewed_at,
      approvedMarketId: r.approved_market_id,
      createdAt: r.created_at,
      // Pending row's own featured flag — the one the 🔥 button on a
      // Pendientes row toggles pre-approval. Carries into points_markets
      // when the row is approved.
      pendingFeatured: r.featured === true,
      // The already-created market's featured flag, if this row was
      // approved. null for pending/rejected — nothing to toggle there.
      marketFeatured: typeof r.market_featured === 'boolean' ? r.market_featured : null,
      marketStatus: r.market_status || null,
    })),
  });
}

/**
 * Approve ONE pending row — copy its spec into points_markets and flip
 * the pending row to 'approved'. Runs inside its own withTransaction so
 * bulk approval can call this per-row and tolerate per-row failure
 * without rolling back earlier successes.
 *
 * `opts` lets the MVP admin tag the resulting market as on-chain and
 * attach the deployed contract coordinates. Off-chain callers leave
 * opts empty (or pass mode: 'points') and behaviour is unchanged.
 *
 *   opts.mode          — 'points' (default) | 'onchain'
 *   opts.chainId       — numeric chain id (required when mode='onchain')
 *   opts.chainAddress  — 0x-prefixed 40-hex contract address (required
 *                        when mode='onchain'); persisted on parent + legs
 *   opts.chainMarketId — numeric market id within the contract (optional)
 *
 * Throws on validation / DB error. Returns { id, marketId }.
 */
async function approveOne(pid, reviewer, note, opts = {}) {
  const marketMode = opts.mode === 'onchain' ? 'onchain' : 'points';
  const isOnchain = marketMode === 'onchain';
  let chainIdNum = null;
  let chainAddressStr = null;
  let chainMarketIdStr = null;
  // Two paths to fill chainAddressStr when isOnchain:
  //   A) Manual paste — opts.chainAddress is a 0x40-hex address
  //   B) Auto-deploy — opts.autoDeploy=true, no chainAddress; we call
  //      MarketFactory ourselves once we've read the pending row's
  //      question / outcomes / endTime / seed.
  const wantsAutoDeploy = isOnchain
    && opts.autoDeploy === true
    && (!opts.chainAddress || String(opts.chainAddress).trim() === '');
  if (isOnchain) {
    chainIdNum = Number.parseInt(opts.chainId, 10);
    if (!Number.isInteger(chainIdNum) || chainIdNum <= 0) {
      const err = new Error('invalid_chain_id'); err.status = 400; throw err;
    }
    if (!wantsAutoDeploy) {
      if (typeof opts.chainAddress !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(opts.chainAddress.trim())) {
        const err = new Error('invalid_chain_address'); err.status = 400; throw err;
      }
      chainAddressStr = opts.chainAddress.trim().toLowerCase();
      if (opts.chainMarketId !== undefined && opts.chainMarketId !== null && opts.chainMarketId !== '') {
        const raw = String(opts.chainMarketId).trim();
        if (!/^\d{1,78}$/.test(raw)) {
          const err = new Error('invalid_chain_market_id'); err.status = 400; throw err;
        }
        chainMarketIdStr = raw;
      }
    }
  }
  // Lazy-load the deploy helper so off-chain approvals don't import
  // ethers / Turnkey deps unnecessarily. Validates env vars upfront so
  // the deploy doesn't fail mid-transaction.
  let deployer = null;
  if (wantsAutoDeploy) {
    const { isOnchainReady, deployMarketOnChain } = await import('../../_lib/onchain-trader.js');
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
    deployer = { deployerSuborgId, deployerAddr, deployMarketOnChain };
  }

  return withTransaction(async (client) => {
    const rowRes = await client.query(
      `SELECT * FROM points_pending_markets WHERE id = $1 FOR UPDATE`,
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

    const outcomes = parseJsonb(r.outcomes, []);
    if (!Array.isArray(outcomes) || outcomes.length < 2) {
      const err = new Error('invalid_outcomes'); err.status = 400; throw err;
    }
    const seed = Number(r.seed_liquidity);
    if (!Number.isFinite(seed) || seed < 100) {
      const err = new Error('seed_too_small'); err.status = 400; throw err;
    }
    const endDate = r.end_time ? new Date(r.end_time) : null;
    if (!endDate || isNaN(endDate.getTime()) || endDate <= new Date()) {
      const err = new Error('invalid_end_time'); err.status = 400;
      err.detail = 'end_time must be in the future at approval time';
      throw err;
    }

    const ammMode = r.amm_mode === 'parallel' ? 'parallel' : 'unified';
    let createdMarketId;

    const startIso = r.start_time ? new Date(r.start_time).toISOString() : null;

    const outcomeImages = parseJsonb(r.outcome_images, null);
    const outcomeImagesJson = Array.isArray(outcomeImages) && outcomeImages.length === outcomes.length
      ? JSON.stringify(outcomeImages)
      : null;

    const pendingFeatured = r.featured === true;

    // Auto-deploy step — runs BEFORE the INSERT so a failed deploy doesn't
    // leave a half-approved row pointing at no contract. Dispatches V1
    // (binary) or V2 (multi 2..8) inside deployMarketOnChain. Parallel
    // pending markets fall through to the manual-paste path because we
    // don't have a parallel factory yet (would need to loop V1 per leg).
    let parallelLegDeploys = null;
    if (wantsAutoDeploy && deployer && ammMode === 'unified') {
      try {
        const deployResult = await deployer.deployMarketOnChain({
          deployerSuborgId: deployer.deployerSuborgId,
          deployerAddr: deployer.deployerAddr,
          question: String(r.question || '').trim(),
          category: String(r.category || 'general').trim(),
          outcomeCount: outcomes.length,
          outcomeLabels: outcomes,
          endTime: endDate.toISOString(),
          resolutionSource: r.resolution_source || 'Pronos auto-resolver',
          seedAmount: seed,
        });
        chainAddressStr = String(deployResult.marketAddress || '').toLowerCase();
        chainMarketIdStr = deployResult.marketId || null;
      } catch (deployErr) {
        // Surface as much as we can — the trader helper sets .status /
        // .detail on its own errors. Anything else gets wrapped.
        const err = new Error(deployErr?.message || 'auto_deploy_failed');
        err.status = deployErr?.status || 500;
        err.detail = deployErr?.detail || null;
        if (deployErr?.txHash) err.detail = `${err.detail || ''} (tx=${deployErr.txHash})`.trim();
        throw err;
      }
    } else if (wantsAutoDeploy && deployer && ammMode === 'parallel') {
      // Loop V1 createMarket once per outcome — each leg is its own
      // binary Yes/No contract. The parent row gets no chain_address;
      // each leg's chain_address is filled below in the per-leg INSERT.
      try {
        const { deployParallelBinaryOnChain } = await import('../../_lib/onchain-trader.js');
        const parallelResult = await deployParallelBinaryOnChain({
          deployerSuborgId: deployer.deployerSuborgId,
          deployerAddr: deployer.deployerAddr,
          parentQuestion: String(r.question || '').trim(),
          category: String(r.category || 'general').trim(),
          outcomeLabels: outcomes,
          endTime: endDate.toISOString(),
          resolutionSource: r.resolution_source || 'Pronos auto-resolver',
          seedAmountPerLeg: seed,
        });
        parallelLegDeploys = parallelResult.legs;
      } catch (deployErr) {
        const err = new Error(deployErr?.message || 'parallel_auto_deploy_failed');
        err.status = deployErr?.status || 500;
        err.detail = deployErr?.detail || null;
        if (Array.isArray(deployErr?.partialLegs) && deployErr.partialLegs.length > 0) {
          err.detail = `${err.detail || ''} (${deployErr.partialLegs.length} legs already on-chain — orphaned)`.trim();
        }
        throw err;
      }
    }

    if (ammMode === 'unified') {
      const reserves = initialReserves(seed, outcomes.length);
      const mk = await client.query(
        `INSERT INTO points_markets
           (question, category, icon, outcomes, reserves, seed_liquidity,
            start_time, end_time, status, created_by, amm_mode,
            resolver_type, resolver_config, sport, league, outcome_images, featured,
            mode, chain_id, chain_market_id, chain_address)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, 'active', $9,
                 'unified', $10, $11::jsonb, $12, $13, $14::jsonb, $15,
                 $16, $17, $18, $19)
         RETURNING id`,
        [
          r.question,
          r.category,
          r.icon || null,
          JSON.stringify(outcomes),
          JSON.stringify(reserves),
          seed,
          startIso,
          endDate.toISOString(),
          reviewer,
          r.resolver_type || null,
          r.resolver_config ? JSON.stringify(r.resolver_config) : null,
          r.sport || null,
          r.league || null,
          outcomeImagesJson,
          pendingFeatured,
          marketMode,
          chainIdNum,
          chainMarketIdStr,
          chainAddressStr,
        ],
      );
      createdMarketId = mk.rows[0].id;
    } else {
      // Parallel — parent + N legs. Supports F1 / weather / future
      // generators that ship amm_mode='parallel'.
      const legReserves = initialReserves(seed, 2);
      const parent = await client.query(
        `INSERT INTO points_markets
           (question, category, icon, outcomes, reserves, seed_liquidity,
            start_time, end_time, status, created_by, amm_mode,
            resolver_type, resolver_config, sport, league, outcome_images, featured,
            mode, chain_id, chain_market_id, chain_address)
         VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, $5, $6, $7, 'active', $8,
                 'parallel', $9, $10::jsonb, $11, $12, $13::jsonb, $14,
                 $15, $16, $17, $18)
         RETURNING id`,
        [
          r.question,
          r.category,
          r.icon || null,
          JSON.stringify(outcomes),
          seed,
          startIso,
          endDate.toISOString(),
          reviewer,
          r.resolver_type || null,
          r.resolver_config ? JSON.stringify(r.resolver_config) : null,
          r.sport || null,
          r.league || null,
          outcomeImagesJson,
          pendingFeatured,
          marketMode,
          chainIdNum,
          chainMarketIdStr,
          chainAddressStr,
        ],
      );
      createdMarketId = parent.rows[0].id;
      for (let i = 0; i < outcomes.length; i++) {
        // Auto-deployed parallel: each leg has its own binary contract.
        // Manual / off-chain falls back to the parent's chainAddressStr
        // (which is null for off-chain points-mode markets).
        const legChainAddress = parallelLegDeploys
          ? String(parallelLegDeploys[i]?.marketAddress || '').toLowerCase()
          : chainAddressStr;
        const legChainMarketId = parallelLegDeploys
          ? (parallelLegDeploys[i]?.marketId || null)
          : null;

        await client.query(
          `INSERT INTO points_markets
             (question, category, icon, outcomes, reserves, seed_liquidity,
              start_time, end_time, status, created_by, amm_mode,
              parent_id, leg_label, sport, league, mode,
              chain_id, chain_market_id, chain_address)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, 'active', $9,
                   'parallel', $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            `${r.question} — ${outcomes[i]}`,
            r.category,
            r.icon || null,
            JSON.stringify(['Sí', 'No']),
            JSON.stringify(legReserves),
            seed,
            startIso,
            endDate.toISOString(),
            reviewer,
            createdMarketId,
            outcomes[i],
            r.sport || null,
            r.league || null,
            marketMode,
            chainIdNum,
            legChainMarketId,
            legChainAddress,
          ],
        );
      }
    }

    await client.query(
      `UPDATE points_pending_markets
         SET status = 'approved', admin_note = $1, reviewer = $2,
             reviewed_at = NOW(), approved_market_id = $3
       WHERE id = $4`,
      [note || null, reviewer, createdMarketId, pid],
    );
    return { id: pid, marketId: createdMarketId };
  });
}

async function review(req, res, admin) {
  const { id, action, note, mode, chainId, chainAddress, chainMarketId, autoDeploy } = req.body || {};
  // Shared opts passed to approveOne for both single-row and
  // approve_all paths. Default behaviour (no opts) keeps Points admin
  // approvals off-chain; the MVP admin sends mode='onchain' + chain
  // fields on every approve call.
  const approveOpts = { mode, chainId, chainAddress, chainMarketId, autoDeploy };

  await ensurePointsSchema(schemaSql);

  // Bulk approve — iterate every pending row with per-row transactions
  // so one bad spec (e.g. end_time already in the past) doesn't undo
  // the rows that processed cleanly before it. Returns a summary of
  // what landed + what failed so the admin UI can show the result.
  //
  // Bulk approve with mode='onchain' would assign the same chain_address
  // to every market, which doesn't match reality (each market = its own
  // contract). Reject it explicitly — MVP admin must approve on-chain
  // markets one at a time with per-market chain details.
  if (action === 'approve_all') {
    if (approveOpts?.mode === 'onchain') {
      return res.status(400).json({
        error: 'bulk_approve_onchain_unsupported',
        detail: 'On-chain approvals must be done one at a time so each market gets its own chain_address.',
      });
    }
    const pending = await readSql`
      SELECT id FROM points_pending_markets
      WHERE status = 'pending'
      ORDER BY id ASC
    `;
    const approved = [];
    const failures = [];
    for (const row of pending) {
      try {
        const result = await approveOne(row.id, admin.username, note, approveOpts);
        approved.push({ pendingId: result.id, marketId: result.marketId });
      } catch (e) {
        failures.push({
          pendingId: row.id,
          error: e?.message || 'unknown',
          detail: e?.detail || null,
        });
      }
    }
    return res.status(200).json({
      ok: true,
      action: 'approve_all',
      checked: pending.length,
      approvedCount: approved.length,
      failedCount: failures.length,
      approved,
      failures,
    });
  }

  // Single-row approve / reject — requires a valid id.
  const pid = parseInt(id, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: 'invalid_action' });
  }

  if (action === 'reject') {
    const result = await withTransaction(async (client) => {
      const rowRes = await client.query(
        `SELECT status FROM points_pending_markets WHERE id = $1 FOR UPDATE`,
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
        `UPDATE points_pending_markets
           SET status = 'rejected', admin_note = $1, reviewer = $2, reviewed_at = NOW()
         WHERE id = $3`,
        [note || null, admin.username, pid],
      );
      return { ok: true, action: 'reject', id: pid };
    });
    return res.status(200).json(result);
  }

  // action === 'approve'
  const approved = await approveOne(pid, admin.username, note, approveOpts);
  return res.status(200).json({ ok: true, action: 'approve', ...approved });
}
