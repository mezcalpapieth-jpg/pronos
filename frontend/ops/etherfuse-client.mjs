/**
 * Server/operator-only Etherfuse v2 sandbox client.
 * Routes and response shapes: https://docs.etherfuse.com/v2/quickstart
 * Errors: RFC 9457 `type`, not the human-readable title/detail.
 * Success bodies are returned unchanged, including all decimal strings.
 */
export const ETHERFUSE_SANDBOX_ORIGIN = 'https://api.sand.etherfuse.com';
export const ETHERFUSE_REQUEST_TIMEOUT_MS = 10_000;
const PROBLEM_PREFIX = 'https://docs.etherfuse.com/ramp/v2/errors/';
const MAX_RESPONSE_CHARS = 1_048_576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EtherfuseSandboxError extends Error {
  constructor(code, { status = null, providerCode = null, problemType = null,
    instance = null, traceId = null, missing = [], required = [], pointers = [] } = {}) {
    // Deliberately exclude provider detail/title, requests, keys and fetch causes.
    super(`Etherfuse sandbox request failed: ${code}${status === null ? '' : ` (HTTP ${status})`}`);
    this.name = 'EtherfuseSandboxError';
    Object.assign(this, { code, status, httpStatus: status, providerCode, problemType,
      instance, traceId, missing, required, pointers });
  }
}

function id(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new EtherfuseSandboxError('invalid_id');
  }
  return value;
}

function objectBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new EtherfuseSandboxError('invalid_body');
  }
  return value;
}

function positiveDecimal(value) {
  if (typeof value !== 'string' || value.length > 100
    || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || !/[1-9]/.test(value)) {
    throw new EtherfuseSandboxError('invalid_decimal_amount');
  }
  return value;
}

function safePointers(values) {
  return Array.isArray(values)
    ? values.filter(value => typeof value === 'string' && value.length <= 256
      && /^#\/[A-Za-z0-9_~/-]+$/.test(value)).slice(0, 100)
    : [];
}

function providerError(status, body, headers) {
  const type = typeof body?.type === 'string' ? body.type : '';
  const slug = type.startsWith(PROBLEM_PREFIX) ? type.slice(PROBLEM_PREFIX.length) : '';
  const providerCode = /^[a-z][a-z0-9-]{0,79}$/.test(slug) ? slug : null;
  const candidateTrace = body?.traceId ?? headers?.get?.('X-Trace-Id');
  const traceId = typeof candidateTrace === 'string' && /^[0-9a-f]{32}$/i.test(candidateTrace)
    ? candidateTrace : null;
  const instance = typeof body?.instance === 'string' && body.instance.length <= 256
    && /^tag:etherfuse\.com,[A-Za-z0-9:/.\-_]+$/.test(body.instance) ? body.instance : null;
  return new EtherfuseSandboxError(providerCode ?? 'http_error', {
    status, providerCode, problemType: providerCode ? type : null, traceId, instance,
    missing: safePointers(body?.missing), required: safePointers(body?.required),
    pointers: safePointers(Array.isArray(body?.errors)
      ? body.errors.map(violation => violation?.pointer) : []),
  });
}

export function createEtherfuseSandboxClient({ apiKey, fetchImpl = fetch,
  timeoutMs = ETHERFUSE_REQUEST_TIMEOUT_MS } = {}) {
  // Never accept a configurable host or production key in this prototype.
  if (typeof apiKey !== 'string' || !/^api_sand_[A-Za-z0-9_-]+$/.test(apiKey)) {
    throw new EtherfuseSandboxError('sandbox_api_key_required');
  }
  if (typeof fetchImpl !== 'function') throw new EtherfuseSandboxError('invalid_fetch');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new EtherfuseSandboxError('invalid_timeout');
  }

  async function request(path, { method = 'GET', body, allowEmpty = false } = {}) {
    let serialized;
    try { serialized = body === undefined ? undefined : JSON.stringify(body); }
    catch { throw new EtherfuseSandboxError('invalid_body'); }
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new EtherfuseSandboxError('request_timeout'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetchImpl(`${ETHERFUSE_SANDBOX_ORIGIN}${path}`, {
          method,
          headers: { Authorization: apiKey, Accept: 'application/json',
            ...(serialized === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(serialized === undefined ? {} : { body: serialized }),
          redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        });
        if (response.redirected) throw new EtherfuseSandboxError('unexpected_redirect');
        const text = await response.text();
        if (text.length > MAX_RESPONSE_CHARS) throw new EtherfuseSandboxError('response_too_large');
        let parsed = null;
        if (text.trim()) {
          try { parsed = JSON.parse(text); }
          catch {
            if (response.ok) throw new EtherfuseSandboxError('invalid_json', { status: response.status });
          }
        }
        if (!response.ok) throw providerError(response.status, parsed, response.headers);
        if (!text.trim() && !allowEmpty) {
          throw new EtherfuseSandboxError('empty_response', { status: response.status });
        }
        return parsed;
      })()]);
    } catch (error) {
      if (error instanceof EtherfuseSandboxError) throw error;
      if (controller.signal.aborted) throw new EtherfuseSandboxError('request_timeout');
      throw new EtherfuseSandboxError('network_error');
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    // GET /me: { id, displayName, approvedAt, partnerFeeDefaultBps, ... }.
    org: () => request('/me'),
    // GET /supported_assets: { markets: [...], tokens: [...] }.
    // Select environment-specific token identifiers from tokens[].asset.
    assets: (orgId, accountId) => request(orgId === undefined && accountId === undefined ? '/supported_assets'
      : `/supported_assets?chain=monad&organizationId=${id(orgId)}&paymentAccountId=${id(accountId)}`),
    // Returns payment account { id, rails, ... }; readiness is per rail/direction.
    registerAccount: (orgId, body) => request(`/organization/${id(orgId)}/payment_account`, {
      method: 'POST', body: objectBody(body),
    }),
    account: (orgId, accountId) => request(`/organization/${id(orgId)}/payment_account/${id(accountId)}`),
    // Quote { quoteId, sourceAmount, destinationAmount, expiresAt, fees, ... }.
    quote: (orgId, body) => {
      objectBody(body);
      positiveDecimal(body.sourceAmount);
      return request(`/organization/${id(orgId)}/quote`, { method: 'POST', body });
    },
    // One order per quoteId: first 201, retry 200; concurrent request may be 409.
    // Returns full order { id, status, source, destination, fundingInstructions, ... }.
    createOrder: (orgId, quoteId) => request(`/organization/${id(orgId)}/order`, {
      method: 'POST', body: { quoteId: id(quoteId) },
    }),
    order: (orgId, orderId) => request(`/organization/${id(orgId)}/order/${id(orderId)}`),
    // Sandbox bank-source orders only. Documented 200 empty body becomes null.
    simulateDeposit: (orgId, orderId, amount) => request(
      `/organization/${id(orgId)}/order/${id(orderId)}/fiat_received`, {
        method: 'POST', body: { amount: positiveDecimal(amount) }, allowEmpty: true,
      }),
  });
}
