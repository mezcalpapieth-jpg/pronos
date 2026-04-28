/**
 * Lightweight stock/index quote reader.
 *
 * Chainlink doesn't publish US equity feeds on Arbitrum, so we hit a
 * traditional quote API. Finnhub's free tier gives 60 req/min which is
 * plenty for a daily generator + a settle-time resolver pass.
 *
 * Exports:
 *   readFinnhubQuote(symbol) → { price, prevClose, open, high, low, timestamp }
 *     Throws if FINNHUB_API_KEY isn't set (callers decide whether to
 *     swallow or bubble).
 *
 *   comparePrice(price, op, threshold) → re-exported from chainlink.js
 *     so auto-resolve can dispatch uniformly.
 */

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

export async function readFinnhubQuote(symbol) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error('stockprice: FINNHUB_API_KEY not set');
  if (!symbol) throw new Error('stockprice: symbol required');

  // Pass the API key in the X-Finnhub-Token header rather than the
  // ?token= query string. Both auth methods are documented; the header
  // form keeps the secret out of any HTTP-level access logs along the
  // path (Finnhub edge, any intermediate proxy, our own request logs).
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Finnhub-Token': key,
    },
  });
  if (!res.ok) {
    throw new Error(`finnhub: HTTP ${res.status}`);
  }
  const data = await res.json();
  // Finnhub returns 0s for unknown symbols. The `c` field is the current
  // (or most recent) trade price.
  if (!data || typeof data.c !== 'number' || data.c <= 0) {
    throw new Error(`finnhub: empty quote for ${symbol}`);
  }
  return {
    price: Number(data.c),
    prevClose: Number(data.pc) || null,
    open: Number(data.o) || null,
    high: Number(data.h) || null,
    low: Number(data.l) || null,
    timestamp: Number(data.t) * 1000 || null,
  };
}

// Canonical symbols for the user's watchlist. Indices are represented
// by their most-liquid ETF proxy (SPY = S&P 500, QQQ = Nasdaq-100,
// DIA = Dow Jones Industrial Average).
export const STOCKS = {
  SPY:  { label: 'S&P 500 (SPY)', step: 5,  icon: '📈' },
  QQQ:  { label: 'Nasdaq-100 (QQQ)', step: 5, icon: '📊' },
  DIA:  { label: 'Dow Jones (DIA)', step: 5, icon: '🏦' },
  TSLA: { label: 'Tesla', step: 5, icon: '🚗' },
  MSFT: { label: 'Microsoft', step: 5, icon: '🪟' },
  NVDA: { label: 'NVIDIA', step: 10, icon: '🟢' },
  AAPL: { label: 'Apple', step: 5, icon: '🍎' },
};
