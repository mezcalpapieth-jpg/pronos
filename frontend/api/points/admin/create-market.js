/**
 * POST /api/points/admin/create-market
 * Body: {
 *   question, category, icon?, endTime,
 *   outcomes: string[],       // 2 to 10 outcomes
 *   seedLiquidity,
 *   ammMode?: 'unified' | 'parallel'  // default 'unified'
 *   featured?: boolean
 *   sport?, league?, outcomeImages?
 * }
 *
 * Off-chain MXNP market. Points-app only. The MVP build's on-chain
 * markets are deployed via /api/protocol/admin/create-market which
 * calls MarketFactory.createMarket directly through Turnkey.
 *
 * 'unified' (default): one row in points_markets with N-element reserves,
 *   priced by the unified CPMM. Works for any N ≥ 2.
 *
 * 'parallel': one "parent" row (reserves = []) plus N "leg" rows, each a
 *   binary Sí/No market with reserves = [seed, seed]. Parent carries the
 *   display metadata; legs carry the binary CPMM state the trading
 *   endpoints operate on. Resolved via the parent's cascade on admin
 *   resolve.
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
    featured,
    sport, league, outcomeImages,
  } = req.body || {};
  const seed = Number(seedLiquidity);
  const mode = ammMode === 'parallel' ? 'parallel' : 'unified';
  // Points-app markets are off-chain forever; `marketMode` stays
  // 'points' regardless of body input. Kept as a constant so the
  // INSERT below doesn't have to special-case the column.
  const marketMode = 'points';

  // Sport / league / outcomeImages — optional metadata matching what the
  // generator pipeline writes. Lets manually-registered markets show up
  // in the /c/deportes sport sub-tabs + league sidebar and render team
  // crests in outcome rows.
  const sportVal = typeof sport === 'string' && sport.trim() ? sport.trim().toLowerCase() : null;
  const leagueVal = typeof league === 'string' && league.trim() ? league.trim().toLowerCase() : null;
  // outcomeImages must be an array of strings (URLs) the same length as
  // `outcomes`. Anything else is rejected to avoid index-misaligned crests.
  let outcomeImagesJson = null;
  if (Array.isArray(outcomeImages) && outcomeImages.length > 0) {
    if (outcomeImages.length !== (Array.isArray(outcomes) ? outcomes.length : 0)) {
      return res.status(400).json({ error: 'outcome_images_length_mismatch' });
    }
    const cleaned = outcomeImages.map(u => typeof u === 'string' ? u.trim() : '');
    if (!cleaned.every(u => u === '' || /^https?:\/\//i.test(u))) {
      return res.status(400).json({ error: 'invalid_outcome_image_url' });
    }
    outcomeImagesJson = JSON.stringify(cleaned);
  }

  // chain_id / chain_address / chain_market_id columns still live on
  // points_markets (legacy schema) but are always NULL going forward.
  // They're kept nullable so we don't need a destructive migration; a
  // future cleanup can drop them once no rows reference them.
  const chainIdNum = null;
  const chainAddressStr = null;
  const chainMarketIdStr = null;
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

  // On-chain auto-deploy used to live here. It moved to
  // /api/protocol/admin/create-market when points-app and the MVP
  // were split; off-chain MXNP markets never touch the chain.
  const parallelLegDeploys = null;
  const autoDeployResult = null;

  try {
    await ensurePointsSchema(schemaSql);

    if (mode === 'unified') {
      const reserves = initialReserves(seed, normalizedOutcomes.length);
      const result = await withTransaction(async (client) => {
        const r = await client.query(
          `INSERT INTO points_markets
             (question, category, icon, outcomes, reserves, seed_liquidity,
              end_time, status, created_by, amm_mode, featured,
              mode, chain_id, chain_market_id, chain_address,
              sport, league, outcome_images)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, 'active', $8, 'unified', $9,
                   $10, $11, $12, $13, $14, $15, $16::jsonb)
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
            sportVal,
            leagueVal,
            outcomeImagesJson,
          ],
        );
        return r.rows[0].id;
      });
      return res.status(200).json({
        ok: true,
        marketId: result,
        ammMode: 'unified',
        mode: marketMode,
        autoDeploy: autoDeployResult ? {
          chainAddress: autoDeployResult.marketAddress,
          chainMarketId: autoDeployResult.marketId,
          txHash: autoDeployResult.txHash,
          blockNumber: autoDeployResult.blockNumber,
          chainId: autoDeployResult.chainId,
        } : null,
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
            mode, chain_id, chain_market_id, chain_address,
            sport, league, outcome_images)
         VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, $5, $6, 'active', $7, 'parallel', $8,
                 $9, $10, $11, $12, $13, $14, $15::jsonb)
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
          sportVal,
          leagueVal,
          outcomeImagesJson,
        ],
      );
      const parentId = parent.rows[0].id;

      for (let i = 0; i < normalizedOutcomes.length; i++) {
        // For onchain auto-deployed parallel markets, each leg gets the
        // address of the binary contract we just deployed for it. Manual
        // / off-chain parallel falls back to chainAddressStr (which is
        // null for off-chain points-mode markets).
        const legChainAddress = parallelLegDeploys
          ? String(parallelLegDeploys[i]?.marketAddress || '').toLowerCase()
          : chainAddressStr;
        const legChainMarketId = parallelLegDeploys
          ? (parallelLegDeploys[i]?.marketId || null)
          : null;

        await client.query(
          `INSERT INTO points_markets
             (question, category, icon, outcomes, reserves, seed_liquidity,
              end_time, status, created_by, amm_mode, parent_id, leg_label,
              mode, chain_id, chain_market_id, chain_address)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, 'active', $8,
                   'parallel', $9, $10, $11, $12, $13, $14)`,
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
            legChainMarketId,
            legChainAddress,
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
