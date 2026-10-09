import {
  binaryBuyQuote, binarySellQuote, binaryPrices,
  multiBuyQuote, multiSellQuote, multiPrices,
} from './amm-math.js';

const EPSILON = 0.000001;
const round = value => Math.round(value * 1e6) / 1e6;
const floor = value => Math.floor(value * 1e6) / 1e6;
const prices = reserves => (reserves.length === 2 ? binaryPrices : multiPrices)(reserves);
const buyQuote = (reserves, oi, amount) => (reserves.length === 2 ? binaryBuyQuote : multiBuyQuote)(reserves, oi, amount);
const sellQuote = (reserves, oi, amount) => (reserves.length === 2 ? binarySellQuote : multiSellQuote)(reserves, oi, amount);

function validate(reserves, outcomeIndex, amount) {
  if (!Array.isArray(reserves) || reserves.length < 2 || reserves.some(r => !Number.isFinite(r) || r <= 0)) {
    throw new Error('amm-math: reserves must be positive');
  }
  if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0 || outcomeIndex >= reserves.length) {
    throw new Error('amm-math: invalid outcome index');
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amm-math: amount must be positive');
}

function sortedOrders(rows, username, buying) {
  return rows.filter(row => (
    (!username || row.username !== username)
    && (!row.status || row.status === 'open')
    && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now())
    && Number(row.limit_price) > 0 && Number(row.limit_price) < 1
    && Number(row.remaining_amount) > EPSILON
  )).sort((a, b) => (
    (buying ? 1 : -1) * (Number(a.limit_price) - Number(b.limit_price))
    || new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    || Number(a.id) - Number(b.id)
  ));
}

// Fees are fixed within each existing 100 MXNP AMM fee slice. Compare
// gross marginal cost, not the average price of the whole taker order.
function buyToPrice(reserves, oi, budget, limitPrice) {
  let next = reserves;
  let spent = 0;
  let shares = 0;
  let fee = 0;
  while (budget - spent > EPSILON) {
    const feeRate = buyQuote(next, oi, 1).fee;
    if (prices(next)[oi] / (1 - feeRate) >= limitPrice - EPSILON) break;
    const amount = round(Math.min(100, budget - spent));
    const full = buyQuote(next, oi, amount);
    let quote = full;
    if (full.priceAfter / (1 - feeRate) > limitPrice) {
      let lo = 0;
      let hi = amount;
      quote = null;
      for (let i = 0; i < 40 && hi - lo > EPSILON; i++) {
        const mid = floor((lo + hi) / 2);
        if (mid <= EPSILON) break;
        const candidate = buyQuote(next, oi, mid);
        if (candidate.priceAfter / (1 - feeRate) <= limitPrice) {
          lo = mid;
          quote = candidate;
        } else hi = mid;
      }
    }
    if (!quote || quote.collateral <= EPSILON) break;
    spent = round(spent + quote.collateral);
    shares = round(shares + quote.sharesOut);
    fee = round(fee + quote.fee);
    next = quote.reservesAfter;
    if (quote.collateral < amount - EPSILON) break;
  }
  return spent > EPSILON ? {
    source: 'amm', side: 'buy', shares, collateral: spent, fee,
    price: (spent - fee) / shares, reservesBefore: reserves, reservesAfter: next,
  } : null;
}

function sellToPrice(reserves, oi, shares, limitPrice) {
  if (prices(reserves)[oi] <= limitPrice + EPSILON) return null;
  let quote = sellQuote(reserves, oi, shares);
  if (quote.priceAfter < limitPrice) {
    let lo = 0;
    let hi = shares;
    quote = null;
    for (let i = 0; i < 40 && hi - lo > EPSILON; i++) {
      const mid = floor((lo + hi) / 2);
      if (mid <= EPSILON) break;
      const candidate = sellQuote(reserves, oi, mid);
      if (candidate.priceAfter >= limitPrice) {
        lo = mid;
        quote = candidate;
      } else hi = mid;
    }
  }
  return quote ? {
    source: 'amm', side: 'sell', shares: quote.shares, collateral: quote.collateralOut,
    fee: 0, price: quote.collateralOut / quote.shares,
    reservesBefore: reserves, reservesAfter: quote.reservesAfter,
  } : null;
}

