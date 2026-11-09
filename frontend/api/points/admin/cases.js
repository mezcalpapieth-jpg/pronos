import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { pointsAdminUsernames, requirePointsAdmin } from '../../_lib/points-admin.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { readActiveCycleWindow, scoringStartIsoForWindow } from '../../_lib/points-cycle-window.js';
import { SHARE_EPSILON } from '../../_lib/points-redemption.js';
import { DISPLAYABLE_SHARE_EPSILON } from '../../_lib/points-position-visibility.js';

const sql = neon(process.env.DATABASE_URL);

function positiveId(value) {
  const id = Number(value);
  return /^[1-9]\d*$/.test(String(value)) && id <= 2147483647 ? id : null;
}

async function supportMarketContext(username, marketId) {
  const [market] = await sql`
    SELECT id, question, status, outcome
    FROM points_markets
    WHERE id = ${marketId} AND mode = 'points' AND parent_id IS NULL
  `;
  if (!market) return null;
  const scoringStart = scoringStartIsoForWindow(await readActiveCycleWindow(sql));
  const positions = await sql`
    SELECT m.id, p.outcome_index AS "outcomeIndex", m.leg_label AS "legLabel", m.outcomes->>p.outcome_index::int AS "positionLabel",
      p.shares::text, p.cost_basis::text AS "costBasis", p.dismissed_at AS "dismissedAt",
      m.status, m.outcome = p.outcome_index AS "isWinner", p.shares >= ${DISPLAYABLE_SHARE_EPSILON} AS "visibleShares",
      CASE WHEN m.status = 'resolved' AND m.outcome = p.outcome_index AND p.shares > ${SHARE_EPSILON}
        THEN LEAST(p.shares, GREATEST(0, (
          SELECT COALESCE(SUM(CASE WHEN t.side = 'buy' THEN t.shares ELSE -t.shares END), 0)
          FROM points_trades t WHERE t.market_id = p.market_id AND t.outcome_index = p.outcome_index
            AND LOWER(t.username) = LOWER(p.username) AND t.created_at >= ${scoringStart}::timestamptz
            AND t.side IN ('buy', 'sell', 'redeem')
        ))) > ${SHARE_EPSILON} ELSE false END AS "redeemable"
    FROM points_markets m
    JOIN points_positions p ON p.market_id = m.id AND p.username = ${username}
    WHERE (m.id = ${marketId} OR m.parent_id = ${marketId}) AND m.mode = 'points'
    ORDER BY m.id, p.outcome_index
  `;
  const [history] = await sql`
    SELECT COALESCE(SUM(t.collateral - COALESCE(r.amount, 0)), 0)::text AS "redeemedAmount",
      COUNT(*) FILTER (WHERE r.redeem_trade_id IS NULL)::int AS "redeemedCount",
      COUNT(r.redeem_trade_id)::int AS "reversedCount"
    FROM points_trades t
    JOIN points_markets m ON m.id = t.market_id
    LEFT JOIN points_redemption_reversals r ON r.redeem_trade_id = t.id
    WHERE (m.id = ${marketId} OR m.parent_id = ${marketId}) AND m.mode = 'points'
      AND t.username = ${username} AND t.side = 'redeem'
  `;
  const [refund] = await sql`
    SELECT COALESCE(SUM(d.amount), 0)::text AS "refundedAmount"
    FROM points_distributions d JOIN points_markets m ON m.id = d.reference_id
    WHERE (m.id = ${marketId} OR m.parent_id = ${marketId})
      AND m.mode = 'points' AND d.username = ${username} AND d.kind = 'market_cancel_refund'
  `;
  return { ...market, cycleAvailable: Boolean(scoringStart), positions, ...history, ...refund };
}

