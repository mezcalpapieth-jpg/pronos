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
import { deriveMarketTags } from '../../_lib/category-tags.js';
import {
  deployMarketOnChain,
  deployParallelBinaryOnChain,
  isOnchainReady,
} from '../../_lib/onchain-trader.js';
import { neon } from '@neondatabase/serverless';

const ALLOWED_CATEGORIES = new Set([
  'general', 'mexico', 'politica', 'deportes', 'finanzas', 'crypto', 'musica', 'world-cup',
]);

const sql = neon(process.env.DATABASE_URL);

function cleanOptionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function factoryAddressForVariant(variant) {
  const raw = String(variant || '').startsWith('v2')
    ? process.env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS
    : process.env.ONCHAIN_MARKET_FACTORY_ADDRESS;
  return raw ? raw.toLowerCase() : null;
}

function parallelLegQuestion(parentQuestion, label) {
  const raw = `${parentQuestion.trim()} — ¿${label}?`;
  return raw.length > 240 ? `${raw.slice(0, 237)}…` : raw;
}

async function upsertProtocolMarketMetadata({
  result,
  question,
  category,
  icon,
  outcomes,
  endTime,
  resolutionSource,
  seedAmount,
  sport,
  league,
  outcomeImages,
  factoryVariant,
}) {
  const factoryAddress = factoryAddressForVariant(factoryVariant || result.factoryVariant);
  if (!factoryAddress || !result.marketAddress || result.marketId == null) return;

  const tags = deriveMarketTags({
    question,
    category,
    sport,
    league,
  });
  const protocolVersion = String(factoryVariant || result.factoryVariant || '').startsWith('v2')
    ? 'v2'
    : 'v1';

  await sql`
    INSERT INTO protocol_markets (
      chain_id, factory_address, pool_address, market_id,
      question, category, icon, end_time, resolution_src,
      tx_hash, seed_liquidity, protocol_version, outcome_count, outcomes,
      sport, league, outcome_images, category_tags, geo_tags, topic_tags
    )
    VALUES (
      ${result.chainId}, ${factoryAddress}, ${String(result.marketAddress).toLowerCase()}, ${result.marketId},
      ${question}, ${category}, ${icon}, ${endTime}, ${resolutionSource},
      ${result.txHash || null}, ${seedAmount}, ${protocolVersion}, ${outcomes.length}, ${JSON.stringify(outcomes)}::jsonb,
      ${sport}, ${league}, ${outcomeImages ? JSON.stringify(outcomeImages) : null}::jsonb,
      ${JSON.stringify(tags.categoryTags)}::jsonb, ${JSON.stringify(tags.geoTags)}::jsonb, ${JSON.stringify(tags.topicTags)}::jsonb
    )
    ON CONFLICT (chain_id, factory_address, market_id) DO UPDATE SET
      pool_address = EXCLUDED.pool_address,
      question = EXCLUDED.question,
      category = EXCLUDED.category,
      icon = COALESCE(EXCLUDED.icon, protocol_markets.icon),
      end_time = EXCLUDED.end_time,
      resolution_src = EXCLUDED.resolution_src,
      tx_hash = COALESCE(EXCLUDED.tx_hash, protocol_markets.tx_hash),
      seed_liquidity = CASE
        WHEN COALESCE(protocol_markets.seed_liquidity, 0) = 0 THEN EXCLUDED.seed_liquidity
        ELSE protocol_markets.seed_liquidity
      END,
      protocol_version = EXCLUDED.protocol_version,
      outcome_count = EXCLUDED.outcome_count,
      outcomes = EXCLUDED.outcomes,
      sport = COALESCE(EXCLUDED.sport, protocol_markets.sport),
      league = COALESCE(EXCLUDED.league, protocol_markets.league),
      outcome_images = COALESCE(EXCLUDED.outcome_images, protocol_markets.outcome_images),
      category_tags = EXCLUDED.category_tags,
      geo_tags = EXCLUDED.geo_tags,
      topic_tags = EXCLUDED.topic_tags
  `;
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
  } = req.body || {};

  if (typeof question !== 'string' || question.trim().length < 8) {
    return res.status(400).json({ error: 'invalid_question' });
  }
  if (!ALLOWED_CATEGORIES.has(category)) {
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
  let cleanedOutcomeImages = null;
  if (Array.isArray(outcomeImages) && outcomeImages.length > 0) {
    if (outcomeImages.length !== normalizedOutcomes.length) {
      return res.status(400).json({ error: 'outcome_images_length_mismatch' });
    }
    const cleaned = outcomeImages.map(u => typeof u === 'string' ? u.trim() : '');
    if (!cleaned.every(u => u === '' || /^https?:\/\//i.test(u))) {
      return res.status(400).json({ error: 'invalid_outcome_image_url' });
    }
    cleanedOutcomeImages = cleaned;
  }
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
          await upsertProtocolMarketMetadata({
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
      await upsertProtocolMarketMetadata({
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
