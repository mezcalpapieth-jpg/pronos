import { createTradeRequestClient } from '../../points/src/lib/tradeRequests.js';

// The MVP views also call the shared protocol endpoints. Preserve their REST
// result shape while opting into the same preview-only recovery protocol.
export function createProtocolPost({ fetch: fetcher = (...args) => globalThis.fetch(...args), storage, uuid } = {}) {
  let settings;
  async function raw(url, options = {}) {
    const response = await fetcher(url, { credentials: 'include', ...options });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }
  const checked = async (url, options) => {
    const result = await raw(url, options);
    if (!result.ok) throw Object.assign(new Error(result.data.error || 'trade_request_pending'), {
      code: result.data.error, status: result.status, tradeStatus: result.data.status });
    return result.data;
  };
  const postOptions = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const requests = createTradeRequestClient({ storage, uuid, get: url => checked(url),
    post: (url, body) => checked(url, postOptions(body)) });
  return async (url, body) => {
    const action = /^\/api\/protocol\/(buy|sell|redeem)$/.exec(url)?.[1];
    if (!action) return raw(url, postOptions(body));
    try {
      if (!settings) settings = checked('/api/points/onchain?action=config').catch(error => {
        if (error.status === 404) return { durableTrades: false };
        settings = null; throw error;
      });
      if (!(await settings).durableTrades) return raw(url, postOptions(body));
      const data = await requests.trade(action, body, { sourceMarketId: body.marketId });
      return { ok: true, status: 200, data };
    } catch (error) {
      return { ok: false, status: error.status || 202, data: { error: error.code || error.message } };
    }
  };
}
export const postProtocolJson = createProtocolPost();
