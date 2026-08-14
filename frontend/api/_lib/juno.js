import { createHmac, randomUUID } from 'node:crypto';

const DEFAULT_JUNO_BASE_URL = 'https://stage.buildwithjuno.com';

export function normalizeJunoBaseUrl(value = process.env.JUNO_API_BASE_URL) {
  const raw = String(value || '').trim();
  return (raw || DEFAULT_JUNO_BASE_URL).replace(/\/+$/, '');
}

export function isJunoConfigured(env = process.env) {
  return Boolean(
    env?.JUNO_API_KEY
    && env?.JUNO_API_SECRET
    && env?.JUNO_BEARER_TOKEN
    && env?.JUNO_API_BASE_URL,
  );
}

export function buildJunoAuthorizationHeader({
  apiKey,
  apiSecret,
  nonce = Date.now(),
  method = 'GET',
  path,
  payload = '',
}) {
  if (!apiKey || !apiSecret || !path) {
    throw new Error('juno_auth_params_required');
  }
  const verb = String(method || 'GET').toUpperCase();
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  const signature = createHmac('sha256', apiSecret)
    .update(`${nonce}${verb}${path}${body}`)
    .digest('hex');
  return `Bitso ${apiKey}:${nonce}:${signature}`;
}

export function buildJunoHeaders({
  apiKey,
  apiSecret,
  bearerToken,
  nonce = Date.now(),
  method = 'GET',
  path,
  payload = '',
  idempotencyKey,
}) {
  const headers = {
    Authorization: buildJunoAuthorizationHeader({
      apiKey,
      apiSecret,
      nonce,
      method,
      path,
      payload,
    }),
    BitsoAuth: `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  return headers;
}

export async function junoRequest({
  method = 'GET',
  path,
  body,
  idempotencyKey,
  env = process.env,
  fetchImpl = fetch,
}) {
  if (!isJunoConfigured(env)) {
    const err = new Error('juno_not_configured');
    err.status = 503;
    throw err;
  }
  const verb = String(method || 'GET').toUpperCase();
  const payload = body == null ? '' : JSON.stringify(body);
  const url = `${normalizeJunoBaseUrl(env.JUNO_API_BASE_URL)}${path}`;
  const res = await fetchImpl(url, {
    method: verb,
    headers: buildJunoHeaders({
      apiKey: env.JUNO_API_KEY,
      apiSecret: env.JUNO_API_SECRET,
      bearerToken: env.JUNO_BEARER_TOKEN,
      method: verb,
      path,
      payload,
      idempotencyKey,
    }),
    body: payload || undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `juno_http_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function pickFirstString(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function extractJunoClabe(response) {
  const data = response?.payload || response?.data || response;
  return pickFirstString(data, ['clabe', 'deposit_receiver_clabe', 'receiver_clabe', 'spei_clabe']);
}

export function extractJunoExternalId(response) {
  const data = response?.payload || response?.data || response;
  return pickFirstString(data, ['id', 'account_id', 'external_id', 'external_ref']);
}

export async function createJunoClabe({
  externalRef,
  walletAddress,
  env = process.env,
  fetchImpl = fetch,
}) {
  const path = env.JUNO_CLABE_PATH || '/mint_platform/v1/clabes';
  return junoRequest({
    method: 'POST',
    path,
    env,
    fetchImpl,
    idempotencyKey: `juno-clabe-${externalRef}`,
    body: {
      external_ref: externalRef,
      crypto_destination_address: walletAddress,
      network: env.JUNO_BLOCKCHAIN_NETWORK || 'ARBITRUM',
      asset: env.JUNO_BLOCKCHAIN_ASSET || 'MXNB',
    },
  });
}

export async function registerJunoBlockchainAccount({
  externalRef,
  walletAddress,
  env = process.env,
  fetchImpl = fetch,
}) {
  const path = env.JUNO_BLOCKCHAIN_ACCOUNT_PATH || '/mint_platform/v1/accounts/blockchain';
  return junoRequest({
    method: 'POST',
    path,
    env,
    fetchImpl,
    idempotencyKey: `juno-wallet-${externalRef}`,
    body: {
      external_ref: externalRef,
      address: walletAddress,
      network: env.JUNO_BLOCKCHAIN_NETWORK || 'ARBITRUM',
      asset: env.JUNO_BLOCKCHAIN_ASSET || 'MXNB',
    },
  });
}

export async function requestJunoWithdrawal({
  amount,
  walletAddress,
  clabe,
  externalRef = randomUUID(),
  env = process.env,
  fetchImpl = fetch,
}) {
  const path = env.JUNO_WITHDRAWAL_PATH || '/mint_platform/v1/withdrawals';
  return junoRequest({
    method: 'POST',
    path,
    env,
    fetchImpl,
    idempotencyKey: `juno-withdraw-${externalRef}`,
    body: {
      external_ref: externalRef,
      amount: String(amount),
      asset: env.JUNO_BLOCKCHAIN_ASSET || 'MXNB',
      network: env.JUNO_BLOCKCHAIN_NETWORK || 'ARBITRUM',
      address: walletAddress,
      clabe,
    },
  });
}
