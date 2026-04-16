/**
 * GET /api/points/referrals/stats
 *
 * Returns the caller's referral stats for their EarnMXNP dashboard:
 *   - count: how many people signed up with their code
 *   - totalEarned: MXNP rewarded to the caller from referrals
 *   - recent: last 10 referrals (anonymized to first 3 chars + ****)
 *
 * Also returns the caller's own referral link so the UI can render it
 * as copy + share buttons.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { readSession } from '../../_lib/session.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = readSession(req, res);
  if (!session || !session.username) {
    return res.status(200).json({ authenticated: false });
  }
  const username = session.username.toLowerCase();

  try {
    await ensurePointsSchema(schemaSql);

    const [countRows, earnedRows, recentRows] = await Promise.all([
      sql`
        SELECT COUNT(*)::int AS total
        FROM points_referrals
        WHERE referrer = ${username}
      `,
      sql`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM points_distributions
        WHERE username = ${username} AND kind = 'referral_bonus'
      `,
      sql`
        SELECT referred, created_at, rewarded
        FROM points_referrals
        WHERE referrer = ${username}
        ORDER BY created_at DESC
        LIMIT 10
      `,
    ]);

    const host = req.headers['x-forwarded-host'] || req.headers.host || 'pronos.io';
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const link = `${protocol}://${host}/r/${username}`;

    return res.status(200).json({
      authenticated: true,
      username,
      link,
      count: countRows[0]?.total || 0,
      totalEarned: Number(earnedRows[0]?.total || 0),
      recent: recentRows.map(r => ({
        // Mask referred usernames to respect privacy — first 3 chars + ****
        referredMasked: maskUsername(r.referred),
        createdAt: r.created_at,
        rewarded: r.rewarded,
      })),
    });
  } catch (e) {
    console.error('[referrals/stats] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'stats_failed' });
  }
}

function maskUsername(u) {
  if (!u) return '***';
  if (u.length <= 3) return u[0] + '**';
  return u.slice(0, 3) + '*'.repeat(Math.max(2, u.length - 3));
}
