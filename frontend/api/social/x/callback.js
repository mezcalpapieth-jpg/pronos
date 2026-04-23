/**
 * GET /api/social/x/callback?code=…&state=…
 *
 * X (Twitter) OAuth 2.0 callback. Exchanges the auth code for an
 * access token, fetches the user's verified profile, persists the
 * link, and credits the one-time MXNP reward. Finally 302s the user
 * back to /earn with a success/error flag.
 *
 * Security:
 *   - Signed cookie from /start carries state + verifier + username
 *   - We verify `state` matches the cookie, rejecting otherwise
 *   - PKCE verifier is sent to the token endpoint
 *   - points_social_links UNIQUE guards protect against double-link
 *     and cross-account farming
 *
 * Reward: 50 MXNP credited exactly once per (provider, user). Tracked
 * via points_social_links.reward_credited flag inside the same
 * transaction as the link insert, so there's no race.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { readOAuthCookie, clearOAuthCookie, resolveCallbackUrl, redirectToReturn } from '../../_lib/oauth.js';
import { withTransaction } from '../../_lib/db-tx.js';

const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const USER_URL  = 'https://api.twitter.com/2/users/me';
const REWARD_MXNP = 50;
const DISTRIBUTION_KIND = 'social_link_x';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const cookiePayload = readOAuthCookie(req, 'x');
  clearOAuthCookie(res, 'x');
  if (!cookiePayload) return bailOut(res, '/earn', 'x', 'cookie_missing');

  const { state: cookieState, verifier, username, returnTo } = cookiePayload;
  const { code, state, error } = req.query || {};

  if (error) return bailOut(res, returnTo, 'x', `provider_${String(error).slice(0, 40)}`);
  if (!code || !state) return bailOut(res, returnTo, 'x', 'missing_code_or_state');
  if (state !== cookieState) return bailOut(res, returnTo, 'x', 'state_mismatch');

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) return bailOut(res, returnTo, 'x', 'client_not_configured');

  let redirectUri;
  try { redirectUri = resolveCallbackUrl('x'); }
  catch { return bailOut(res, returnTo, 'x', 'callback_url_missing'); }

  // ── Step 1: exchange code for token ────────────────────────────
  let accessToken;
  try {
    const body = new URLSearchParams();
    body.set('code', String(code));
    body.set('grant_type', 'authorization_code');
    body.set('client_id', clientId);
    body.set('redirect_uri', redirectUri);
    body.set('code_verifier', verifier);
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('[social/x/callback] token exchange failed', { status: r.status, body: txt.slice(0, 240) });
      return bailOut(res, returnTo, 'x', 'token_exchange_failed');
    }
    const data = await r.json();
    accessToken = data.access_token;
    if (!accessToken) return bailOut(res, returnTo, 'x', 'no_access_token');
  } catch (e) {
    console.error('[social/x/callback] token fetch threw', { message: e?.message });
    return bailOut(res, returnTo, 'x', 'token_fetch_failed');
  }

  // ── Step 2: fetch verified profile ─────────────────────────────
  let profile;
  try {
    const r = await fetch(USER_URL, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('[social/x/callback] profile fetch failed', { status: r.status, body: txt.slice(0, 240) });
      return bailOut(res, returnTo, 'x', 'profile_fetch_failed');
    }
    const data = await r.json();
    const u = data?.data || {};
    if (!u.id || !u.username) return bailOut(res, returnTo, 'x', 'profile_shape_unexpected');
    profile = { id: String(u.id), username: String(u.username), name: u.name || null };
  } catch (e) {
    console.error('[social/x/callback] profile fetch threw', { message: e?.message });
    return bailOut(res, returnTo, 'x', 'profile_fetch_failed');
  }

  // ── Step 3: persist link + reward in one transaction ───────────
  try {
    await ensurePointsSchema(schemaSql);
    await withTransaction(async (client) => {
      // Insert the link; ON CONFLICT paths cover re-link attempts
      // (same user, same provider → refresh handle without re-crediting)
      // and reject cross-user hijacks (different user, same X account).
      const ins = await client.query(
        `INSERT INTO points_social_links
           (username, provider, provider_user_id, handle, profile_url)
         VALUES ($1, 'x', $2, $3, $4)
         ON CONFLICT (username, provider) DO UPDATE
           SET provider_user_id = EXCLUDED.provider_user_id,
               handle           = EXCLUDED.handle,
               profile_url      = EXCLUDED.profile_url,
               linked_at        = NOW()
         RETURNING id, reward_credited, (xmax = 0) AS inserted`,
        [
          username,
          profile.id,
          profile.username,
          `https://x.com/${profile.username}`,
        ],
      );
      const row = ins.rows[0];
      // Row-flag check covers repeat callbacks on the SAME link row.
      // The distributions-ledger check covers the unlink → relink
      // farming loop: a prior reward of this kind means we've paid
      // this user before, even if they deleted the link in between.
      let alreadyRewarded = row?.reward_credited === true;
      if (!alreadyRewarded) {
        const prior = await client.query(
          `SELECT 1 FROM points_distributions
           WHERE username = $1 AND kind = $2
           LIMIT 1`,
          [username, DISTRIBUTION_KIND],
        );
        alreadyRewarded = prior.rows.length > 0;
      }
      if (!alreadyRewarded) {
        // Flip the flag first so a retry can't double-credit even
        // if the balance update races somehow.
        await client.query(
          `UPDATE points_social_links SET reward_credited = true WHERE id = $1`,
          [row.id],
        );
        await client.query(
          `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [username, REWARD_MXNP, DISTRIBUTION_KIND, row.id, `Conectaste X @${profile.username}`],
        );
        await client.query(
          `INSERT INTO points_balances (username, balance) VALUES ($1, $2)
           ON CONFLICT (username) DO UPDATE
             SET balance = points_balances.balance + EXCLUDED.balance,
                 updated_at = NOW()`,
          [username, REWARD_MXNP],
        );
      }
    });
  } catch (e) {
    // Most common: UNIQUE (provider, provider_user_id) violation —
    // someone else already linked this X account to another Pronos user.
    if (e?.code === '23505') {
      return bailOut(res, returnTo, 'x', 'x_account_already_linked_elsewhere');
    }
    console.error('[social/x/callback] persist failed', { message: e?.message, code: e?.code });
    return bailOut(res, returnTo, 'x', 'persist_failed');
  }

  // ── Step 4 (TODO when Turnkey activity shape is confirmed): ───
  // Call Turnkey CREATE_USER_TAGS on the user's sub-org with the
  // value `social:x:<handle>:<provider_user_id>`. Best-effort; a
  // failure here shouldn't block the redirect back to /earn since
  // the Postgres state is already authoritative.

  return redirectToReturn(res, returnTo, 'linked', 'x');
}

function bailOut(res, returnTo, provider, code) {
  const base = returnTo || '/earn';
  const sep = base.includes('?') ? '&' : '?';
  const url = `${base}${sep}link_error=${encodeURIComponent(provider)}:${encodeURIComponent(code)}`;
  res.setHeader('Location', url);
  res.status(302).end();
}
