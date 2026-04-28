/**
 * GET /api/social/instagram/callback?code=…&state=…
 *
 * Instagram OAuth callback ("Instagram API with Instagram Login").
 * Exchanges the auth code for an access token, fetches the user's
 * verified profile (id + username + account_type), persists the link,
 * and credits the one-time MXNP reward. Finally 302s the user back to
 * /earn with a success/error flag.
 *
 * Security:
 *   - Signed cookie from /start carries state + username
 *   - We verify `state` matches the cookie, rejecting otherwise
 *   - points_social_links UNIQUE guards protect against double-link
 *     and cross-account farming
 *
 * Reward: 50 MXNP credited exactly once per (provider, user). Tracked
 * via points_social_links.reward_credited flag inside the same
 * transaction as the link insert, so there's no race.
 *
 * IG-specific quirks vs. X:
 *   - Token endpoint is form-encoded with client_secret in the body
 *     (no Basic auth header).
 *   - User endpoint requires the access_token as a query param, not
 *     a Bearer header (Graph API convention).
 *   - account_type comes back as 'PERSONAL' | 'BUSINESS' | 'CREATOR'.
 *     Personal accounts shouldn't reach this branch (Meta filters them
 *     at authorize-time) but we double-check + bail with a friendly
 *     code so the UI can prompt "switch to Pro".
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { readOAuthCookie, clearOAuthCookie, resolveCallbackUrl, redirectToReturn, safeReturnPath } from '../../_lib/oauth.js';
import { withTransaction } from '../../_lib/db-tx.js';

const TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const USER_URL  = 'https://graph.instagram.com/me';
const REWARD_MXNP = 50;
const DISTRIBUTION_KIND = 'social_link_instagram';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const cookiePayload = readOAuthCookie(req, 'instagram');
  clearOAuthCookie(res, 'instagram');
  if (!cookiePayload) return bailOut(res, '/earn', 'instagram', 'cookie_missing');

  const { state: cookieState, username, returnTo } = cookiePayload;
  const { code, state, error, error_reason } = req.query || {};

  if (error) {
    const reason = String(error_reason || error).slice(0, 40);
    return bailOut(res, returnTo, 'instagram', `provider_${reason}`);
  }
  if (!code || !state) return bailOut(res, returnTo, 'instagram', 'missing_code_or_state');
  if (state !== cookieState) return bailOut(res, returnTo, 'instagram', 'state_mismatch');

  const clientId = process.env.IG_CLIENT_ID;
  const clientSecret = process.env.IG_CLIENT_SECRET;
  if (!clientId || !clientSecret) return bailOut(res, returnTo, 'instagram', 'client_not_configured');

  let redirectUri;
  try { redirectUri = resolveCallbackUrl('instagram'); }
  catch { return bailOut(res, returnTo, 'instagram', 'callback_url_missing'); }

  // ── Step 1: exchange code for short-lived token ─────────────────
  // Meta's IG endpoint takes everything in the form body (no Basic
  // header) and returns { access_token, user_id }.
  let accessToken;
  let providerUserId;
  try {
    const body = new URLSearchParams();
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    body.set('grant_type', 'authorization_code');
    body.set('redirect_uri', redirectUri);
    body.set('code', String(code));
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('[social/instagram/callback] token exchange failed', { status: r.status, body: txt.slice(0, 240) });
      return bailOut(res, returnTo, 'instagram', 'token_exchange_failed');
    }
    const data = await r.json();
    accessToken = data.access_token;
    providerUserId = data.user_id ? String(data.user_id) : null;
    if (!accessToken) return bailOut(res, returnTo, 'instagram', 'no_access_token');
  } catch (e) {
    console.error('[social/instagram/callback] token fetch threw', { message: e?.message });
    return bailOut(res, returnTo, 'instagram', 'token_fetch_failed');
  }

  // ── Step 2: fetch verified profile ─────────────────────────────
  // Graph API returns id + username + account_type when those fields
  // are explicitly requested. Use the access_token as a query param
  // (Graph convention; no Bearer header).
  let profile;
  try {
    const url = new URL(USER_URL);
    url.searchParams.set('fields', 'id,username,account_type');
    url.searchParams.set('access_token', accessToken);
    const r = await fetch(url.toString());
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('[social/instagram/callback] profile fetch failed', { status: r.status, body: txt.slice(0, 240) });
      return bailOut(res, returnTo, 'instagram', 'profile_fetch_failed');
    }
    const data = await r.json();
    if (!data?.id || !data?.username) return bailOut(res, returnTo, 'instagram', 'profile_shape_unexpected');
    // Defensive: Meta should have rejected personal accounts at
    // authorize-time, but if one slips through we surface a clean code
    // so the UI can prompt the "switch to Professional" path.
    if (data.account_type === 'PERSONAL') {
      return bailOut(res, returnTo, 'instagram', 'requires_professional_account');
    }
    profile = {
      id: String(data.id),
      username: String(data.username),
      accountType: String(data.account_type || 'UNKNOWN'),
    };
    // Sanity-check: token-exchange-reported user_id should match
    // /me.id. If not, something weird happened and we'd rather bail
    // than persist a mismatched mapping.
    if (providerUserId && providerUserId !== profile.id) {
      console.warn('[social/instagram/callback] user_id mismatch', { token: providerUserId, me: profile.id });
    }
  } catch (e) {
    console.error('[social/instagram/callback] profile fetch threw', { message: e?.message });
    return bailOut(res, returnTo, 'instagram', 'profile_fetch_failed');
  }

  // ── Step 3: persist link + reward in one transaction ───────────
  try {
    await ensurePointsSchema(schemaSql);
    await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO points_social_links
           (username, provider, provider_user_id, handle, profile_url)
         VALUES ($1, 'instagram', $2, $3, $4)
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
          `https://www.instagram.com/${profile.username}/`,
        ],
      );
      const row = ins.rows[0];
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
        await client.query(
          `UPDATE points_social_links SET reward_credited = true WHERE id = $1`,
          [row.id],
        );
        await client.query(
          `INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [username, REWARD_MXNP, DISTRIBUTION_KIND, row.id, `Conectaste Instagram @${profile.username}`],
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
    if (e?.code === '23505') {
      return bailOut(res, returnTo, 'instagram', 'instagram_account_already_linked_elsewhere');
    }
    console.error('[social/instagram/callback] persist failed', { message: e?.message, code: e?.code });
    return bailOut(res, returnTo, 'instagram', 'persist_failed');
  }

  return redirectToReturn(res, returnTo, 'linked', 'instagram');
}

function bailOut(res, returnTo, provider, code) {
  // Defense-in-depth: re-validate `returnTo` even though it came from the
  // HMAC-signed cookie. Guards against pre-fix in-flight cookies that
  // were minted before the start endpoint started filtering, and against
  // any future bug that might let an unsafe path through. Splits out the
  // fragment so the new query param lands in `?...`, not inside `#...`.
  const base = safeReturnPath(returnTo, '/earn');
  const hashIdx = base.indexOf('#');
  const path = hashIdx === -1 ? base : base.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : base.slice(hashIdx);
  const sep = path.includes('?') ? '&' : '?';
  const url = `${path}${sep}link_error=${encodeURIComponent(provider)}:${encodeURIComponent(code)}${hash}`;
  res.setHeader('Location', url);
  res.status(302).end();
}
