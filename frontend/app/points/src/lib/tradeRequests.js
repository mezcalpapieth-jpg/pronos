const pendingError = (requestId, code = 'trade_request_pending') => Object.assign(new Error(code), { code, requestId });
const isTerminal = status => ['confirmed','indexed','reverted','rejected'].includes(status);
const storagePrefix = 'pronos:sepolia-trade:';

// Only intent IDs and accepted input are stored in the browser. Signed bytes
// stay on the server. Storage failure stops submission before any POST.
export function createTradeRequestClient({ get, post, storage = () => globalThis.localStorage,
  uuid = () => globalThis.crypto.randomUUID(), changed = () => {} }) {
  const running = new Map();
  const read = scope => {
    try { return JSON.parse(storage().getItem(storagePrefix + scope) || 'null'); }
    catch { throw pendingError(null, 'trade_recovery_unavailable'); }
  };
  function write(scope, value) {
    try {
      if (value) storage().setItem(storagePrefix + scope, JSON.stringify(value));
      else storage().removeItem(storagePrefix + scope);
    } catch { throw pendingError(value?.body?.requestId, 'trade_recovery_unavailable'); }
    changed();
  }
  async function identity() {
    const { scope } = await get('/api/protocol/trade-request?action=identity');
    if (!/^421614:0x[0-9a-f]{40}$/.test(scope || '')) throw pendingError(null, 'trade_recovery_unavailable');
    return scope;
  }
  async function status(entry) {
    try { return await get(`/api/protocol/trade-request?requestId=${encodeURIComponent(entry.body.requestId)}`); }
    catch (error) { if (error.status === 404) return null; throw error; }
  }
  async function recover(scope) {
    let entry = read(scope);
    if (!entry) {
      entry = (await get('/api/protocol/trade-request?action=pending')).request;
      if (entry) write(scope, entry);
    }
    return entry;
  }
  async function submit(scope, entry) {
    let state = await status(entry);
    if (state && isTerminal(state.status)) {
      write(scope, null);
      if (['confirmed','indexed'].includes(state.status)) return { ...state.result, requestId: state.requestId,
        status: state.status, indexingStatus: state.indexingStatus };
      throw Object.assign(new Error(state.error || 'tx_reverted'), { code: state.error || 'tx_reverted', requestId: state.requestId });
    }
    try {
      const result = await post(`/api/protocol/${entry.action}`, { ...entry.body, requestScope: scope });
      if (result.ok !== true || result.pending) throw pendingError(entry.body.requestId,
        result.error === 'trade_nonce_conflict' ? 'trade_needs_reconciliation' : 'trade_request_pending');
      write(scope, null);
      return result;
    } catch (error) {
      // Only a proven terminal server response may retire this request key.
      // Network/auth/server failures retain it, including a lost success reply.
      if (error.tradeStatus && ['reverted','rejected'].includes(error.tradeStatus)) write(scope, null);
      throw error;
    }
  }
  async function locked(scope, fingerprint, callback) {
    if (running.has(scope)) {
      const current = running.get(scope);
      if (current.fingerprint === fingerprint) return current.task;
      throw pendingError(null);
    }
    const task = globalThis.navigator?.locks?.request
      ? globalThis.navigator.locks.request(storagePrefix + scope, callback) : callback();
    running.set(scope, { task, fingerprint });
    try { return await task; } finally { running.delete(scope); }
  }
  return {
    async trade(action, body, { sourceMarketId, beforeTrade } = {}) {
      const scope = await identity();
      const fingerprint = JSON.stringify([action, Number(sourceMarketId), body.outcomeIndex, body.collateral, body.shares, body.amount]);
      return locked(scope, fingerprint, async () => {
        let entry = await recover(scope);
        if (entry) {
          // A fresh quote on a retry must not change already accepted bounds.
          if (entry.action !== action || entry.body.marketId !== body.marketId
            || ['outcomeIndex','collateral','shares','amount'].some(key => entry.body[key] !== body[key])) {
            throw pendingError(entry.body.requestId);
          }
        } else {
          await beforeTrade?.();
          entry = { action, sourceMarketId: Number(sourceMarketId), body: { ...body, requestId: body.requestId || uuid() } };
          write(scope, entry);
        }
        return submit(scope, entry);
      });
    },
    async pending() {
      const scope = await identity(), entry = await recover(scope);
      if (!entry) return null;
      const state = await status(entry);
      // Keep completed requests until acknowledged/resumed, so a refresh after
      // a lost success response cannot silently turn a retry into another buy.
      return { requestId: entry.body.requestId, action: entry.action, status: state?.status || 'created',
        indexingStatus: state?.indexingStatus || null };
    },
    async resume() {
      const scope = await identity();
      return locked(scope, 'resume', async () => {
        const entry = await recover(scope);
        return entry ? submit(scope, entry) : null;
      });
    },
  };
}
