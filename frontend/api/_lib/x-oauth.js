export const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
export const USER_URL = 'https://api.x.com/2/users/me';
export const X_API_BASE = 'https://api.x.com/2';
export const DEFAULT_X_FOLLOW_TARGET_USERNAME = 'pronos_io';

export function normalizeXUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

export function xBearerToken(env = process.env) {
  return String(env.X_BEARER_TOKEN || env.TWITTER_BEARER_TOKEN || '').trim();
}

export function xTokenHasScope(scope, requiredScope) {
  const required = String(requiredScope || '').trim().toLowerCase();
  if (!required) return false;
  return String(scope || '')
    .split(/\s+/)
    .map(s => s.trim().toLowerCase())
    .includes(required);
}

function xApiError(code, status = 503, detail = null) {
  const err = new Error(code);
  err.code = code;
  err.status = status;
  err.detail = detail;
  return err;
}

async function readXJson(response, fallbackCode) {
  const text = await response.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (response.ok) return data || {};
  const problemText = `${data?.detail || ''} ${data?.title || ''} ${data?.type || ''} ${text}`.toLowerCase();
  if (response.status === 402 || problemText.includes('credits depleted')) {
    throw xApiError('x_api_credits_depleted', 503, text.slice(0, 240));
  }
  if (response.status === 429) throw xApiError('x_rate_limited', 503, text.slice(0, 240));
  throw xApiError(fallbackCode, response.status >= 500 ? 503 : 502, text.slice(0, 240));
}

export async function resolveXUserId({
  username = DEFAULT_X_FOLLOW_TARGET_USERNAME,
  bearerToken = xBearerToken(),
  fetchImpl = fetch,
} = {}) {
  const handle = normalizeXUsername(username);
  if (!handle) throw xApiError('x_target_required', 400);
  if (!bearerToken) throw xApiError('x_not_configured', 503, 'X_BEARER_TOKEN missing');

  const url = new URL(`${X_API_BASE}/users/by/username/${encodeURIComponent(handle)}`);
  url.searchParams.set('user.fields', 'username');
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  const data = await readXJson(response, 'x_target_lookup_failed');
  const id = data?.data?.id;
  if (!id) throw xApiError('x_target_lookup_failed', 502, 'missing target user id');
  return String(id);
}

export async function xUserFollowsTarget({
  userId,
  username,
  targetUsername = DEFAULT_X_FOLLOW_TARGET_USERNAME,
  targetUserId = process.env.X_FOLLOW_TARGET_USER_ID || process.env.TWITTER_FOLLOW_TARGET_USER_ID || '',
  bearerToken = xBearerToken(),
  fetchImpl = fetch,
  maxPages = Number(process.env.X_FOLLOW_VERIFY_MAX_PAGES || 25),
} = {}) {
  const expectedId = String(userId || '').trim();
  const expectedUsername = normalizeXUsername(username);
  if (!expectedId && !expectedUsername) throw xApiError('x_account_required', 409);
  if (!bearerToken) throw xApiError('x_not_configured', 503, 'X_BEARER_TOKEN missing');

  const targetId = String(targetUserId || '').trim()
    || await resolveXUserId({ username: targetUsername, bearerToken, fetchImpl });
  const pageLimit = Number.isFinite(maxPages) && maxPages > 0 ? Math.floor(maxPages) : 25;
  let paginationToken = '';

  for (let page = 1; page <= pageLimit; page += 1) {
    const url = new URL(`${X_API_BASE}/users/${encodeURIComponent(targetId)}/followers`);
    url.searchParams.set('max_results', '1000');
    url.searchParams.set('user.fields', 'username');
    if (paginationToken) url.searchParams.set('pagination_token', paginationToken);

    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    const data = await readXJson(response, 'x_follow_lookup_failed');
    const followers = Array.isArray(data?.data) ? data.data : [];
    const found = followers.some(follower => {
      const idMatches = expectedId && String(follower?.id || '') === expectedId;
      const usernameMatches = expectedUsername && normalizeXUsername(follower?.username) === expectedUsername;
      return idMatches || usernameMatches;
    });

    if (found) {
      return { follows: true, checkedAll: true, targetUserId: targetId, pages: page };
    }

    paginationToken = String(data?.meta?.next_token || '');
    if (!paginationToken) {
      return { follows: false, checkedAll: true, targetUserId: targetId, pages: page };
    }
  }

  return { follows: false, checkedAll: false, targetUserId: targetId, pages: pageLimit };
}

