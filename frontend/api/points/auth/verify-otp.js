/**
 * POST /api/points/auth/verify-otp
 * Body: { otpId, suborgId, code, publicKey, email }
 *
 * Step 2 of the email-OTP login flow:
 *   1. Submit the code to Turnkey → receive a verificationToken.
 *   2. Exchange the verificationToken (scoped to the sub-org) for a
 *      Turnkey session JWT bound to the client's ephemeral public key.
 *   3. Upsert a points_users row for the sub-org.
 *   4. Issue our own signed session cookie so subsequent /api/points/*
 *      calls don't need a Turnkey round-trip.
 *
 * Returns:
 *   { ok: true, needsUsername: boolean, session, suborgId, walletAddress? }
 *
 * If the user already has a username on file, `needsUsername` is false and
 * the client can immediately render the app. Otherwise the client shows
 * the username modal and then calls /api/points/auth/username.
 *
 * Error codes:
 *   invalid_input         — missing / malformed body
 *   invalid_code          — Turnkey rejected the code (wrong / expired)
 *   session_failed        — otpLogin call did not return a session
 *   turnkey_unavailable   — other Turnkey SDK error
 *   db_unavailable        — Postgres call failed
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { verifyOtp, otpLogin, getSuborgWalletAddress } from '../../_lib/turnkey.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { createSessionToken, setSessionCookie } from '../../_lib/session.js';
import { rateLimit, clientIp } from '../../_lib/rate-limit.js';

const sql = neon(process.env.DATABASE_URL);

const PUBKEY_RE = /^[0-9a-fA-F]{66}$/;            // 33-byte compressed P-256 pubkey
const OTP_RE    = /^[0-9]{4,12}$/;                 // numeric OTP
const UUID_RE   = /^[0-9a-fA-F-]{20,48}$/;         // Turnkey org / suborg UUID

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // Tighter limit than init-otp — a correct code arrives on the first or
  // second try. Ten attempts per minute still lets real users recover
  // from typos without letting bots brute-force.
  const limited = rateLimit(req, res, {
    key: `verify-otp:${clientIp(req)}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return;

  const { otpId, suborgId, code, publicKey, email } = req.body || {};
  if (
    typeof otpId !== 'string' || !otpId ||
    typeof suborgId !== 'string' || !UUID_RE.test(suborgId) ||
    typeof code !== 'string' || !OTP_RE.test(code) ||
    typeof publicKey !== 'string' || !PUBKEY_RE.test(publicKey) ||
    (email != null && typeof email !== 'string')
  ) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  let verificationToken;
  try {
    const r = await verifyOtp(otpId, code);
    verificationToken = r.verificationToken;
  } catch (e) {
    const msg = (e?.message || '').toLowerCase();
    // Turnkey returns 4xx for bad codes with a recognizable message.
    if (msg.includes('invalid') || msg.includes('not_found') || msg.includes('expired')) {
      return res.status(400).json({ error: 'invalid_code' });
    }
    console.error('[auth/verify-otp] verifyOtp error', { message: e?.message, code: e?.code });
    return res.status(502).json({ error: 'turnkey_unavailable' });
  }

  let session;
  try {
    const r = await otpLogin({ suborgId, verificationToken, publicKey });
    session = r.session;
  } catch (e) {
    console.error('[auth/verify-otp] otpLogin error', { message: e?.message, code: e?.code });
    return res.status(502).json({ error: 'session_failed' });
  }

  // At this point the OTP is verified and the user "owns" the sub-org.
  // Upsert a points_users row so downstream queries can join on it.
  let username = null;
  let walletAddress = null;
  try {
    await ensurePointsSchema(sql);

    // Pull the wallet address best-effort; don't block the login on it.
    walletAddress = await getSuborgWalletAddress(suborgId);

    const rows = await sql`
      INSERT INTO points_users (turnkey_sub_org_id, wallet_address, email)
      VALUES (${suborgId}, ${walletAddress}, ${email || null})
      ON CONFLICT (turnkey_sub_org_id) DO UPDATE
      SET wallet_address = COALESCE(points_users.wallet_address, EXCLUDED.wallet_address),
          email          = COALESCE(points_users.email, EXCLUDED.email)
      RETURNING username, wallet_address
    `;
    username = rows[0]?.username || null;
    walletAddress = rows[0]?.wallet_address || walletAddress;
  } catch (e) {
    console.error('[auth/verify-otp] db error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'db_unavailable' });
  }

  const token = createSessionToken({
    suborgId,
    email: email || null,
    username,
  });
  setSessionCookie(res, token);

  return res.status(200).json({
    ok: true,
    needsUsername: !username,
    suborgId,
    walletAddress,
    username,
    // We pass the Turnkey session JWT back to the client so it can store
    // the (privateKey, session) pair locally and optionally stamp its own
    // Turnkey calls later (e.g. if we ever add a real on-chain trade).
    session,
  });
}
