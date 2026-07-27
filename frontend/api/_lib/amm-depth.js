import {
  binaryBuyQuote,
  binarySellQuote,
  multiBuyQuote,
  multiSellQuote,
} from './amm-math.js';

const DEFAULT_LEVELS = [10, 25, 50, 100, 250, 500, 1000, 2500];

function round(value, digits = 6) {
  if (!Number.isFinite(Number(value))) return 0;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function clampPrice(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function quoteBuy(reserves, outcomeIndex, amount) {
  return reserves.length === 2
    ? binaryBuyQuote(reserves, outcomeIndex, amount)
    : multiBuyQuote(reserves, outcomeIndex, amount);
}

function quoteSell(reserves, outcomeIndex, shares) {
  return reserves.length === 2
    ? binarySellQuote(reserves, outcomeIndex, shares)
    : multiSellQuote(reserves, outcomeIndex, shares);
}

function bestAsk(asks) {
  return asks.reduce((best, row) => (
    best == null || row.price < best ? row.price : best
  ), null);
}

function bestBid(bids) {
  return bids.reduce((best, row) => (
    best == null || row.price > best ? row.price : best
  ), null);
}

export function buildAmmDepth({ reserves, outcomeIndex = 0, levels = DEFAULT_LEVELS } = {}) {
  if (!Array.isArray(reserves) || reserves.length < 2) {
    throw new Error('amm-depth: reserves must contain at least two values');
  }
  const normalizedReserves = reserves.map(Number);
  if (normalizedReserves.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('amm-depth: reserves must be positive');
  }
  const oi = Number(outcomeIndex);
  if (!Number.isInteger(oi) || oi < 0 || oi >= normalizedReserves.length) {
    throw new Error('amm-depth: outcome_index out of range');
  }
  const cleanLevels = (Array.isArray(levels) && levels.length > 0 ? levels : DEFAULT_LEVELS)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 12);

  const asks = [];
  const bids = [];
  let currentPrice = null;

  for (const amount of cleanLevels) {
    try {
      const quote = quoteBuy(normalizedReserves, oi, amount);
      const price = clampPrice(quote.avgPrice);
      if (price > 0 && quote.sharesOut > 0) {
        currentPrice = currentPrice == null ? clampPrice(quote.priceBefore) : currentPrice;
        asks.push({
          side: 'ask',
          price: round(price, 6),
          shares: round(quote.sharesOut, 6),
          total: round(quote.collateral, 6),
          fee: round(quote.fee, 6),
          priceImpactPts: round(quote.priceImpactPts, 4),
        });
      }
    } catch {
      // Larger levels can legitimately exceed available liquidity.
    }

    try {
      const quote = quoteSell(normalizedReserves, oi, amount);
      const price = clampPrice(quote.collateralOut / quote.shares);
      if (price > 0 && quote.collateralOut > 0) {
        currentPrice = currentPrice == null ? clampPrice(quote.priceBefore) : currentPrice;
        bids.push({
          side: 'bid',
          price: round(price, 6),
          shares: round(quote.shares, 6),
          total: round(quote.collateralOut, 6),
          fee: round(quote.fee, 6),
          priceImpactPts: round(quote.priceImpactPts, 4),
        });
      }
    } catch {
      // Same: depth is bounded by the pool.
    }
  }

  asks.sort((a, b) => b.price - a.price);
  bids.sort((a, b) => b.price - a.price);

  const ask = bestAsk(asks);
  const bid = bestBid(bids);
  const spread = ask == null || bid == null ? null : Math.max(0, ask - bid);

  return {
    currentPrice: round(currentPrice ?? 0, 6),
    spread: spread == null ? null : round(spread, 6),
    asks,
    bids,
  };
}

export { DEFAULT_LEVELS as AMM_DEPTH_LEVELS };