export async function xUserFollowsTargetFromUserToken({
  userId,
  targetUsername = DEFAULT_X_FOLLOW_TARGET_USERNAME,
  targetUserId = process.env.X_FOLLOW_TARGET_USER_ID || process.env.TWITTER_FOLLOW_TARGET_USER_ID || '',
  accessToken,
  fetchImpl = fetch,
  maxPages = Number(process.env.X_FOLLOW_VERIFY_MAX_PAGES || 25),
} = {}) {
  const sourceId = String(userId || '').trim();
  const expectedTargetId = String(targetUserId || '').trim();
  const expectedTargetUsername = normalizeXUsername(targetUsername);
  if (!sourceId) throw xApiError('x_account_required', 409);
  if (!expectedTargetId && !expectedTargetUsername) throw xApiError('x_target_required', 400);
  if (!accessToken) throw xApiError('x_reconnect_required', 409, 'X OAuth token missing');

  const pageLimit = Number.isFinite(maxPages) && maxPages > 0 ? Math.floor(maxPages) : 25;
  let paginationToken = '';

  for (let page = 1; page <= pageLimit; page += 1) {
    const url = new URL(`${X_API_BASE}/users/${encodeURIComponent(sourceId)}/following`);
    url.searchParams.set('max_results', '1000');
    url.searchParams.set('user.fields', 'username');
    if (paginationToken) url.searchParams.set('pagination_token', paginationToken);

    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await readXJson(response, 'x_follow_lookup_failed');
    const following = Array.isArray(data?.data) ? data.data : [];
    const found = following.some(account => {
      const idMatches = expectedTargetId && String(account?.id || '') === expectedTargetId;
      const usernameMatches = expectedTargetUsername && normalizeXUsername(account?.username) === expectedTargetUsername;
      return idMatches || usernameMatches;
    });

    if (found) {
      return { follows: true, checkedAll: true, pages: page, method: 'user_following' };
    }

    paginationToken = String(data?.meta?.next_token || '');
    if (!paginationToken) {
      return { follows: false, checkedAll: true, pages: page, method: 'user_following' };
    }
  }

  return { follows: false, checkedAll: false, pages: pageLimit, method: 'user_following' };
}

export async function xFollowTargetWithUserToken({
  userId,
  targetUsername = DEFAULT_X_FOLLOW_TARGET_USERNAME,
  targetUserId = process.env.X_FOLLOW_TARGET_USER_ID || process.env.TWITTER_FOLLOW_TARGET_USER_ID || '',
  accessToken,
  fetchImpl = fetch,
} = {}) {
  const sourceId = String(userId || '').trim();
  if (!sourceId) throw xApiError('x_account_required', 409);
  if (!accessToken) throw xApiError('x_reconnect_required', 409, 'X OAuth token missing');

  const targetId = String(targetUserId || '').trim()
    || await resolveXUserId({ username: targetUsername, bearerToken: accessToken, fetchImpl });
  if (!targetId) throw xApiError('x_target_lookup_failed', 502, 'missing target user id');

  const response = await fetchImpl(`${X_API_BASE}/users/${encodeURIComponent(sourceId)}/following`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ target_user_id: targetId }),
  });
  const data = await readXJson(response, 'x_follow_write_failed');
  const followState = data?.data || {};
  if (followState.following === true || followState.pending_follow === true) {
    return {
      follows: true,
      checkedAll: true,
      targetUserId: targetId,
      method: 'follow_write',
      pendingFollow: followState.pending_follow === true,
    };
  }
  throw xApiError('x_follow_write_failed', 502, JSON.stringify(data || {}).slice(0, 240));
}

function tokenBody({ code, clientId, redirectUri, verifier, mode }) {
  const body = new URLSearchParams();
  body.set('code', String(code));
  body.set('grant_type', 'authorization_code');
  body.set('redirect_uri', redirectUri);
  body.set('code_verifier', verifier);
  if (mode === 'public') body.set('client_id', clientId);
  return body;
}

function tokenRequest({ code, clientId, clientSecret, redirectUri, verifier, mode }) {
  const body = tokenBody({ code, clientId, redirectUri, verifier, mode });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (mode === 'confidential') {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }
  return {
    mode,
    url: TOKEN_URL,
    body,
    init: {
      method: 'POST',
      headers,
      body: body.toString(),
    },
  };
}

export function buildXTokenRequestAttempts({ code, clientId, clientSecret, redirectUri, verifier }) {
  const common = { code, clientId, redirectUri, verifier };
  const attempts = [];
  if (clientSecret) {
    attempts.push(tokenRequest({ ...common, clientSecret, mode: 'confidential' }));
  }
  attempts.push(tokenRequest({ ...common, clientSecret: '', mode: 'public' }));
  return attempts;
}

function shouldTryNextAttempt(status, body) {
  if (status !== 401 && status !== 400) return false;
  const text = String(body || '').toLowerCase();
  return text.includes('unauthorized_client')
    || text.includes('invalid_client')
    || text.includes('authorization header');
}

export async function exchangeXAuthorizationCode({
  code,
  clientId,
  clientSecret = '',
  redirectUri,
  verifier,
  fetchImpl = fetch,
}) {
  const attempts = buildXTokenRequestAttempts({ code, clientId, clientSecret, redirectUri, verifier });
  let lastFailure = null;

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    const response = await fetchImpl(attempt.url, attempt.init);
    if (response.ok) {
      const data = await response.json();
      return {
        accessToken: data?.access_token || '',
        data,
        mode: attempt.mode,
      };
    }

    const body = await response.text().catch(() => '');
    lastFailure = { status: response.status, body, mode: attempt.mode };
    if (i < attempts.length - 1 && shouldTryNextAttempt(response.status, body)) {
      continue;
    }
    break;
  }

  const error = new Error('x_token_exchange_failed');
  error.status = lastFailure?.status || 0;
  error.body = lastFailure?.body || '';
  error.mode = lastFailure?.mode || null;
  throw error;
}
