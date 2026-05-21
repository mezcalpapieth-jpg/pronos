export const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
export const USER_URL = 'https://api.x.com/2/users/me';

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
