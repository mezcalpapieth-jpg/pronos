const fail = code => { throw Object.assign(new Error(code), { code }); };
const modes = new Set(['points', 'onchain']);

// Transport injection keeps routing/identity behavior testable without React or
// a wallet. A failed protocol request must never fall back to the Points ledger.
export function createExecutionAdapter({ get, post, beforeTrade }) {
  let configPromise;
  let mode = 'points';
  const identities = new Map(); // public metadata only; no wallet/account data
  const bridge = (action, params = {}) => get(`/api/points/onchain?${new URLSearchParams({ action, ...params })}`);
  async function config() {
    if (!configPromise) configPromise = bridge('config').then(result => {
      if (result.enabled && Number(result.chainId) !== 421614) fail('unsupported_market_mode');
      mode = result.enabled ? 'onchain' : 'points';
      return result;
    }).catch(error => {
      configPromise = null;
      // Older demo backends have no adapter route. A network/auth/server error
      // is not evidence that execution should silently change ledgers.
      if (error.status === 404) {
        configPromise = Promise.resolve({ enabled: false, chainId: null });
        return configPromise;
      }
      throw error;
    });
    return configPromise;
  }
  async function setMode(next) {
    if (!modes.has(next)) fail('unsupported_market_mode');
    if (next === 'onchain' && !(await config()).enabled) fail('onchain_preview_disabled');
    mode = next;
  }
  function remember(market) {
    if (!market) return;
    identities.set(Number(market.id), market);
    for (const leg of market.legs || []) identities.set(Number(leg.id), { ...leg, mode: market.mode || 'points' });
    // Points parallel legs do not have a public detail route.
    if ((market.mode || 'points') === 'points') for (const id of market.legIds || []) identities.set(Number(id), { id, mode: 'points' });
  }
  async function mapped(ids) {
    const { markets = [] } = await bridge('markets', { ids: ids.join(',') });
    for (const market of markets) identities.set(Number(market.id), market);
    return markets;
  }
  function decorate(market, mappings) {
    if ((market.mode || 'points') !== 'onchain') { remember(market); return market; }
    if (market.ammMode === 'parallel') {
      const byId = new Map(mappings.map(m => [Number(m.id), m]));
      const legIds = market.legIds || market.legs?.map(l => l.id) || [];
      const legs = legIds.map(id => ({ ...(market.legs || []).find(l => Number(l.id) === Number(id)), ...byId.get(Number(id)) }));
      const ready = legs.length === market.outcomes?.length && legs.every(l => l.executionReady);
      const result = { ...market, legs, legIds, prices: ready ? legs.map(l => l.prices[0]) : [],
        executionReady: ready, legStatuses: legs.map(l => l.status), legOutcomes: legs.map(l => l.outcome) };
      remember(result);
      return result;
    }
    const mapping = mappings.find(m => Number(m.id) === Number(market.id));
    const result = { ...market, ...mapping, executionReady: Boolean(mapping?.executionReady),
      prices: mapping?.prices || [], mode: 'onchain' };
    remember(result);
    return result;
  }
  async function markets(options = {}) {
    const settings = await config();
    const scope = options.mode || mode;
    if (!modes.has(scope)) fail('unsupported_market_mode');
    if (scope === 'onchain' && !settings.enabled) fail('onchain_preview_disabled');
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...options, mode: scope, ...(scope === 'onchain' ? { chain_id: settings.chainId } : {}) })) {
      if (value != null && value !== '') q.set(key, String(value));
    }
    const { markets: rows = [] } = await get(`/api/points/markets?${q}`);
    if (scope === 'points') { rows.forEach(remember); return rows; }
    const mappings = [];
    for (let i = 0; i < rows.length; i += 200) mappings.push(...await mapped(rows.slice(i, i + 200).map(m => m.id)));
    return rows.map(m => decorate(m, mappings));
  }
  async function market(id) {
    const { market: row, legs } = await get(`/api/points/market?id=${encodeURIComponent(id)}`);
    if (!row) return row;
    const base = Array.isArray(legs) ? { ...row, legs } : row;
    if ((row.mode || 'points') === 'points') { remember(base); return base; }
    if (row.mode !== 'onchain') fail('unsupported_market_mode');
    if (!(await config()).enabled) return { ...base, prices: [], executionReady: false };
    return decorate(base, await mapped([id]));
  }
  async function identity(id, supplied) {
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) fail('invalid_market');
    const settings = await config();
    let row = identities.get(Number(id));
    // Resolve chain targets afresh so a parent/contract/database ID passed by
    // the caller can never substitute for the pool mapping owned by the server.
    if (settings.enabled && (!row || row.mode === 'onchain' || supplied?.mode === 'onchain')) {
      row = (await mapped([id])).find(m => Number(m.id) === Number(id));
    }
    if (!row) row = await market(id);
    const rowMode = row?.mode || 'points';
    if (!modes.has(rowMode)) fail('unsupported_market_mode');
    if (supplied?.mode && supplied.mode !== rowMode) fail('onchain_mapping_changed');
    if (rowMode === 'onchain') {
      if (!settings.enabled) fail('onchain_preview_disabled');
      if (!row.executionReady || !row.protocolMarketId || Number(row.chainId) !== Number(settings.chainId)) fail('onchain_index_pending');
    }
    return row;
  }
  async function trade(action, args) {
    const id = args.marketId ?? args.market?.id;
    const target = await identity(id, args.market);
    const body = { ...args, marketId: target.mode === 'onchain' ? target.protocolMarketId : Number(id) };
    delete body.market;
    if (action === 'redeem' && target.mode === 'onchain') {
      if (!(Number(body.amount) > 0)) fail('invalid_amount');
      delete body.outcomeIndex;
    }
    if (target.mode === 'onchain' && ['buy', 'sell', 'redeem'].includes(action)) await beforeTrade?.(target);
    return post(`/api/${target.mode === 'onchain' ? 'protocol' : 'points'}/${action}`, body);
  }
  async function publicRead(action, ids, options, legacy) {
    const settings = await config();
    if (!settings.enabled) return legacy(ids, options);
    const rows = await mapped(ids);
    const chainIds = ids.filter(id => rows.find(m => Number(m.id) === Number(id))?.mode === 'onchain');
    const pointIds = ids.filter(id => rows.find(m => Number(m.id) === Number(id))?.mode === 'points');
    const key = { prices: 'history', activity: 'activity', tape: 'tape' }[action];
    const [pointData, chainData] = await Promise.all([
      pointIds.length ? legacy(pointIds, options) : {},
      chainIds.length ? bridge(action, { ids: chainIds.join(','), ...options }).then(r => r[key] || {}) : {},
    ]);
    return { ...pointData, ...chainData };
  }
  async function portfolio(scope) {
    await config();
    const selected = scope || mode;
    if (!modes.has(selected)) fail('unsupported_market_mode');
    if (selected === 'onchain') {
      if (!(await config()).enabled) fail('onchain_preview_disabled');
      return bridge('portfolio');
    }
    return null;
  }
  return { config, setMode, getMode: () => mode, markets, market, trade, publicRead, portfolio, remember,
    balance: () => bridge('balance'),
  };
}