async function readCase(kind, subject, username, selectedMarketId) {
  const [record] = await sql`
    SELECT assigned_to AS "assignedTo", market_id AS "marketId"
    FROM points_admin_cases WHERE kind = ${kind} AND subject = ${subject}
  `;
  const notes = record ? await sql`
    SELECT id, author, body, created_at AS "createdAt"
    FROM points_admin_case_notes WHERE kind = ${kind} AND subject = ${subject}
    ORDER BY id DESC LIMIT 50
  ` : [];
  const result = { ...(record || {}), username, notes, admins: [...new Set(pointsAdminUsernames())] };
  if (kind !== 'support') return result;
  const marketId = selectedMarketId || record?.marketId;
  if (marketId) result.market = await supportMarketContext(username, marketId);
  else {
    result.recentMarkets = await sql`
      SELECT DISTINCT parent.id, parent.question, parent.status, parent.end_time AS "endTime"
      FROM (
        SELECT market_id FROM points_positions WHERE username = ${username}
        ORDER BY updated_at DESC LIMIT 40
      ) p
      JOIN points_markets leg ON leg.id = p.market_id
      JOIN points_markets parent ON parent.id = COALESCE(leg.parent_id, leg.id)
      WHERE parent.mode = 'points'
      ORDER BY "endTime" DESC LIMIT 8
    `;
  }
  return result;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;
  const admin = requirePointsAdmin(req, res);
  if (!admin) return;
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('Cache-Control', 'private, no-store');
  const { kind, subject: rawSubject, action, value, marketId } = (req.method === 'GET' ? req.query : req.body) || {};
  const subject = typeof rawSubject === 'string' ? rawSubject.trim().toLowerCase() : '';
  if (!(kind === 'support' ? positiveId(subject) : kind === 'risk' && subject.length > 0 && subject.length <= 64)) {
    return res.status(400).json({ error: 'invalid_case' });
  }
  if (marketId != null && (kind !== 'support' || !positiveId(marketId))) {
    return res.status(400).json({ error: 'invalid_market_id' });
  }
  try {
    await ensurePointsSchema(sql);
    const [owner] = kind === 'support'
      ? await sql`SELECT username FROM points_support_tickets WHERE id = ${Number(subject)}`
      : await sql`SELECT username FROM points_users WHERE LOWER(username) = ${subject} LIMIT 1`;
    if (!owner) return res.status(404).json({ error: 'case_not_found' });
    if (req.method === 'GET') return res.status(200).json(await readCase(kind, subject, owner.username, positiveId(marketId)));
    if (!['assign', 'note', 'link_market'].includes(action)) return res.status(400).json({ error: 'invalid_action' });
    const text = typeof value === 'string' ? value.trim() : '';
    if (action === 'assign' && value !== null && !pointsAdminUsernames().includes(text.toLowerCase())) {
      return res.status(400).json({ error: 'invalid_assignee' });
    }
    if (action === 'note' && (text.length < 2 || text.length > 4000)) {
      return res.status(400).json({ error: 'invalid_note' });
    }
    if (action === 'link_market' && (kind !== 'support' || (value !== null && !positiveId(value)))) {
      return res.status(400).json({ error: 'invalid_market_id' });
    }
    await withTransaction(async client => {
      await client.query(
        `INSERT INTO points_admin_cases(kind, subject) VALUES ($1,$2)
         ON CONFLICT (kind, subject) DO NOTHING`, [kind, subject],
      );
      if (action === 'assign') {
        await client.query(
          `UPDATE points_admin_cases SET assigned_to = $3, updated_at = NOW() WHERE kind = $1 AND subject = $2`,
          [kind, subject, value === null ? null : text.toLowerCase()],
        );
      }
      if (action === 'note') {
        await client.query(
          `INSERT INTO points_admin_case_notes(kind, subject, author, body) VALUES ($1,$2,$3,$4)`,
          [kind, subject, admin.username, text],
        );
      }
      if (action === 'link_market') {
        if (value !== null) {
          const market = await client.query(
            `SELECT id FROM points_markets WHERE id = $1 AND mode = 'points' AND parent_id IS NULL`, [positiveId(value)],
          );
          if (!market.rows.length) throw Object.assign(new Error('market_not_found'), { status: 404 });
        }
        await client.query(
          `UPDATE points_admin_cases SET market_id = $3, updated_at = NOW() WHERE kind = $1 AND subject = $2`,
          [kind, subject, positiveId(value)],
        );
      }
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message });
    console.error('[admin/cases] failed', { code: error?.code });
    return res.status(500).json({ error: 'case_unavailable' });
  }
}
