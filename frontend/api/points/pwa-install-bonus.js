/**
 * POST /api/points/pwa-install-bonus
 *
 * One-time retention reward for users who install/open the points app from
 * their phone home screen. This is intentionally points-only.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { withTransaction } from '../_lib/db-tx.js';

const schemaSql = neon(process.env.DATABASE_URL);
const BONUS_AMOUNT = 50;

function isMobileRequest(req) {
  const ua = String(req.headers['user-agent'] || '');
  const mobileHint = String(req.headers['sec-ch-ua-mobile'] || '');
  return mobileHint === '?1' || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

function clean(value, fallback = null, max = 80) {
  const s = String(value || '').trim();
  return s ? s.slice(0, max) : fallback;
}

function isStandalonePayload(body = {}) {
  return body?.standalone === true || body?.displayMode === 'standalone';
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `pwa-install-bonus:${clientIp(req)}`,
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  if (!isMobileRequest(req) || !isStandalonePayload(req.body)) {
    return res.status(400).json({ error: 'pwa_bonus_not_eligible' });
  }

  const username = session.username;
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
  const displayMode = clean(req.body?.displayMode, 'standalone');
  const platform = clean(req.body?.platform, 'mobile');

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO points_pwa_install_claims (username, amount, user_agent, display_mode, platform)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (username) DO NOTHING
         RETURNING amount, claimed_at`,
        [username, BONUS_AMOUNT, userAgent, displayMode, platform],
      );

      if (insertResult.rows.length === 0) {
        const existingResult = await client.query(
          `SELECT amount, claimed_at
           FROM points_pwa_install_claims
           WHERE username = $1`,
          [username],
        );
        const existing = existingResult.rows[0] || { amount: BONUS_AMOUNT, claimed_at: null };
        return {
          alreadyClaimed: true,
          claimed: true,
          amount: Number(existing.amount),
          claimedAt: existing.claimed_at,
        };
      }

      const balanceResult = await client.query(
        `SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE`,
        [username],
      );
      const currentBalance = balanceResult.rows.length > 0
        ? Number(balanceResult.rows[0].balance)
        : 0;
      const newBalance = currentBalance + BONUS_AMOUNT;

      if (balanceResult.rows.length === 0) {
        await client.query(
          `INSERT INTO points_balances (username, balance) VALUES ($1, $2)`,
          [username, newBalance],
        );
      } else {
        await client.query(
          `UPDATE points_balances SET balance = $1, updated_at = NOW() WHERE username = $2`,
          [newBalance, username],
        );
      }

      await client.query(
        `INSERT INTO points_distributions (username, amount, kind, reason)
         VALUES ($1, $2, 'pwa_install_bonus', $3)`,
        [username, BONUS_AMOUNT, 'Bono por instalar Pronos en pantalla de inicio'],
      );

      return {
        alreadyClaimed: false,
        claimed: true,
        amount: BONUS_AMOUNT,
        balance: newBalance,
        claimedAt: insertResult.rows[0]?.claimed_at || null,
      };
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[points/pwa-install-bonus] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'pwa_bonus_claim_failed' });
  }
}
