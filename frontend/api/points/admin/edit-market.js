/**
 * POST /api/points/admin/edit-market
 * Body: { marketId, question?, endTime? }
 *
 * Admin-only. Updates the editable fields of a points market:
 *   - question: the user-facing title
 *   - end_time: the trading/resolution deadline (ISO-8601 string or
 *               epoch ms)
 *
 * Only non-null/undefined fields are applied. Other columns (reserves,
 * category, status, outcomes) are intentionally NOT editable through
 * this endpoint — mutating them post-creation would either desync the
 * AMM state or confuse existing holders.
 *
 * Returns: the updated market row so the admin UI can refresh without
 * a follow-up GET.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const session = requirePointsAdmin(req, res);
    if (!session) return; // 401/403 already sent

    const { marketId, question, endTime } = req.body || {};
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

    let nextEndTime = null;
    if (endTime !== undefined && endTime !== null && endTime !== '') {
      const parsed = new Date(endTime);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'invalid_end_time' });
      }
      nextEndTime = parsed.toISOString();
    }

    if (nextQuestion === null && nextEndTime === null) {
      return res.status(400).json({ error: 'nothing_to_update' });
    }

    await ensurePointsSchema(sql);

    // Two small UPDATEs are simpler than building a dynamic SET
    // clause and keep each statement shape constant for Neon HTTP.
    if (nextQuestion !== null) {
      await sql`
        UPDATE points_markets
        SET question = ${nextQuestion}
        WHERE id = ${mid}
      `;
    }
    if (nextEndTime !== null) {
      await sql`
        UPDATE points_markets
        SET end_time = ${nextEndTime}
        WHERE id = ${mid}
      `;
    }

    const rows = await sql`
      SELECT id, question, category, end_time, status, outcome, outcomes
      FROM points_markets
      WHERE id = ${mid}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'market_not_found' });
    }
    const r = rows[0];
    return res.status(200).json({
      ok: true,
      market: {
        id: r.id,
        question: r.question,
        category: r.category,
        endTime: r.end_time,
        status: r.status,
        outcome: r.outcome,
        outcomes: r.outcomes,
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
