/**
 * GET /api/points/pwa-install-status
 *
 * Read-only status for the one-time mobile web-app install bonus.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';

const BONUS_AMOUNT = 50;

let _sql = null;
let _schemaSql = null;
function getSql() {
  if (_sql) return _sql;
  const cs = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _sql = neon(cs);
  return _sql;
}
function getSchemaSql() {
  if (_schemaSql) return _schemaSql;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _schemaSql = neon(cs);
  return _schemaSql;
}

function isMobileRequest(req) {
  const ua = String(req.headers['user-agent'] || '');
  const mobileHint = String(req.headers['sec-ch-ua-mobile'] || '');
  return mobileHint === '?1' || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  try {
    await ensurePointsSchema(getSchemaSql());
    const rows = await getSql()`
      SELECT amount, claimed_at
      FROM points_pwa_install_claims
      WHERE username = ${session.username}
      LIMIT 1
    `;
    const claim = rows[0] || null;
    return res.status(200).json({
      claimed: !!claim,
      amount: claim ? Number(claim.amount) : BONUS_AMOUNT,
      claimedAt: claim?.claimed_at || null,
      mobileEligible: isMobileRequest(req),
    });
  } catch (e) {
    console.error('[points/pwa-install-status] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'pwa_status_failed' });
  }
}
