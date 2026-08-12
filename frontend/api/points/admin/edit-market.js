/**
 * POST /api/points/admin/edit-market
 * Body: { marketId, question?, startTime?, endTime?, category? }
 *
 * Admin-only. Updates the editable fields of a points market:
 *   - question: the user-facing title
 *   - start_time: when the market should open for trading
 *   - end_time: the trading/resolution deadline (ISO-8601 string or
 *               epoch ms)
 *   - category: display bucket (deportes, politica, etc.)
 *
 * Only non-null/undefined fields are applied. Reserves, outcomes, and
 * status are intentionally NOT editable through this endpoint — mutating
 * them post-creation would either desync the AMM state or confuse
 * existing holders.
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

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const session = requirePointsAdmin(req, res);
    if (!session) return; // 401/403 already sent

    const { marketId, question, startTime, endTime, category } = req.body || {};
    const mid = parseInt(marketId, 10);
    if (!Number.isInteger(mid) || mid <= 0) {
      return res.status(400).json({ error: 'invalid_market_id' });
    }

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

    await ensurePointsSchema(sql);

    const existingRows = await sql`
      SELECT id, question, category, start_time, end_time, sport, league,
             resolver_type, resolver_config, category_tags, geo_tags, topic_tags
      FROM points_markets
      WHERE id = ${mid}
      LIMIT 1
    `;
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'market_not_found' });
    }
    const existing = existingRows[0];
    const syncedMananera = syncMananeraPhraseFromQuestion({
      question: nextQuestion ?? existing.question,
      resolverConfig: parseJsonb(existing.resolver_config, null),
    });
    const nextResolverConfig = syncedMananera.resolverConfig || null;
    const resolverConfigChanged = syncedMananera.changed === true;
    if (
      nextQuestion === null
      && nextStartTime === null
      && nextEndTime === null
      && nextCategory === null
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

    const rows = await sql`
      SELECT id, question, category, start_time, end_time, status, outcome, outcomes, amm_mode
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
        startTime: r.start_time,
        endTime: r.end_time,
        status: r.status,
        outcome: r.outcome,
        outcomes: r.outcomes,
        ammMode: r.amm_mode || 'unified',
      },
    });
  } catch (e) {
    console.error('[admin/edit-market] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'server_error',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
