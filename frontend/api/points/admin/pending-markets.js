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

  const rows = status === 'all'
    ? await readSql`
        SELECT * FROM points_pending_markets
        ORDER BY created_at DESC
        LIMIT 200
      `
    : await readSql`
        SELECT * FROM points_pending_markets
        WHERE status = ${status}
        ORDER BY
          CASE status WHEN 'pending' THEN 0 ELSE 1 END,
          end_time ASC NULLS LAST,
          created_at DESC
        LIMIT 200
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
    })),
  });
}

async function review(req, res, admin) {
  const { id, action, note } = req.body || {};
  const pid = parseInt(id, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: 'invalid_action' });
  }

  await ensurePointsSchema(schemaSql);

  const result = await withTransaction(async (client) => {
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

    if (action === 'reject') {
      await client.query(
        `UPDATE points_pending_markets
           SET status = 'rejected', admin_note = $1, reviewer = $2, reviewed_at = NOW()
         WHERE id = $3`,
        [note || null, admin.username, pid],
      );
      return { ok: true, action: 'reject', id: pid };
    }

    // Approve → copy into points_markets. Mirrors the unified path in
    // admin/create-market.js so we keep validation consistent. Only the
    // unified mode is generated today (soccer 3-way); parallel gets
    // wired when the next generator needs it (F1 etc).
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

    if (ammMode === 'unified') {
      const reserves = initialReserves(seed, outcomes.length);
      const mk = await client.query(
        `INSERT INTO points_markets
           (question, category, icon, outcomes, reserves, seed_liquidity,
            end_time, status, created_by, amm_mode, resolver_type, resolver_config)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, 'active', $8,
                 'unified', $9, $10::jsonb)
         RETURNING id`,
        [
          r.question,
          r.category,
          r.icon || null,
          JSON.stringify(outcomes),
          JSON.stringify(reserves),
          seed,
          endDate.toISOString(),
          admin.username,
          r.resolver_type || null,
          r.resolver_config ? JSON.stringify(r.resolver_config) : null,
        ],
      );
      createdMarketId = mk.rows[0].id;
    } else {
      // Parallel — parent + N legs. Kept out of the initial soccer path
      // but supported here so future generators (F1, golf) work too.
      const legReserves = initialReserves(seed, 2);
      const parent = await client.query(
        `INSERT INTO points_markets
           (question, category, icon, outcomes, reserves, seed_liquidity,
            end_time, status, created_by, amm_mode, resolver_type, resolver_config)
         VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, $5, $6, 'active', $7,
                 'parallel', $8, $9::jsonb)
         RETURNING id`,
        [
          r.question,
          r.category,
          r.icon || null,
          JSON.stringify(outcomes),
          seed,
          endDate.toISOString(),
          admin.username,
          r.resolver_type || null,
          r.resolver_config ? JSON.stringify(r.resolver_config) : null,
        ],
      );
      createdMarketId = parent.rows[0].id;
      for (let i = 0; i < outcomes.length; i++) {
        await client.query(
          `INSERT INTO points_markets
             (question, category, icon, outcomes, reserves, seed_liquidity,
              end_time, status, created_by, amm_mode, parent_id, leg_label)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, 'active', $8,
                   'parallel', $9, $10)`,
          [
            `${r.question} — ${outcomes[i]}`,
            r.category,
            r.icon || null,
            JSON.stringify(['Sí', 'No']),
            JSON.stringify(legReserves),
            seed,
            endDate.toISOString(),
            admin.username,
            createdMarketId,
            outcomes[i],
          ],
        );
      }
    }

    await client.query(
      `UPDATE points_pending_markets
         SET status = 'approved', admin_note = $1, reviewer = $2,
             reviewed_at = NOW(), approved_market_id = $3
       WHERE id = $4`,
      [note || null, admin.username, createdMarketId, pid],
    );
    return { ok: true, action: 'approve', id: pid, marketId: createdMarketId };
  });

  return res.status(200).json(result);
}
