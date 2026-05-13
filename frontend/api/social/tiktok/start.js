/**
 * GET /api/social/tiktok/start[?returnTo=/earn]
 *
 * Kick off the TikTok Login Kit OAuth 2.0 flow with PKCE. Requires the
 * user to already be logged in to Pronos — the callback will link the
 * verified TikTok account to their session's `username`.
 *
 * Env vars required (sandbox names fall through to prod names when
 * promoted, so the same code runs in both environments):
 *   TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_KEY_SANDBOX
 *   TIKTOK_CLIENT_SECRET or TIKTOK_CLIENT_SECRET_SANDBOX   (used in callback, not here)
 *   OAUTH_TIKTOK_CALLBACK_URL    (optional — falls back to VERCEL_URL)
 *
 * Scopes requested:
 *   user.info.basic   — read open_id, union_id, display_name, avatar
 *   user.info.profile — read public username (the @handle we display)
 *
 * Note: TikTok calls the public client identifier `client_key`, not
 * `client_id` like the rest of the world. Same parameter name appears
 * in the token exchange.
 */

import { applyCors } from '../../_lib/cors.js';
import { requireSession } from '../../_lib/session.js';
import {
  generateState, generateCodeVerifier, codeChallenge,
  setOAuthCookie, resolveCallbackUrl, safeReturnPath,
} from '../../_lib/oauth.js';

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const SCOPES = ['user.info.basic', 'user.info.profile'];

export default function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_KEY_SANDBOX;
  if (!clientKey) {
    return res.status(503).json({
      error: 'tiktok_not_configured',
      detail: 'TIKTOK_CLIENT_KEY (or TIKTOK_CLIENT_KEY_SANDBOX) missing',
    });
  }

  const state = generateState();
  const verifier = generateCodeVerifier();
  const challenge = codeChallenge(verifier);
  // Restrict `returnTo` to a same-origin path. A naive startsWith('/')
  // check accepts `//attacker.com/path`, which browsers resolve to a
  // different origin and would turn this endpoint into an open-redirect
  // pivot for post-OAuth phishing.
  const returnTo = safeReturnPath(req.query.returnTo, '/earn');

  // Cookie carries what the callback needs to verify this flow.
  setOAuthCookie(res, 'tiktok', {
    state, verifier,
    username: session.username,
    returnTo,
    provider: 'tiktok',
  });

  let redirectUri;
  try {
    redirectUri = resolveCallbackUrl('tiktok');
  } catch (e) {
    return res.status(503).json({ error: 'callback_url_missing', detail: e.message });
  }

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_key', clientKey);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  res.setHeader('Location', url.toString());
  res.status(302).end();
}
