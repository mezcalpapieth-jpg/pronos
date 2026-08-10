/**
 * GET /api/points/u?username=<name>
 *
 * Public read-only profile for a single user. No auth required — the
 * data here is the same thing the leaderboard already surfaces, just
 * scoped to one user with a few extra fields (active positions, the
 * markets they've traded historically, aggregate PnL).
 *
 * This is intentionally distinct from /api/points/positions and
 * /api/points/history, which require a session and only return the
 * logged-in user's own data. The public endpoint:
 *   - takes ?username= from the query string,
 *   - returns NOTHING that a logged-in user's session response
 *     wouldn't already expose to the leaderboard (no email, wallet
 *     address, balance ledger, or anything sensitive),
 *   - 404s on unknown usernames so we don't leak existence by
 *     timing differences between unknown / empty users.
 *
 * Response:
 *   {
 *     user: { username, joinedAt, totalVolume, adminSocials? },
 *     stats: { totalPnl, marketsTraded, marketsWon, marketsOpen, winRate },
 *     active: [{ marketId, question, category, outcomeIndex, outcomeLabel,
 *                shares, costBasis, currentValue, unrealizedPnl, ... }],
 *     history: [{ marketId, question, category, outcomeStatus, netPnl,
 *                 trades: [...], resolvedAt, finalScore }]
 *   }
 *
 * Admin-only: when the viewer has a valid points admin session,
 * `user.adminSocials` includes that user's social-task proof rows and
 * `user.adminSocialLinks` includes connected account handles.
 * Logged-out / non-admin callers never receive it.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices, multiPrices } from '../_lib/amm-math.js';
import { readSession } from '../_lib/session.js';
import { isAdminUsername } from '../_lib/points-admin.js';
import {
  buildPublicProfileHistory,
  buildPublicProfileStats,
} from '../_lib/points-public-profile.js';
import {
  buildAdminProfileSocialLinks,
  buildAdminProfileSocials,
  buildPublicProfileSocialLinks,
} from '../_lib/points-profile-socials.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const socialSql = neon(process.env.DATABASE_URL || process.env.DATABASE_READ_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function labelFor(outcomes, i) {
  if (!Array.isArray(outcomes)) return '—';
  return outcomes[i] || `Opción ${i + 1}`;
}

function pricesFromReserves(reserves, outcomeCount) {
  if (!Array.isArray(reserves) || reserves.length === 0) {
    return Array.from({ length: outcomeCount || 2 }, () => 1 / (outcomeCount || 2));
  }
  if (reserves.length === 2) return binaryPrices(reserves);
  return multiPrices(reserves);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const raw = typeof req.query.username === 'string' ? req.query.username.trim() : '';
  if (!raw) return res.status(400).json({ error: 'username_required' });
  // Normalize the same way the username column is stored (lowercase).
  // Without this a search for "Mezcal" misses the row that's stored as
  // "mezcal", and the page shows "user not found" for a user who exists.
  const username = raw.toLowerCase().slice(0, 32);
  let viewerIsAdmin = false;
  try {
    const viewerSession = readSession(req, res);
    viewerIsAdmin = isAdminUsername(viewerSession?.username);
  } catch {
    viewerIsAdmin = false;
  }

  try {
    await ensurePointsSchema(schemaSql);

    // Confirm the user exists. Public surfaces can link usernames from
    // historical balances/trades/cycle snapshots even if a legacy user
    // does not have a points_users identity row, so resolve from the
    // full public points footprint and prefer points_users when present.
    const userRow = await sql`
      WITH candidates AS (
        SELECT LOWER(username) AS username, created_at, 0 AS priority
        FROM points_users
        WHERE username IS NOT NULL
          AND LOWER(username) = ${username}

        UNION ALL
        SELECT LOWER(username) AS username, updated_at AS created_at, 1 AS priority
        FROM points_balances
        WHERE username IS NOT NULL
          AND LOWER(username) = ${username}

        UNION ALL
        SELECT LOWER(username) AS username, MIN(created_at) AS created_at, 2 AS priority
        FROM points_trades
        WHERE username IS NOT NULL
          AND LOWER(username) = ${username}
        GROUP BY LOWER(username)

        UNION ALL
        SELECT LOWER(username) AS username, MIN(updated_at) AS created_at, 3 AS priority
        FROM points_positions
        WHERE username IS NOT NULL
          AND LOWER(username) = ${username}
        GROUP BY LOWER(username)

        UNION ALL
        SELECT LOWER(username) AS username, MIN(created_at) AS created_at, 4 AS priority
        FROM points_distributions
        WHERE username IS NOT NULL
          AND LOWER(username) = ${username}
        GROUP BY LOWER(username)

        UNION ALL
        SELECT LOWER(username) AS username, MIN(created_at) AS created_at, 5 AS priority
        FROM points_cycle_snapshots
        WHERE username IS NOT NULL
          AND LOWER(username) = ${username}
        GROUP BY LOWER(username)
      )
      SELECT username, created_at
      FROM candidates
      ORDER BY priority ASC, created_at ASC NULLS LAST
      LIMIT 1
    `;
    if (userRow.length === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // ── Active positions ──────────────────────────────────────────────
    // Mirrors /api/points/positions but auth-less. Only 'points' mode
    // (off-chain) — the on-chain MVP profile is a different beast.
    const positionRows = await sql`
      SELECT p.market_id, p.outcome_index, p.shares, p.cost_basis, p.realized_pnl,
             m.question, m.category, m.outcomes, m.reserves, m.status,
             m.outcome AS m_outcome, m.end_time, m.resolved_at,
             m.parent_id, m.leg_label,
             pm.question AS parent_question,
             pm.category AS parent_category
      FROM points_positions p
      JOIN points_markets m ON m.id = p.market_id
      LEFT JOIN points_markets pm ON pm.id = m.parent_id
      WHERE p.username = ${username}
        AND p.shares > 0
        AND COALESCE(m.mode, 'points') = 'points'
        AND m.status = 'active'
    `;

    const active = positionRows.map(r => {
      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      const reserves = parseJsonb(r.reserves, []).map(Number);
      const prices = pricesFromReserves(reserves, outcomes.length);
      const shares = Number(r.shares);
      const currentValue = shares * (prices[r.outcome_index] ?? 0);
      const costBasis = Number(r.cost_basis || 0);
      const unrealizedPnl = currentValue - costBasis;
      // Parallel-leg markets: surface the parent question so the row
      // reads as "¿Quién gana el grupo? — México" instead of the leg's
      // raw "Sí/No" question. leg_label is set on the points_markets
      // row when it's a leg of a parallel parent.
      const isLeg = !!r.parent_id;
      const displayQuestion = isLeg && r.parent_question
        ? `${r.parent_question}${r.leg_label ? ` — ${r.leg_label}` : ''}`
        : r.question;
      return {
        marketId: r.market_id,
        question: displayQuestion,
        category: r.parent_category || r.category,
        outcomeIndex: r.outcome_index,
        outcomeLabel: labelFor(outcomes, r.outcome_index),
        shares: round2(shares),
        costBasis: round2(costBasis),
        currentValue: round2(currentValue),
        unrealizedPnl: round2(unrealizedPnl),
        realizedPnl: round2(Number(r.realized_pnl || 0)),
        endTime: r.end_time,
      };
    });

    // ── History (settled + exited) ────────────────────────────────────
    // Per-market: roll up all of this user's trades on each market and
    // compute net PnL. Mirrors what /api/points/history does but
    // intentionally lighter — no per-trade list, just the summary
    // numbers the profile card needs.
    const tradeRows = await sql`
      SELECT t.market_id, t.side, t.outcome_index, t.shares, t.collateral,
             t.fee, t.price_at_trade, t.created_at,
             m.question, m.category, m.outcomes, m.status,
             m.outcome AS m_outcome, m.end_time, m.resolved_at, m.final_score,
             m.parent_id, m.leg_label, pm.question AS parent_question
      FROM points_trades t
      JOIN points_markets m ON m.id = t.market_id
      LEFT JOIN points_markets pm ON pm.id = m.parent_id
      WHERE t.username = ${username}
        AND COALESCE(m.mode, 'points') = 'points'
      ORDER BY t.created_at ASC
    `;

    const history = buildPublicProfileHistory(tradeRows);

    // ── Aggregate stats ───────────────────────────────────────────────
    const stats = buildPublicProfileStats(history);

    let publicSocialLinks = [];
    try {
      const publicSocialRows = await socialSql`
        SELECT provider, handle, profile_url, is_public, source, linked_at, updated_at
        FROM points_social_links
        WHERE LOWER(username) = LOWER(${username})
          AND is_public = true
        ORDER BY updated_at DESC, linked_at DESC
        LIMIT 10
      `;
      publicSocialLinks = buildPublicProfileSocialLinks(publicSocialRows);
    } catch (socialError) {
      console.error('[points/u] public_socials_failed', {
        message: socialError?.message,
        code: socialError?.code,
      });
      publicSocialLinks = [];
    }

    let adminSocials = null;
    let adminSocialLinks = null;
    if (viewerIsAdmin) {
      try {
        const socialRows = await sql`
          SELECT s.id, s.task_key, s.status, s.reward, s.proof_url,
                 s.reviewer, s.reviewed_at, s.rejection_note, s.created_at,
                 c.platform, c.target_url, c.label AS task_label
          FROM social_tasks s
          LEFT JOIN social_task_campaigns c ON c.task_key = s.task_key
          WHERE s.username = ${username}
          ORDER BY s.created_at DESC
          LIMIT 50
        `;
        adminSocials = buildAdminProfileSocials(socialRows);

        const socialLinkRows = await socialSql`
          SELECT provider, provider_user_id, handle, profile_url,
                 reward_credited, is_public, source, linked_at, updated_at
          FROM points_social_links
          WHERE LOWER(username) = LOWER(${username})
          ORDER BY updated_at DESC, linked_at DESC
          LIMIT 20
        `;
        adminSocialLinks = buildAdminProfileSocialLinks(socialLinkRows);
      } catch (socialError) {
        console.error('[points/u] admin_socials_failed', {
          message: socialError?.message,
          code: socialError?.code,
        });
        adminSocials = [];
        adminSocialLinks = [];
      }
    }

    return res.status(200).json({
      user: {
        username: userRow[0].username,
        joinedAt: userRow[0].created_at,
        totalVolume: stats.totalVolume,
        socialLinks: publicSocialLinks,
        ...(viewerIsAdmin ? { adminSocials, adminSocialLinks } : {}),
      },
      stats: {
        totalPnl: stats.totalPnl,
        marketsTraded: stats.marketsTraded,
        marketsWon: stats.marketsWon,
        marketsLost: stats.marketsLost,
        marketsOpen: stats.marketsOpen,
        winRate: stats.winRate, // null when nothing has settled
      },
      active,
      history,
    });
  } catch (e) {
    console.error('[points/u] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'profile_failed' });
  }
}
