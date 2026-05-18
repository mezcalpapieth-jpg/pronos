/**
 * POST /api/protocol/admin/create-market
 * Body: {
 *   question, category, endTime,
 *   outcomes: string[],            // 2..8
 *   seedAmount,                    // collateral units (MXNB)
 *   resolutionSource?: string,
 *   ammMode?: 'unified' | 'parallel',
 * }
 *
 * MVP-only on-chain market deployment. Calls MarketFactory.createMarket
 * (V1 for binary, V2 for 3..8, parallel-binary loop for 'parallel' mode)
 * via Turnkey delegated signing using the deployer suborg + wallet.
 *
 * Writes the deployed market metadata to `protocol_markets` immediately
 * after a successful on-chain transaction; the indexer later upserts the
 * same event data and keeps the metadata columns intact.
 *
 * Off-chain points-app market creation lives in
 * /api/points/admin/create-market.js — unrelated.
 */
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { ensureProtocolSchema } from '../../_lib/protocol-schema.js';
import {
  deployMarketOnChain,
  deployParallelBinaryOnChain,
  isOnchainReady,
} from '../../_lib/onchain-trader.js';
import {
  ALLOWED_PROTOCOL_CATEGORIES,
  cleanOptionalText,
  normalizeOutcomeImages,
  parallelLegQuestion,
  upsertProtocolMarketMetadata,
} from '../../_lib/protocol-market-admin.js';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const TAG_ALLOWLISTS = {
  categoryTags: new Set(['general', 'mexico', 'politica', 'deportes', 'finanzas', 'crypto', 'musica', 'world-cup']),
  geoTags: new Set(['mexico', 'latam', 'world']),
  topicTags: new Set(['general', 'politica', 'deportes', 'finanzas', 'crypto', 'musica', 'weather', 'world-cup']),
};

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

  if (!isOnchainReady()) {
    return res.status(503).json({
      error: 'onchain_not_enabled',
      detail: 'set TURNKEY_POLICIES_ENABLED + ONCHAIN_RPC_URL + ONCHAIN_COLLATERAL_ADDRESS',
    });
  }

  const deployerSuborgId = process.env.ONCHAIN_DEPLOYER_SUBORG_ID;
  const deployerAddr = process.env.ONCHAIN_DEPLOYER_ADDRESS;
  if (!deployerSuborgId || !deployerAddr) {
    return res.status(503).json({
      error: 'deployer_not_configured',
      detail: 'set ONCHAIN_DEPLOYER_SUBORG_ID + ONCHAIN_DEPLOYER_ADDRESS',
    });
  }

  const {
    question, category, endTime, outcomes, seedAmount,
    resolutionSource, ammMode, icon, sport, league, outcomeImages,
    categoryTags, geoTags, topicTags,
  } = req.body || {};

  if (typeof question !== 'string' || question.trim().length < 8) {
    return res.status(400).json({ error: 'invalid_question' });
  }
  if (!ALLOWED_PROTOCOL_CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'invalid_category' });
  }
  if (!Array.isArray(outcomes) || outcomes.length < 2 || outcomes.length > 8) {
    return res.status(400).json({ error: 'outcome_count_out_of_range' });
  }
  if (!outcomes.every(o => typeof o === 'string' && o.trim().length > 0)) {
    return res.status(400).json({ error: 'invalid_outcomes' });
  }
  const normalizedOutcomes = outcomes.map(o => o.trim());
  const lowerSet = new Set(normalizedOutcomes.map(o => o.toLowerCase()));
  if (lowerSet.size !== normalizedOutcomes.length) {
    return res.status(400).json({ error: 'duplicate_outcomes' });
  }
  const iconVal = cleanOptionalText(icon);
  const sportVal = cleanOptionalText(sport)?.toLowerCase() || null;
  const leagueVal = cleanOptionalText(league)?.toLowerCase() || null;
  const imageResult = normalizeOutcomeImages(outcomeImages, normalizedOutcomes.length);
  if (!imageResult.ok) return res.status(400).json({ error: imageResult.error });
  const cleanedOutcomeImages = imageResult.value;
  const normalizedCategoryTags = normalizeTagArray(categoryTags, TAG_ALLOWLISTS.categoryTags);
  if (normalizedCategoryTags?.error) return res.status(400).json({ error: normalizedCategoryTags.error });
  const normalizedGeoTags = normalizeTagArray(geoTags, TAG_ALLOWLISTS.geoTags);
  if (normalizedGeoTags?.error) return res.status(400).json({ error: normalizedGeoTags.error });
  const normalizedTopicTags = normalizeTagArray(topicTags, TAG_ALLOWLISTS.topicTags);
  if (normalizedTopicTags?.error) return res.status(400).json({ error: normalizedTopicTags.error });
  const seed = Number(seedAmount);
  if (!Number.isFinite(seed) || seed < 100) {
    return res.status(400).json({ error: 'seed_too_small' });
  }
  const endDate = endTime ? new Date(endTime) : null;
  if (!endDate || isNaN(endDate.getTime()) || endDate <= new Date()) {
    return res.status(400).json({ error: 'invalid_end_time' });
  }
  const mode = ammMode === 'parallel' ? 'parallel' : 'unified';
  const resolverSrc = (typeof resolutionSource === 'string' && resolutionSource.trim())
    ? resolutionSource.trim()
    : 'Pronos admin';

  try {
    await ensureProtocolSchema(sql);

    if (mode === 'parallel') {
      const result = await deployParallelBinaryOnChain({
        deployerSuborgId,
        deployerAddr,
        parentQuestion: question.trim(),
        category,
        outcomeLabels: normalizedOutcomes,
        endTime: endDate.toISOString(),
        resolutionSource: resolverSrc,
        seedAmountPerLeg: seed,
      });
      let metadataWarning = null;
      try {
        for (let i = 0; i < result.legs.length; i++) {
          const leg = result.legs[i];
          const label = normalizedOutcomes[i];
          await upsertProtocolMarketMetadata(sql, {
            result: {
              ...leg,
              chainId: result.chainId,
              factoryVariant: 'v1-binary',
            },
            question: parallelLegQuestion(question.trim(), label),
            category,
            icon: iconVal,
            outcomes: ['Sí', 'No'],
            endTime: endDate.toISOString(),
            resolutionSource: resolverSrc,
            seedAmount: seed,
            sport: sportVal,
            league: leagueVal,
            outcomeImages: cleanedOutcomeImages?.[i] ? [cleanedOutcomeImages[i], ''] : null,
            factoryVariant: 'v1-binary',
            categoryTags: normalizedCategoryTags?.value,
            geoTags: normalizedGeoTags?.value,
            topicTags: normalizedTopicTags?.value,
          });
        }
      } catch (metadataErr) {
        metadataWarning = metadataErr?.message || 'metadata_upsert_failed';
        console.error('[protocol/admin/create-market] metadata upsert failed', {
          message: metadataErr?.message, code: metadataErr?.code,
        });
      }
      return res.status(200).json({
        ok: true,
        ammMode: 'parallel',
        chainId: result.chainId,
        legs: result.legs,
        metadataStored: !metadataWarning,
        metadataWarning,
      });
    }

    const result = await deployMarketOnChain({
      deployerSuborgId,
      deployerAddr,
      question: question.trim(),
      category,
      outcomeCount: normalizedOutcomes.length,
      outcomeLabels: normalizedOutcomes,
      endTime: endDate.toISOString(),
      resolutionSource: resolverSrc,
      seedAmount: seed,
    });
    let metadataWarning = null;
    try {
      await upsertProtocolMarketMetadata(sql, {
        result,
        question: question.trim(),
        category,
        icon: iconVal,
        outcomes: normalizedOutcomes,
        endTime: endDate.toISOString(),
        resolutionSource: resolverSrc,
        seedAmount: seed,
        sport: sportVal,
        league: leagueVal,
        outcomeImages: cleanedOutcomeImages,
        categoryTags: normalizedCategoryTags?.value,
        geoTags: normalizedGeoTags?.value,
        topicTags: normalizedTopicTags?.value,
      });
    } catch (metadataErr) {
      metadataWarning = metadataErr?.message || 'metadata_upsert_failed';
      console.error('[protocol/admin/create-market] metadata upsert failed', {
        message: metadataErr?.message, code: metadataErr?.code,
      });
    }
    return res.status(200).json({
      ok: true,
      ammMode: 'unified',
      marketId: result.marketId,
      marketAddress: result.marketAddress,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      chainId: result.chainId,
      factoryVariant: result.factoryVariant,
      metadataStored: !metadataWarning,
      metadataWarning,
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({
        error: e.message,
        detail: e.detail || null,
        partialLegs: e.partialLegs || null,
        txHash: e.txHash || null,
      });
    }
    console.error('[protocol/admin/create-market] failed', {
      message: e?.message, code: e?.code,
    });
    return res.status(500).json({ error: 'create_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
