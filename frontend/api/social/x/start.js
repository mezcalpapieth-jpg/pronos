/**
 * GET /api/social/x/start[?returnTo=/earn]
 *
 * Kick off the X (Twitter) OAuth 2.0 flow with PKCE. Requires the user
 * to already be logged in to Pronos — the callback will link the
 * verified X account to their session's `username`.
 *
 * Env vars required:
 *   X_CLIENT_ID
 *   X_CLIENT_SECRET         (used in callback, not here)
 *   OAUTH_X_CALLBACK_URL    (optional — falls back to VERCEL_URL)
 *
 * Scopes requested:
 *   users.read      — read the linked user's @handle + id
 *   tweet.read      — (reserved for future "verify you posted" tasks)
 *   offline.access  — refresh token in case we need longer-term access
 */

import { applyCors } from '../../_lib/cors.js';
import { requireSession } from '../../_lib/session.js';
import {
  generateState, generateCodeVerifier, codeChallenge,
  setOAuthCookie, resolveCallbackUrl,
} from '../../_lib/oauth.js';

const AUTHORIZE_URL = 'https://twitter.com/i/oauth2/authorize';
const SCOPES = ['users.read', 'tweet.read', 'offline.access'];

export default function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const clientId = process.env.X_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'x_not_configured', detail: 'X_CLIENT_ID missing' });
  }

  const state = generateState();
  const verifier = generateCodeVerifier();
  const challenge = codeChallenge(verifier);
  const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.startsWith('/')
    ? req.query.returnTo
    : '/earn';

  // Cookie carries what the callback needs to verify this flow.
  setOAuthCookie(res, 'x', {
    state, verifier,
    username: session.username,
    returnTo,
    provider: 'x',
  });

  let redirectUri;
  try {
    redirectUri = resolveCallbackUrl('x');
  } catch (e) {
    return res.status(503).json({ error: 'callback_url_missing', detail: e.message });
  }

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  res.setHeader('Location', url.toString());
  res.status(302).end();
}
