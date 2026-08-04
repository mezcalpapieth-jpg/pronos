/**
 * POST /api/points/admin/create-market
 * Body: {
 *   question, category, icon?, endTime,
 *   outcomes: string[],       // 2 to 10 outcomes
 *   seedLiquidity,             // legacy scalar fallback
 *   seedLiquidities?: number[] // index-aligned per-outcome liquidity
 *   ammMode?: 'unified' | 'parallel'  // default 'unified'
 *   featured?: boolean
 *   sport?, league?, outcomeImages?, geo?
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
import { deriveMarketTags } from '../../_lib/category-tags.js';
import { normalizeSeedLiquidities } from '../../_lib/market-liquidity.js';
import { neon } from '@neondatabase/serverless';

const schemaSql = neon(process.env.DATABASE_URL);

const ALLOWED_CATEGORIES = new Set([
  'general', 'mexico', 'politica', 'deportes', 'finanzas', 'crypto', 'musica', 'world-cup',
]);
const ALLOWED_GEO_TAGS = new Set(['mexico', 'latam', 'world']);
const ALLOWED_TOPIC_TAGS = new Set([
  'general',
  'politica',
  'deportes',
  'finanzas',
  'crypto',
  'musica',
  'cine',
  'tv',
  'farandula',
  'weather',
  'world-cup',
]);

function normalizeTagArray(value, allowed) {
  if (value == null) return null;
  if (!Array.isArray(value)) return { error: 'invalid_tags' };
  const out = [];
  for (const item of value) {
    const tag = String(item || '').trim().toLowerCase();
    if (!tag) continue;
    if (!allowed.has(tag)) return { error: 'invalid_tags' };
    if (!out.includes(tag)) out.push(tag);
  }
  return { value: out.length ? out : null };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const {
    question, category, endTime, outcomes, seedLiquidity, seedLiquidities, ammMode,
    featured,
    sport, league, outcomeImages, geo, topicTags,
  } = req.body || {};
  const mode = ammMode === 'parallel' ? 'parallel' : 'unified';
  // Points-app markets are off-chain forever; `marketMode` stays
  // 'points' regardless of body input. Kept as a constant so the
  // INSERT below doesn't have to special-case the column.
  const marketMode = 'points';
  const marketIcon = null;

  // Sport / league / outcomeImages — optional metadata matching what the
  // generator pipeline writes. Lets manually-registered markets show up
  // in the /c/deportes sport sub-tabs + league sidebar and render team
  // crests in outcome rows.
  const sportVal = typeof sport === 'string' && sport.trim() ? sport.trim().toLowerCase() : null;
  const leagueVal = typeof league === 'string' && league.trim() ? league.trim().toLowerCase() : null;
  const geoVal = typeof geo === 'string' && geo.trim() ? geo.trim().toLowerCase() : null;
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
  if (geoVal && !ALLOWED_GEO_TAGS.has(geoVal)) {
    return res.status(400).json({ error: 'invalid_geo' });
  }
  const normalizedTopicTags = normalizeTagArray(topicTags, ALLOWED_TOPIC_TAGS);
  if (normalizedTopicTags?.error) return res.status(400).json({ error: normalizedTopicTags.error });
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
  const normalizedLiquidity = normalizeSeedLiquidities({
    outcomes: normalizedOutcomes,
    seedLiquidity,
    seedLiquidities,
  });
  if (normalizedLiquidity.error) {
    return res.status(400).json({ error: normalizedLiquidity.error });
  }
  const seedValues = normalizedLiquidity.values;
  const seed = normalizedLiquidity.fallback;
  const seedLiquiditiesJson = JSON.stringify(seedValues);
  const endDate = endTime ? new Date(endTime) : null;
  if (!endDate || isNaN(endDate.getTime()) || endDate <= new Date()) {
    return res.status(400).json({ error: 'invalid_end_time' });
  }
  const tagBundle = deriveMarketTags({
    question: question.trim(),
    category,
    sport: sportVal,
    league: leagueVal,
    source_data: geoVal ? { marketRegion: geoVal } : {},
    topicTags: normalizedTopicTags?.value,
  });
  const categoryTagsJson = JSON.stringify(tagBundle.categoryTags);
  const geoTagsJson = JSON.stringify(tagBundle.geoTags);
  const topicTagsJson = JSON.stringify(tagBundle.topicTags);

  // On-chain auto-deploy used to live here. It moved to
  // /api/protocol/admin/create-market when points-app and the MVP
  // were split; off-chain MXNP markets never touch the chain.
  const parallelLegDeploys = null;
  const autoDeployResult = null;

  try {
    await ensurePointsSchema(schemaSql);

    if (mode === 'unified') {
      const reserves = seedValues;
      const result = await withTransaction(async (client) => {
        const r = await client.query(
          `INSERT INTO points_markets
             (question, category, icon, outcomes, reserves, seed_liquidity, seed_liquidities,
              end_time, status, created_by, amm_mode, featured,
              mode, chain_id, chain_market_id, chain_address,
              sport, league, outcome_images, category_tags, geo_tags, topic_tags)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8, 'active', $9, 'unified', $10,
                   $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb)
           RETURNING id`,
          [
            question.trim(),
            category,
            marketIcon,
            JSON.stringify(normalizedOutcomes),
            JSON.stringify(reserves),
            seed,
            seedLiquiditiesJson,
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
            categoryTagsJson,
            geoTagsJson,
            topicTagsJson,
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
    const result = await withTransaction(async (client) => {
      const parent = await client.query(
        `INSERT INTO points_markets
           (question, category, icon, outcomes, reserves, seed_liquidity, seed_liquidities,
            end_time, status, created_by, amm_mode, featured,
            mode, chain_id, chain_market_id, chain_address,
            sport, league, outcome_images, category_tags, geo_tags, topic_tags)
         VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, $5, $6::jsonb, $7, 'active', $8, 'parallel', $9,
                 $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb)
         RETURNING id`,
        [
          question.trim(),
          category,
          marketIcon,
          JSON.stringify(normalizedOutcomes),
          seed,
          seedLiquiditiesJson,
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
          categoryTagsJson,
          geoTagsJson,
          topicTagsJson,
        ],
      );
      const parentId = parent.rows[0].id;

      for (let i = 0; i < normalizedOutcomes.length; i++) {
        const legSeed = seedValues[i];
        const legReserves = initialReserves(legSeed, 2); // always [legSeed, legSeed]
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
             (question, category, icon, outcomes, reserves, seed_liquidity, seed_liquidities,
              end_time, status, created_by, amm_mode, parent_id, leg_label,
              mode, chain_id, chain_market_id, chain_address,
              category_tags, geo_tags, topic_tags)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8, 'active', $9,
                   'parallel', $10, $11, $12, $13, $14, $15,
                   $16::jsonb, $17::jsonb, $18::jsonb)`,
          [
            // Leg "question" is synthetic — positions.js + portfolio use
            // parent.question + leg_label for display, but keeping a
            // human-readable fallback here helps admin DB inspection.
            `${question.trim()} — ${normalizedOutcomes[i]}`,
            category,
            marketIcon,
            JSON.stringify(['Sí', 'No']),
            JSON.stringify(legReserves),
            legSeed,
            JSON.stringify([legSeed, legSeed]),
            endDate.toISOString(),
            admin.username,
            parentId,
            normalizedOutcomes[i],
            marketMode,
            chainIdNum,
            legChainMarketId,
            legChainAddress,
            categoryTagsJson,
            geoTagsJson,
            topicTagsJson,
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
