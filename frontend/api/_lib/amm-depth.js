import {
  binaryBuyQuote,
  binaryPrices,
  binarySellQuote,
  multiBuyQuote,
  multiPrices,
  multiSellQuote,
} from './amm-math.js';

const DEFAULT_LEVELS = [10, 25, 50, 100, 250, 500, 1000, 2500];
const DEFAULT_MOCK_MAKER_DEPTH = 500;
const MOCK_MAKER_SPREADS = [0.01, 0.02, 0.035, 0.05, 0.075, 0.10, 0.14, 0.18, 0.23, 0.29, 0.36, 0.44];
const DEFAULT_EDGE_DEPTH_START = 0.65;

function round(value, digits = 6) {
  if (!Number.isFinite(Number(value))) return 0;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function clampPrice(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smoothstep(value) {
  const x = clamp01(value);
  return x * x * (3 - (2 * x));
}

function edgeDepthWeight({ side, price, edgeDepthMultiplier = 0, edgeDepthStart = DEFAULT_EDGE_DEPTH_START } = {}) {
  const extra = Math.max(0, Number(edgeDepthMultiplier || 0));
  if (extra <= 0) return 1;
  const start = Math.max(0.5, Math.min(0.95, Number(edgeDepthStart || DEFAULT_EDGE_DEPTH_START)));
  const p = clampPrice(price);
  const towardEdge = side === 'bid' ? 1 - p : p;
  const pressure = smoothstep((towardEdge - start) / Math.max(0.01, 1 - start));
  return 1 + (extra * pressure);
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

function pricesForReserves(reserves) {
  return reserves.length === 2 ? binaryPrices(reserves) : multiPrices(reserves);
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

export function buildMockMakerDepth({
  reserves,
  outcomeIndex = 0,
  levels = DEFAULT_LEVELS,
  seedLiquidity = DEFAULT_MOCK_MAKER_DEPTH,
  seedLiquidities = null,
  minimumDepth = DEFAULT_MOCK_MAKER_DEPTH,
  edgeDepthMultiplier = 0,
  edgeDepthStart = DEFAULT_EDGE_DEPTH_START,
} = {}) {
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
  const count = Math.max(1, cleanLevels.length);
  const seedValues = Array.isArray(seedLiquidities) ? seedLiquidities.map(Number) : [];
  const configuredDepth = Number(seedValues[oi] ?? seedLiquidity);
  const perSideDepth = Math.max(
    Number.isFinite(configuredDepth) ? configuredDepth : 0,
    Number.isFinite(Number(minimumDepth)) ? Number(minimumDepth) : DEFAULT_MOCK_MAKER_DEPTH,
  );
  const currentPrice = clampPrice(Number(pricesForReserves(normalizedReserves)[oi]));
  const asks = [];
  const bids = [];

  const weights = Array.from({ length: count }, (_, i) => 1 + i * 0.12);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  for (let i = 0; i < count; i += 1) {
    const spread = MOCK_MAKER_SPREADS[Math.min(i, MOCK_MAKER_SPREADS.length - 1)];
    const baseTotal = perSideDepth * (weights[i] / totalWeight);
    const askPrice = clampPrice(Math.max(0.01, Math.min(0.99, currentPrice + spread)));
    const bidPrice = clampPrice(Math.max(0.01, Math.min(0.99, currentPrice - spread)));
    const askTotal = round(baseTotal * edgeDepthWeight({
      side: 'ask',
      price: askPrice,
      edgeDepthMultiplier,
      edgeDepthStart,
    }), 6);
    const bidTotal = round(baseTotal * edgeDepthWeight({
      side: 'bid',
      price: bidPrice,
      edgeDepthMultiplier,
      edgeDepthStart,
    }), 6);

    if (askPrice > 0) {
      asks.push({
        side: 'ask',
        price: round(askPrice, 6),
        shares: round(askTotal / askPrice, 6),
        total: askTotal,
        fee: 0,
        priceImpactPts: 0,
        source: 'maker',
      });
    }
    if (bidPrice > 0) {
      bids.push({
        side: 'bid',
        price: round(bidPrice, 6),
        shares: round(bidTotal / bidPrice, 6),
        total: bidTotal,
        fee: 0,
        priceImpactPts: 0,
        source: 'maker',
      });
    }
  }

  asks.sort((a, b) => b.price - a.price);
  bids.sort((a, b) => b.price - a.price);

  const ask = bestAsk(asks);
  const bid = bestBid(bids);
  const spread = ask == null || bid == null ? null : Math.max(0, ask - bid);

  return {
    currentPrice: round(currentPrice, 6),
    spread: spread == null ? null : round(spread, 6),
    asks,
    bids,
    perSideDepth: round(perSideDepth, 6),
  };
}

export { DEFAULT_LEVELS as AMM_DEPTH_LEVELS };
