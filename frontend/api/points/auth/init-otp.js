/**
 * POST /api/points/auth/init-otp
 * Body: { email }
 *
 * Step 1 of the email-OTP login flow:
 *   1. Resolve or create a Turnkey sub-organization for this email.
 *   2. Send a 6-digit code to the email.
 *   3. Return { otpId, suborgId } so the client can pass both back on verify.
 *
 * This endpoint is unauthenticated — anyone can request a code for any
 * email. We rate-limit by IP to make mass-email harvesting expensive.
 *
 * Error codes (short strings, never raw DB / Turnkey payloads):
 *   invalid_email      — email doesn't parse
 *   turnkey_unavailable — SDK error; actual detail is server-logged
 *   rate_limited       — IP hit the request ceiling
 */

import { applyCors } from '../../_lib/cors.js';
import { getOrCreateSuborg, sendOtp } from '../../_lib/turnkey.js';
import { rateLimit, clientIp } from '../../_lib/rate-limit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // 3 OTP requests per minute per IP is plenty for a real user who mistyped
  // their email once or twice. Beyond that it's abuse.
  const limited = rateLimit(req, res, {
    key: `init-otp:${clientIp(req)}`,
    limit: 3,
    windowMs: 60_000,
  });
  if (limited) return;

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  try {
    const { suborgId } = await getOrCreateSuborg(email);
    const { otpId } = await sendOtp(email);
    return res.status(200).json({ otpId, suborgId });
  } catch (e) {
    console.error('[auth/init-otp] failed', { message: e?.message, code: e?.code });
    return res.status(502).json({ error: 'turnkey_unavailable' });
  }
}
