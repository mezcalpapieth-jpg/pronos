/**
 * POST /api/points/admin/create-market
 * Body: {
 *   question, category, icon?, endTime,
 *   outcomes: string[],       // 2 to 10 outcomes
 *   seedLiquidity,
 *   ammMode?: 'unified' | 'parallel'  // default 'unified'
 *
 *   // ── On-chain registration (MVP admin) ─────────────────────────
 *   mode?: 'points' | 'onchain'       // default 'points'
 *   chainId?: number                  // e.g. 421614 Arbitrum Sepolia
 *   chainAddress?: string             // deployed PronosAMM / MarketFactory address
 *   chainMarketId?: string            // on-chain market index (bigint as string)
 *   featured?: boolean                // default false
 *
 * When mode='onchain' the DB row is a mirror of an on-chain market that
 * was already deployed via MarketFactory. Reserves here are display-only —
 * buy.js/sell.js read the real reserves from the chain for trade math.
 * Off-chain mode='points' continues to work exactly as before.
 * }
 *
 * 'unified' (default): one row in points_markets with N-element reserves,
 *   priced by the unified CPMM. Works for any N ≥ 2. This is the
 *   original behaviour.
 *
 * 'parallel': one "parent" row (reserves = []) plus N "leg" rows, each a
 *   binary Sí/No market with reserves = [seed, seed]. Parent carries the
 *   display metadata (question, outcomes as labels, end_time); legs carry
 *   the binary CPMM state the trading endpoints operate on. Addressable
 *   by parent id; legs are resolved via the parent's cascade on admin
 *   resolve. Admin-only endpoint.
 */
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { initialReserves } from '../../_lib/amm-math.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { neon } from '@neondatabase/serverless';

const schemaSql = neon(process.env.DATABASE_URL);

const ALLOWED_CATEGORIES = new Set([
  'general', 'mexico', 'politica', 'deportes', 'finanzas', 'crypto', 'musica',
]);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const {
    question, category, icon, endTime, outcomes, seedLiquidity, ammMode,
    mode: chainMode, chainId, chainAddress, chainMarketId, featured,
  } = req.body || {};
  const seed = Number(seedLiquidity);
  const mode = ammMode === 'parallel' ? 'parallel' : 'unified';
  // `marketMode` is the off-chain/on-chain classifier (the `mode`
  // column on points_markets) — distinct from `ammMode` above.
  const marketMode = chainMode === 'onchain' ? 'onchain' : 'points';
  const isOnchain = marketMode === 'onchain';

  // Validate chain metadata when registering an on-chain market.
  let chainIdNum = null;
  let chainAddressStr = null;
  let chainMarketIdStr = null;
  if (isOnchain) {
    chainIdNum = Number.parseInt(chainId, 10);
    if (!Number.isInteger(chainIdNum) || chainIdNum <= 0) {
      return res.status(400).json({ error: 'invalid_chain_id' });
    }
    if (typeof chainAddress !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(chainAddress.trim())) {
      return res.status(400).json({ error: 'invalid_chain_address' });
    }
    chainAddressStr = chainAddress.trim().toLowerCase();
    // chainMarketId is optional at registration — some deployments
    // expose only the AMM contract address and the MVP treats that as
    // the market. We accept any numeric string ≤ 78 chars (BigInt
    // safe) or null.
    if (chainMarketId !== undefined && chainMarketId !== null && chainMarketId !== '') {
      const raw = String(chainMarketId).trim();
      if (!/^\d{1,78}$/.test(raw)) {
        return res.status(400).json({ error: 'invalid_chain_market_id' });
      }
      chainMarketIdStr = raw;
    }
    // Parallel onchain: the parent row + each leg all share the same
    // `chain_address` (display-level mirror). Per-leg contract addresses
    // can be patched in later via edit-market; keeps registration simple.
  }
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
    await ensurePointsSchema(schemaSql);

    if (mode === 'unified') {
      const reserves = initialReserves(seed, normalizedOutcomes.length);
      const result = await withTransaction(async (client) => {
        const r = await client.query(
          `INSERT INTO points_markets
             (question, category, icon, outcomes, reserves, seed_liquidity,
              end_time, status, created_by, amm_mode, featured,
              mode, chain_id, chain_market_id, chain_address)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, 'active', $8, 'unified', $9,
                   $10, $11, $12, $13)
           RETURNING id`,
          [
            question.trim(),
            category,
            icon || null,
            JSON.stringify(normalizedOutcomes),
            JSON.stringify(reserves),
            seed,
            endDate.toISOString(),
            admin.username,
            featured === true,
            marketMode,
            chainIdNum,
            chainMarketIdStr,
            chainAddressStr,
          ],
        );
        return r.rows[0].id;
      });
      return res.status(200).json({
        ok: true,
        marketId: result,
        ammMode: 'unified',
        mode: marketMode,
      });
    }

    // Parallel: parent carries metadata, N legs carry binary CPMM state.
    // On-chain parallel markets share the parent's chain_address across
    // legs; each leg's chain_market_id can be patched in later via
    // edit-market (e.g. when the MarketFactory emits the leg ids).
    const legReserves = initialReserves(seed, 2); // always [seed, seed]
    const result = await withTransaction(async (client) => {
      const parent = await client.query(
        `INSERT INTO points_markets
           (question, category, icon, outcomes, reserves, seed_liquidity,
            end_time, status, created_by, amm_mode, featured,
            mode, chain_id, chain_market_id, chain_address)
         VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, $5, $6, 'active', $7, 'parallel', $8,
                 $9, $10, $11, $12)
         RETURNING id`,
        [
          question.trim(),
          category,
          icon || null,
          JSON.stringify(normalizedOutcomes),
          seed,
          endDate.toISOString(),
          admin.username,
          featured === true,
          marketMode,
          chainIdNum,
          chainMarketIdStr,
          chainAddressStr,
        ],
      );
      const parentId = parent.rows[0].id;

      for (let i = 0; i < normalizedOutcomes.length; i++) {
        await client.query(
          `INSERT INTO points_markets
             (question, category, icon, outcomes, reserves, seed_liquidity,
              end_time, status, created_by, amm_mode, parent_id, leg_label,
              mode, chain_id, chain_address)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, 'active', $8,
                   'parallel', $9, $10, $11, $12, $13)`,
          [
            // Leg "question" is synthetic — positions.js + portfolio use
            // parent.question + leg_label for display, but keeping a
            // human-readable fallback here helps admin DB inspection.
            `${question.trim()} — ${normalizedOutcomes[i]}`,
            category,
            icon || null,
            JSON.stringify(['Sí', 'No']),
            JSON.stringify(legReserves),
            seed,
            endDate.toISOString(),
            admin.username,
            parentId,
            normalizedOutcomes[i],
            marketMode,
            chainIdNum,
            chainAddressStr,
          ],
        );
      }
      return parentId;
    });
    return res.status(200).json({
      ok: true,
      marketId: result,
      ammMode: 'parallel',
      mode: marketMode,
    });
  } catch (e) {
    console.error('[admin/create-market] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'create_failed', detail: e?.message?.slice(0, 240) });
  }
}
