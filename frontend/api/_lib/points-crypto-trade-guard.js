function parseJsonb(value, fallback = null) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function cryptoMarketConfig(market = {}) {
  return parseJsonb(market.resolver_config, null);
}

export function isCrypto5MinMarket(market = {}) {
  const cfg = cryptoMarketConfig(market);
  if (!cfg || typeof cfg !== 'object') return false;
  return cfg.shape === 'binary-direction'
    && (
      cfg.source === 'chainlink'
      || Boolean(cfg.feedAddress)
      || Boolean(cfg.asset)
      || Boolean(cfg.productId)
      || Boolean(cfg.coinbaseProductId)
    );
}

function closeTimeMs(market = {}, cfg = null) {
  const parsedCfg = cfg || cryptoMarketConfig(market);
  const closeValue = parsedCfg?.closesAt || market.end_time || market.endTime;
  const ms = closeValue ? new Date(closeValue).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

export function cryptoTradeLock(market = {}, now = new Date()) {
  const cfg = cryptoMarketConfig(market);
  if (!cfg || !isCrypto5MinMarket(market)) return null;

  const closeMs = closeTimeMs(market, cfg);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!closeMs || !Number.isFinite(nowMs)) return null;

  const remainingMs = closeMs - nowMs;
  if (remainingMs <= 0) {
    return {
      error: 'market_expired',
      status: 400,
      detail: 'Market already reached its close time.',
    };
  }
  return null;
}

export function assertCryptoTradeAllowed(market = {}, now = new Date()) {
  const lock = cryptoTradeLock(market, now);
  if (!lock) return;
  const err = new Error(lock.error);
  err.status = lock.status;
  err.detail = lock.detail;
  throw err;
}
