/**
 * GET /api/social/instagram/start[?returnTo=/earn]
 *
 * Kick off the Instagram OAuth flow ("Instagram API with Instagram Login")
 * with PKCE. Requires the user to already be logged in to Pronos — the
 * callback will link the verified IG account to their session's `username`.
 *
 * Important: this product only works for Instagram **Professional**
 * accounts (Creator or Business). Personal IG accounts can't authorize
 * — Meta retired Instagram Basic Display in Dec 2024. The callback
 * surfaces a clean error code if the user tries with a personal account
 * so we can show a one-line "switch to Pro" hint in the UI.
 *
 * Env vars required:
 *   IG_CLIENT_ID
 *   IG_CLIENT_SECRET             (used in callback, not here)
 *   OAUTH_INSTAGRAM_CALLBACK_URL (optional — falls back to VERCEL_URL)
 *
 * Scopes requested:
 *   instagram_business_basic — read the linked user's @handle + id
 *
 * No PKCE here: Meta's IG OAuth doesn't support PKCE on the auth code
 * grant the same way X does — the client_secret on the token exchange
 * carries the security weight. We still mint a `state` cookie to
 * guard against CSRF; that part of the X scaffolding ports unchanged.
 */

import { applyCors } from '../../_lib/cors.js';
import { requireSession } from '../../_lib/session.js';
import {
  generateState,
  setOAuthCookie, resolveCallbackUrl, safeReturnPath,
} from '../../_lib/oauth.js';

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const SCOPES = ['instagram_business_basic'];

export default function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const clientId = process.env.IG_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'instagram_not_configured', detail: 'IG_CLIENT_ID missing' });
  }

  const state = generateState();
  // Restrict `returnTo` to a same-origin path. A naive startsWith('/')
  // check accepts `//attacker.com/path`, which browsers resolve to a
  // different origin and would turn this endpoint into an open-redirect
  // pivot for post-OAuth phishing.
  const returnTo = safeReturnPath(req.query.returnTo, '/earn');

  // Cookie carries what the callback needs to verify this flow.
  // No verifier — IG's OAuth doesn't take a code_verifier. Keep the
  // field present (empty string) so the cookie shape matches X for
  // any shared parsers.
  setOAuthCookie(res, 'instagram', {
    state,
    verifier: '',
    username: session.username,
    returnTo,
    provider: 'instagram',
  });

  let redirectUri;
  try {
    redirectUri = resolveCallbackUrl('instagram');
  } catch (e) {
    return res.status(503).json({ error: 'callback_url_missing', detail: e.message });
  }

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('state', state);

  res.setHeader('Location', url.toString());
  res.status(302).end();
}