export function previewHybridBuy(rows = [], { reserves, outcomeIndex, collateral, username = null } = {}) {
  validate(reserves, outcomeIndex, collateral);
  let next = reserves.map(Number);
  let remaining = round(collateral);
  const fills = [];
  const add = fill => {
    if (!fill) return;
    fills.push(fill);
    remaining = round(Math.max(0, remaining - fill.collateral));
    next = fill.reservesAfter;
  };
  for (const row of sortedOrders(rows, username, true)) {
    if (remaining <= EPSILON) break;
    const price = Number(row.limit_price);
    add(buyToPrice(next, outcomeIndex, remaining, price));
    if (remaining <= EPSILON) break;
    const shares = floor(Math.min(Number(row.remaining_amount), remaining / price));
    const cost = round(shares * price);
    if (shares > EPSILON && cost > EPSILON) add({
      orderId: row.id, maker: row.username, source: 'limit', side: 'sell',
      price, shares, collateral: cost, fee: 0, reservesBefore: next, reservesAfter: next,
    });
  }
  if (remaining > EPSILON) {
    const q = buyQuote(next, outcomeIndex, remaining);
    add({ source: 'amm', side: 'buy', shares: q.sharesOut, collateral: q.collateral,
      fee: q.fee, price: q.avgPrice, reservesBefore: next, reservesAfter: q.reservesAfter });
  }
  const sharesOut = round(fills.reduce((sum, f) => sum + f.shares, 0));
  const collateralSpent = round(fills.reduce((sum, f) => sum + f.collateral, 0));
  const fee = round(fills.reduce((sum, f) => sum + f.fee, 0));
  const moved = fills.some(f => f.source === 'amm');
  return {
    fills, sharesOut, collateralSpent, fee, remainingCollateral: remaining,
    avgPrice: sharesOut > 0 ? (collateralSpent - fee) / sharesOut : 0,
    reservesAfter: next, priceBefore: prices(reserves)[outcomeIndex],
    priceAfter: moved ? prices(next)[outcomeIndex] : (fills.at(-1)?.price ?? prices(next)[outcomeIndex]),
  };
}

export function previewHybridSell(rows = [], { reserves, outcomeIndex, shares, username = null } = {}) {
  validate(reserves, outcomeIndex, shares);
  let next = reserves.map(Number);
  let remaining = round(shares);
  const fills = [];
  const add = fill => {
    if (!fill) return;
    fills.push(fill);
    remaining = round(Math.max(0, remaining - fill.shares));
    next = fill.reservesAfter;
  };
  for (const row of sortedOrders(rows, username, false)) {
    if (remaining <= EPSILON) break;
    const price = Number(row.limit_price);
    add(sellToPrice(next, outcomeIndex, remaining, price));
    if (remaining <= EPSILON) break;
    const fillShares = floor(Math.min(remaining, Number(row.remaining_amount) / price));
    const cost = round(fillShares * price);
    if (fillShares > EPSILON && cost > EPSILON) add({
      orderId: row.id, maker: row.username, source: 'limit', side: 'buy',
      price, shares: fillShares, collateral: cost, fee: 0, reservesBefore: next, reservesAfter: next,
    });
  }
  if (remaining > EPSILON) {
    const q = sellQuote(next, outcomeIndex, remaining);
    add({ source: 'amm', side: 'sell', shares: q.shares, collateral: q.collateralOut,
      fee: 0, price: q.collateralOut / q.shares, reservesBefore: next, reservesAfter: q.reservesAfter });
  }
  const sharesSold = round(fills.reduce((sum, f) => sum + f.shares, 0));
  const collateralOut = round(fills.reduce((sum, f) => sum + f.collateral, 0));
  const moved = fills.some(f => f.source === 'amm');
  return {
    fills, sharesSold, collateralOut, remainingShares: remaining,
    avgPrice: sharesSold > 0 ? collateralOut / sharesSold : 0,
    reservesAfter: next, priceBefore: prices(reserves)[outcomeIndex],
    priceAfter: moved ? prices(next)[outcomeIndex] : (fills.at(-1)?.price ?? prices(next)[outcomeIndex]),
  };
}
