export const DEFAULT_DEPTH_LEVELS = Object.freeze([10, 25, 50, 100]);

const MAX_DEPTH_LEVELS = 5;
const MAX_DEPTH_NOTIONAL = 10_000;

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function roundForWire(value, decimals = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(decimals));
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function errorCode(error, fallback) {
  return String(error?.message || error?.code || fallback);
}

export function normalizeDepthLevels(input) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : DEFAULT_DEPTH_LEVELS;

  const levels = [];
  const seen = new Set();
  for (const value of raw) {
    const n = finitePositive(value);
    if (n === null || n > MAX_DEPTH_NOTIONAL) continue;
    const rounded = roundForWire(n);
    if (rounded === null || seen.has(rounded)) continue;
    levels.push(rounded);
    seen.add(rounded);
    if (levels.length >= MAX_DEPTH_LEVELS) break;
  }

  return levels.length > 0 ? levels : [...DEFAULT_DEPTH_LEVELS];
}

function fallbackPrice(market, outcomeIndex) {
  const prices = Array.isArray(market?.prices) ? market.prices : null;
  const explicit = finiteNumber(prices?.[outcomeIndex]);
  if (explicit !== null && explicit > 0) return explicit;

  const outcomes = Array.isArray(market?.outcomes) && market.outcomes.length > 0
    ? market.outcomes
    : ['Sí', 'No'];
  return 1 / outcomes.length;
}

function buildBuyRow(notional, quote) {
  return {
    side: 'buy',
    notional,
    collateral: roundForWire(quote.collateral ?? notional),
    fee: roundForWire(quote.fee ?? 0),
    sharesOut: roundForWire(quote.sharesOut ?? quote.payout ?? 0),
    avgPrice: roundForWire(quote.avgPrice ?? 0),
    currentPrice: roundForWire(quote.currentPrice ?? quote.priceBefore ?? 0),
    priceImpactPts: quote.priceImpactPts == null ? null : roundForWire(quote.priceImpactPts),
  };
}

function buildSellRow(notional, shares, quote) {
  const collateralOut = finiteNumber(quote.collateralOut) ?? 0;
  const quoteShares = finiteNumber(quote.shares) ?? shares;
  const avgPrice = finiteNumber(quote.avgPrice)
    ?? (quoteShares > 0 ? collateralOut / quoteShares : 0);

  return {
    side: 'sell',
    notional,
    shares: roundForWire(quoteShares),
    collateralOut: roundForWire(collateralOut),
    avgPrice: roundForWire(avgPrice),
    currentPrice: roundForWire(quote.currentPrice ?? quote.priceBefore ?? 0),
    priceImpactPts: quote.priceImpactPts == null ? null : roundForWire(quote.priceImpactPts),
  };
}

export async function buildAmmDepth({
  market,
  outcomeIndex = 0,
  levels = DEFAULT_DEPTH_LEVELS,
  quoteBuy,
  quoteSell,
} = {}) {
  const ladder = normalizeDepthLevels(levels);
  const buy = [];
  const sell = [];

  for (const notional of ladder) {
    let currentPrice = fallbackPrice(market, outcomeIndex);

    try {
      const quote = await quoteBuy({ market, outcomeIndex, collateral: notional });
      const row = buildBuyRow(notional, quote || {});
      buy.push(row);
      currentPrice = row.currentPrice && row.currentPrice > 0 ? row.currentPrice : currentPrice;
    } catch (error) {
      buy.push({ side: 'buy', notional, error: errorCode(error, 'quote_failed') });
    }

    const shares = roundForWire(notional / currentPrice);
    if (!shares || shares <= 0) {
      sell.push({ side: 'sell', notional, error: 'price_unavailable' });
      continue;
    }

    try {
      const quote = await quoteSell({ market, outcomeIndex, shares });
      sell.push(buildSellRow(notional, shares, quote || {}));
    } catch (error) {
      sell.push({ side: 'sell', notional, shares, error: errorCode(error, 'sell_quote_failed') });
    }
  }

  return {
    outcomeIndex,
    levels: ladder,
    buy,
    sell,
    generatedAt: new Date().toISOString(),
  };
}
