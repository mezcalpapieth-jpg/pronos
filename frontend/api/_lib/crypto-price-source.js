const COINBASE_EXCHANGE_BASE_URL = 'https://api.exchange.coinbase.com';
const DEFAULT_CANDLE_GRANULARITY_SECONDS = 60;

function toIso(ms) {
  return new Date(ms).toISOString();
}

function parseTimestampMs(timestamp) {
  const ms = timestamp instanceof Date
    ? timestamp.getTime()
    : (typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime());
  if (!Number.isFinite(ms)) throw new Error('crypto-price-source: invalid timestamp');
  return ms;
}

function normalizeProductId(productId) {
  const id = String(productId || '').trim().toUpperCase();
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(id)) {
    throw new Error('crypto-price-source: invalid coinbase product id');
  }
  return id;
}

function parseCoinbaseCandle(row) {
  if (!Array.isArray(row) || row.length < 5) return null;
  const startSec = Number(row[0]);
  const close = Number(row[4]);
  if (!Number.isFinite(startSec) || !Number.isFinite(close) || close <= 0) return null;
  return { startSec, close };
}

export async function readCoinbaseBoundaryPrice({
  productId,
  timestamp,
  fetchImpl = globalThis.fetch,
  granularitySeconds = DEFAULT_CANDLE_GRANULARITY_SECONDS,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('crypto-price-source: fetch unavailable');
  }

  const normalizedProductId = normalizeProductId(productId);
  const targetMs = parseTimestampMs(timestamp);
  const granularity = Math.max(1, Math.floor(Number(granularitySeconds) || 0));
  const targetSec = Math.floor(targetMs / 1000);
  const exactStartSec = targetSec - granularity;

  // Coinbase candles are keyed by candle start. For a 5-minute close at
  // 09:10:00, the boundary price is the close of the 09:09:00 candle.
  const startMs = (targetSec - granularity * 3) * 1000;
  const endMs = (targetSec + granularity) * 1000;
  const url = new URL(`/products/${normalizedProductId}/candles`, COINBASE_EXCHANGE_BASE_URL);
  url.searchParams.set('granularity', String(granularity));
  url.searchParams.set('start', toIso(startMs));
  url.searchParams.set('end', toIso(endMs));

  const response = await fetchImpl(url);
  if (!response?.ok) {
    throw new Error(`crypto-price-source: coinbase candles failed ${response?.status || 'unknown'}`);
  }

  const body = await response.json();
  if (!Array.isArray(body)) {
    throw new Error('crypto-price-source: invalid coinbase candles response');
  }

  const candles = body.map(parseCoinbaseCandle).filter(Boolean);
  const exact = candles.find((candle) => candle.startSec === exactStartSec);
  const fallback = exact || candles
    .filter((candle) => candle.startSec + granularity <= targetSec)
    .sort((a, b) => b.startSec - a.startSec)[0];

  if (!fallback || targetSec - (fallback.startSec + granularity) > granularity) {
    throw new Error('crypto-price-source: no boundary candle available');
  }

  return {
    price: fallback.close,
    source: 'coinbase-candle',
    productId: normalizedProductId,
    candleStartAt: toIso(fallback.startSec * 1000),
    capturedAt: toIso((fallback.startSec + granularity) * 1000),
    targetAt: toIso(targetSec * 1000),
  };
}
