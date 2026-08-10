/**
 * GET /api/social/tiktok/callback?code=…&state=…
 *
 * TikTok Login Kit OAuth 2.0 callback. Exchanges the auth code for an
 * access token, fetches the verified profile (open_id + username),
 * persists the link, credits the one-time MXNP reward, and 302s the
 * user back to /earn with a success/error flag.
 *
 * Mirrors /api/social/x/callback — same state-cookie verification,
 * same PKCE verifier flow, same one-time-reward bookkeeping inside a
 * single transaction. Two TikTok-specific quirks:
 *   - The token endpoint takes `client_key` + `client_secret` in the
 *     form body (NOT Basic Auth like X).
 *   - User info responses are wrapped in {data:{user:{…}}, error:{…}}.
 *     We use TikTok's `open_id` as `provider_user_id` since it's the
 *     stable identifier the docs guarantee won't change; `username`
 *     is the displayable @handle which a user CAN change.
 *
 * Reward: 50 MXNP, credited exactly once per (provider, user).
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { ensurePointsSocialLinksSchema } from '../../_lib/points-social-links-schema.js';
import {
  readOAuthCookie, clearOAuthCookie, resolveCallbackUrl,
  redirectToReturn, safeReturnPath,
} from '../../_lib/oauth.js';
import { withTransaction } from '../../_lib/db-tx.js';

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_URL  = 'https://open.tiktokapis.com/v2/user/info/';
const USER_FIELDS = ['open_id', 'union_id', 'display_name', 'username', 'avatar_url'];
const REWARD_MXNP = 50;
const DISTRIBUTION_KIND = 'social_link_tiktok';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const cookiePayload = readOAuthCookie(req, 'tiktok');
  clearOAuthCookie(res, 'tiktok');
  if (!cookiePayload) return bailOut(res, '/earn', 'tiktok', 'cookie_missing');

  const { state: cookieState, verifier, username, returnTo } = cookiePayload;
  const { code, state, error, error_description: errDesc } = req.query || {};

  if (error) {
    // TikTok sometimes returns error in the query string when the user
    // cancels or scope grant fails. Surface a trimmed code.
    const c = String(error).slice(0, 40);
    return bailOut(res, returnTo, 'tiktok', `provider_${c}`);
  }
  if (!code || !state) return bailOut(res, returnTo, 'tiktok', 'missing_code_or_state');
  if (state !== cookieState) return bailOut(res, returnTo, 'tiktok', 'state_mismatch');

  const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_KEY_SANDBOX;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || process.env.TIKTOK_CLIENT_SECRET_SANDBOX;
  if (!clientKey || !clientSecret) return bailOut(res, returnTo, 'tiktok', 'client_not_configured');

  let redirectUri;
  try { redirectUri = resolveCallbackUrl('tiktok'); }
  catch { return bailOut(res, returnTo, 'tiktok', 'callback_url_missing'); }

  // ── Step 1: exchange code for access token ─────────────────────
  // TikTok wants client_key + client_secret in the form body, NOT
  // Basic Auth. Cache-Control: no-store is documented as required so
  // intermediaries don't cache the bearer response.
  let accessToken;
  let openIdHint = null;
  try {
    const body = new URLSearchParams();
    body.set('client_key', clientKey);
    body.set('client_secret', clientSecret);
    body.set('code', String(code));
    body.set('grant_type', 'authorization_code');
    body.set('redirect_uri', redirectUri);
    body.set('code_verifier', verifier);
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-store',
      },
      body: body.toString(),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('[social/tiktok/callback] token exchange failed', { status: r.status, body: txt.slice(0, 240) });
      return bailOut(res, returnTo, 'tiktok', 'token_exchange_failed');
    }
    const data = await r.json();
    accessToken = data?.access_token;
    openIdHint = data?.open_id || null;
    if (!accessToken) {
      const code = data?.error || 'no_access_token';
      console.error('[social/tiktok/callback] no token in response', { code, desc: data?.error_description });
      return bailOut(res, returnTo, 'tiktok', `no_access_token_${String(code).slice(0, 30)}`);
    }
  } catch (e) {
    console.error('[social/tiktok/callback] token fetch threw', { message: e?.message });
    return bailOut(res, returnTo, 'tiktok', 'token_fetch_failed');
  }

  // ── Step 2: fetch verified profile ─────────────────────────────
  // /v2/user/info/ expects ?fields=<comma-separated> AND the bearer
  // token. Response: { data: { user: {open_id, username, …} }, error }.
  let profile;
  try {
    const url = new URL(USER_URL);
    url.searchParams.set('fields', USER_FIELDS.join(','));
    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('[social/tiktok/callback] profile fetch failed', { status: r.status, body: txt.slice(0, 240) });
      return bailOut(res, returnTo, 'tiktok', 'profile_fetch_failed');
    }
    const data = await r.json();
    const u = data?.data?.user || {};
    const openId = u.open_id || openIdHint;
    if (!openId) return bailOut(res, returnTo, 'tiktok', 'profile_shape_unexpected');
    // `username` is the public @handle, optional in early sandbox apps —
    // fall back to display_name so the row always has SOMETHING readable.
    profile = {
      id: String(openId),
      username: u.username ? String(u.username) : (u.display_name || 'usuario'),
      name: u.display_name || null,
      avatarUrl: u.avatar_url || null,
    };
  } catch (e) {
    console.error('[social/tiktok/callback] profile fetch threw', { message: e?.message });
    return bailOut(res, returnTo, 'tiktok', 'profile_fetch_failed');
  }

  // ── Step 3: persist link + reward in one transaction ───────────
  try {
    await ensurePointsSchema(schemaSql);
    await ensurePointsSocialLinksSchema(schemaSql);
    await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO points_social_links
           (username, provider, provider_user_id, handle, profile_url)
         VALUES ($1, 'tiktok', $2, $3, $4)
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
          // TikTok profile URLs always use the public username, not
          // open_id. We tolerate a missing username (fallback above) by
          // surfacing the bare domain when needed; that's better than
          // a 404 from an open_id-shaped URL.
          profile.username ? `https://www.tiktok.com/@${profile.username}` : 'https://www.tiktok.com',
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
          [username, REWARD_MXNP, DISTRIBUTION_KIND, row.id, `Conectaste TikTok @${profile.username}`],
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
      return bailOut(res, returnTo, 'tiktok', 'tiktok_account_already_linked_elsewhere');
    }
    console.error('[social/tiktok/callback] persist failed', { message: e?.message, code: e?.code });
    return bailOut(res, returnTo, 'tiktok', 'persist_failed');
  }

  return redirectToReturn(res, returnTo, 'linked', 'tiktok');
}

function bailOut(res, returnTo, provider, code) {
  // Defense-in-depth: re-validate `returnTo` even though it came from the
  // HMAC-signed cookie. Same pattern as the x/callback bailOut.
  const base = safeReturnPath(returnTo, '/earn');
  const hashIdx = base.indexOf('#');
  const path = hashIdx === -1 ? base : base.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : base.slice(hashIdx);
  const sep = path.includes('?') ? '&' : '?';
  const url = `${path}${sep}link_error=${encodeURIComponent(provider)}:${encodeURIComponent(code)}${hash}`;
  res.setHeader('Location', url);
  res.status(302).end();
}
