/**
 * POST /api/points/admin/edit-market
 * Body: { marketId, question?, startTime?, endTime?, category?, imageUrl?, outcomeImages?, parallelLegs? }
 *
 * Admin-only. Updates the editable fields of a points market:
 *   - question: the user-facing title
 *   - start_time: when the market should open for trading
 *   - end_time: the trading/resolution deadline (ISO-8601 string or
 *               epoch ms)
 *   - category: display bucket (deportes, politica, etc.)
 *   - image_url: market-level display image URL/path
 *   - outcome_images: outcome-aligned logo/headshot URLs
 *
 * Only non-null/undefined fields are applied. For active parallel parent
 * markets, admins may also repair child-leg binary reserves. This moves the
 * live curve from that point forward, but does not rewrite positions/trades.
 *
 * For parallel markets we also cascade shared timing/category edits to
 * every leg so the parent and legs stay in sync.
 *
 * Returns: the updated market row so the admin UI can refresh without
 * a follow-up GET.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { deriveMarketTags } from '../../_lib/category-tags.js';
import { syncMananeraPhraseFromQuestion } from '../../_lib/mananera-market-sync.js';
import { syncApiPriceFromQuestion } from '../../_lib/api-price-market-sync.js';
import { syncWeatherDateFromMarket } from '../../_lib/weather-market-sync.js';
import { withTransaction } from '../../_lib/db-tx.js';

const sql = neon(process.env.DATABASE_URL);

const ALLOWED_CATEGORIES = new Set([
  'general', 'mexico', 'politica', 'deportes', 'finanzas', 'crypto', 'musica', 'world-cup',
]);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function cleanOptionalImageRef(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text.slice(0, 1000);
  if (/^\/[a-z0-9][a-z0-9/_\-.%]*$/i.test(text) && !text.includes('..')) {
    return text.slice(0, 1000);
  }
  return null;
}

function cleanReserve(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1_000_000) / 1_000_000;
}

function normalizeParallelLegPatches(value) {
  if (value === undefined || value === null) return { value: null };
  if (!Array.isArray(value)) return { error: 'invalid_parallel_legs' };
  if (value.length === 0) return { value: [] };
  if (value.length > 80) return { error: 'too_many_parallel_legs' };

  const seen = new Set();
  const patches = [];
  for (const raw of value) {
    const id = Number(raw?.id ?? raw?.marketId);
    if (!Number.isInteger(id) || id <= 0) return { error: 'invalid_parallel_leg_id' };
    if (seen.has(id)) return { error: 'duplicate_parallel_leg_id' };
    seen.add(id);

    const yesReserve = cleanReserve(raw?.yesReserve ?? raw?.reserves?.[0]);
    const noReserve = cleanReserve(raw?.noReserve ?? raw?.reserves?.[1]);
    if (yesReserve == null || noReserve == null) return { error: 'invalid_parallel_leg_reserve' };
    if (yesReserve < 100 || noReserve < 100) return { error: 'parallel_leg_reserve_too_small' };
    if (yesReserve > 10_000_000 || noReserve > 10_000_000) return { error: 'parallel_leg_reserve_too_large' };
    patches.push({ id, yesReserve, noReserve });
  }
  return { value: patches };
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const session = requirePointsAdmin(req, res);
    if (!session) return; // 401/403 already sent

    const body = req.body || {};
    const { marketId, question, startTime, endTime, category, parallelLegs } = body;
    const hasMarketImagePatch = Object.prototype.hasOwnProperty.call(body, 'imageUrl')
      || Object.prototype.hasOwnProperty.call(body, 'image_url');
    const rawMarketImageUrl = hasMarketImagePatch
      ? (body.imageUrl ?? body.image_url)
      : null;
    const hasOutcomeImagesPatch = Object.prototype.hasOwnProperty.call(body, 'outcomeImages')
      || Object.prototype.hasOwnProperty.call(body, 'outcome_images');
    const rawOutcomeImages = hasOutcomeImagesPatch
      ? (body.outcomeImages ?? body.outcome_images)
      : null;
    const mid = parseInt(marketId, 10);
    if (!Number.isInteger(mid) || mid <= 0) {
      return res.status(400).json({ error: 'invalid_market_id' });
    }
    const normalizedParallelLegs = normalizeParallelLegPatches(parallelLegs);
    if (normalizedParallelLegs.error) {
      return res.status(400).json({ error: normalizedParallelLegs.error });
    }
    const nextParallelLegs = normalizedParallelLegs.value;

    // Normalise the optional fields.
    let nextQuestion = null;
    if (typeof question === 'string') {
      const q = question.trim();
      if (q.length === 0) return res.status(400).json({ error: 'question_empty' });
      if (q.length > 500) return res.status(400).json({ error: 'question_too_long' });
      nextQuestion = q;
    }

    let nextStartTime = null;
    if (startTime !== undefined && startTime !== null && startTime !== '') {
      const parsed = new Date(startTime);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'invalid_start_time' });
      }
      nextStartTime = parsed.toISOString();
    }

    let nextEndTime = null;
    if (endTime !== undefined && endTime !== null && endTime !== '') {
      const parsed = new Date(endTime);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'invalid_end_time' });
      }
      nextEndTime = parsed.toISOString();
    }

    let nextCategory = null;
    if (typeof category === 'string' && category.length > 0) {
      if (!ALLOWED_CATEGORIES.has(category)) {
        return res.status(400).json({ error: 'invalid_category' });
      }
      nextCategory = category;
    }

    let nextMarketImageUrl = null;
    if (hasMarketImagePatch) {
      nextMarketImageUrl = cleanOptionalImageRef(rawMarketImageUrl);
      if (rawMarketImageUrl != null && String(rawMarketImageUrl).trim() && !nextMarketImageUrl) {
        return res.status(400).json({ error: 'invalid_market_image_url' });
      }
    }

    await ensurePointsSchema(sql);

    const existingRows = await sql`
      SELECT id, question, category, start_time, end_time, sport, league,
             outcomes, image_url, outcome_images,
             resolver_type, resolver_config, category_tags, geo_tags, topic_tags,
             status, amm_mode, parent_id, seed_liquidity
      FROM points_markets
      WHERE id = ${mid}
      LIMIT 1
    `;
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'market_not_found' });
    }
    const existing = existingRows[0];
    const existingOutcomes = parseJsonb(existing.outcomes, ['Sí', 'No']);
    const existingResolverConfig = parseJsonb(existing.resolver_config, null);
    let nextOutcomeImages = null;
    if (hasOutcomeImagesPatch) {
      if (!Array.isArray(rawOutcomeImages)) {
        return res.status(400).json({ error: 'invalid_outcome_images' });
      }
      if (rawOutcomeImages.length !== existingOutcomes.length) {
        return res.status(400).json({ error: 'outcome_images_length_mismatch' });
      }
      nextOutcomeImages = rawOutcomeImages.map(cleanOptionalImageRef);
    }
    const syncedMananera = syncMananeraPhraseFromQuestion({
      question: nextQuestion ?? existing.question,
      resolverConfig: existingResolverConfig,
    });
    const syncedApiPrice = syncApiPriceFromQuestion({
      question: nextQuestion ?? existing.question,
      resolverConfig: syncedMananera.resolverConfig,
    });
    const syncedWeather = syncWeatherDateFromMarket({
      question: nextQuestion ?? existing.question,
      endTime: nextEndTime ?? existing.end_time,
      resolverConfig: syncedApiPrice.resolverConfig,
    });
    const nextResolverConfig = syncedWeather.resolverConfig || null;
    const resolverConfigChanged = !sameJson(nextResolverConfig, existingResolverConfig);
    if (
      nextQuestion === null
      && nextStartTime === null
      && nextEndTime === null
      && nextCategory === null
      && !hasMarketImagePatch
      && !hasOutcomeImagesPatch
      && nextParallelLegs === null
      && !resolverConfigChanged
    ) {
      return res.status(400).json({ error: 'nothing_to_update' });
    }
    const effectiveStart = nextStartTime !== null
      ? new Date(nextStartTime)
      : (existing.start_time ? new Date(existing.start_time) : null);
    const effectiveEnd = nextEndTime !== null
      ? new Date(nextEndTime)
      : (existing.end_time ? new Date(existing.end_time) : null);
    if (effectiveStart && effectiveEnd && effectiveStart.getTime() >= effectiveEnd.getTime()) {
      return res.status(400).json({
        error: 'invalid_time_window',
        detail: 'start_time_must_be_before_end_time',
      });
    }

    // Apply to the target row. For parallel parents we also cascade
    // start/end time + category to every leg so admin changes ripple
    // through the whole group atomically.
    if (nextQuestion !== null || resolverConfigChanged) {
      await sql`
        UPDATE points_markets
        SET question = ${nextQuestion ?? existing.question},
            resolver_config = ${nextResolverConfig ? JSON.stringify(nextResolverConfig) : null}::jsonb
        WHERE id = ${mid}
      `;
    }
    if (nextStartTime !== null) {
      await sql`
        UPDATE points_markets
        SET start_time = ${nextStartTime}
        WHERE id = ${mid} OR parent_id = ${mid}
      `;
    }
    if (nextEndTime !== null) {
      await sql`
        UPDATE points_markets
        SET end_time = ${nextEndTime}
        WHERE id = ${mid} OR parent_id = ${mid}
      `;
    }
    if (nextCategory !== null) {
      await sql`
        UPDATE points_markets
        SET category = ${nextCategory}
        WHERE id = ${mid} OR parent_id = ${mid}
      `;
    }
    if (hasMarketImagePatch) {
      await sql`
        UPDATE points_markets
        SET image_url = ${nextMarketImageUrl}
        WHERE id = ${mid} OR parent_id = ${mid}
      `;
    }
    if (hasOutcomeImagesPatch) {
      await sql`
        UPDATE points_markets
        SET outcome_images = ${JSON.stringify(nextOutcomeImages)}::jsonb
        WHERE id = ${mid}
      `;
    }
    if (nextQuestion !== null || nextCategory !== null) {
      const tagBundle = deriveMarketTags({
        ...existing,
        question: nextQuestion ?? existing.question,
        category: nextCategory ?? existing.category,
        resolver_config: nextResolverConfig || {},
        category_tags: [],
        geo_tags: [],
        topic_tags: [],
      });
      await sql`
        UPDATE points_markets
        SET category_tags = ${JSON.stringify(tagBundle.categoryTags)}::jsonb,
            geo_tags = ${JSON.stringify(tagBundle.geoTags)}::jsonb,
            topic_tags = ${JSON.stringify(tagBundle.topicTags)}::jsonb
        WHERE id = ${mid} OR parent_id = ${mid}
      `;
    }

    if (nextParallelLegs !== null && nextParallelLegs.length > 0) {
      await withTransaction(async (client) => {
        const parentRes = await client.query(
          `SELECT id, status, amm_mode, parent_id
             FROM points_markets
            WHERE id = $1
            FOR UPDATE`,
          [mid],
        );
        if (parentRes.rows.length === 0) {
          const err = new Error('market_not_found'); err.status = 404; throw err;
        }
        const parent = parentRes.rows[0];
        if (parent.parent_id || parent.amm_mode !== 'parallel') {
          const err = new Error('not_parallel_parent'); err.status = 400; throw err;
        }
        if (parent.status !== 'active') {
          const err = new Error('parallel_parent_not_active'); err.status = 400; throw err;
        }

        const legRes = await client.query(
          `SELECT id, parent_id, status, leg_label, reserves
             FROM points_markets
            WHERE parent_id = $1
            FOR UPDATE`,
          [mid],
        );
        const legById = new Map(legRes.rows.map(row => [Number(row.id), row]));
        for (const patch of nextParallelLegs) {
          const leg = legById.get(patch.id);
          if (!leg) {
            const err = new Error('parallel_leg_not_found'); err.status = 404; throw err;
          }
          if (leg.status !== 'active') {
            const err = new Error('parallel_leg_not_active'); err.status = 400;
            err.detail = leg.leg_label || String(leg.id);
            throw err;
          }
        }

        const nextLegSeeds = new Map();
        for (const leg of legRes.rows) {
          const current = parseJsonb(leg.reserves, []).map(Number);
          nextLegSeeds.set(Number(leg.id), {
            yesReserve: Number(current[0] || 0),
            noReserve: Number(current[1] || 0),
          });
        }

        for (const patch of nextParallelLegs) {
          const reserves = [patch.yesReserve, patch.noReserve];
          const avgSeed = Math.round(((patch.yesReserve + patch.noReserve) / 2) * 1_000_000) / 1_000_000;
          await client.query(
            `UPDATE points_markets
                SET reserves = $1::jsonb,
                    seed_liquidities = $1::jsonb,
                    seed_liquidity = $2
              WHERE id = $3`,
            [JSON.stringify(reserves), avgSeed, patch.id],
          );
          nextLegSeeds.set(patch.id, {
            yesReserve: patch.yesReserve,
            noReserve: patch.noReserve,
          });
        }

        const parentSeedLiquidities = legRes.rows.map((leg) => {
          const next = nextLegSeeds.get(Number(leg.id));
          if (!next) return Number(leg.seed_liquidity || 0);
          return Math.round(((next.yesReserve + next.noReserve) / 2) * 1_000_000) / 1_000_000;
        });
        if (parentSeedLiquidities.length > 0) {
          await client.query(
            `UPDATE points_markets
                SET seed_liquidities = $1::jsonb,
                    seed_liquidity = $2
              WHERE id = $3`,
            [
              JSON.stringify(parentSeedLiquidities),
              Number(parentSeedLiquidities[0] || existing.seed_liquidity || 0),
              mid,
            ],
          );
        }
      });
    }

    const rows = await sql`
      SELECT id, question, category, image_url, start_time, end_time, status, outcome, outcomes, outcome_images, amm_mode
      FROM points_markets
      WHERE id = ${mid}
      LIMIT 1
    `;
    const r = rows[0];
    return res.status(200).json({
      ok: true,
      market: {
        id: r.id,
        question: r.question,
        category: r.category,
        imageUrl: r.image_url || null,
        startTime: r.start_time,
        endTime: r.end_time,
        status: r.status,
        outcome: r.outcome,
        outcomes: r.outcomes,
        outcomeImages: r.outcome_images,
        ammMode: r.amm_mode || 'unified',
      },
    });
  } catch (e) {
    console.error('[admin/edit-market] error', { message: e?.message, code: e?.code });
    if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 500) {
      return res.status(e.status).json({
        error: e.message || 'bad_request',
        detail: e.detail || null,
      });
    }
    return res.status(500).json({
      error: 'server_error',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
