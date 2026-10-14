// Accounting uses scaled integers throughout. Numbers are only for UI display.
export const MONEY_DECIMALS = 6;
const MONEY = 1000000n;
const PRICE = 100000000n;
const QTY = 1000000000000000000n;

export function stockError(code, status = 400) {
  return Object.assign(new Error(code), { status, code });
}

export function fixed(value, decimals = MONEY_DECIMALS) {
  const text = String(value ?? '');
  if (!/^\d{1,20}(?:\.\d{1,18})?$/.test(text)) throw stockError('invalid_amount');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.slice(decimals).replace(/0/g, '')) throw stockError('invalid_precision');
  return BigInt(whole) * (10n ** BigInt(decimals))
    + BigInt(fraction.slice(0, decimals).padEnd(decimals, '0') || '0');
}

export function decimal(value, decimals = MONEY_DECIMALS) {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const tail = (absolute % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${sign}${absolute / scale}${tail ? `.${tail}` : ''}`;
}

function ceil(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

export function assertStockQuoteFresh(quote, now = Date.now()) {
  const time = Number(quote?.bookTime);
  const fetched = Number(quote?.fetchedAt);
  if (!Number.isFinite(time) || !Number.isFinite(fetched)
      || time > now + 2000 || fetched > now + 2000
      || now - time >= 10000 || now - fetched >= 10000) {
    throw stockError('stock_price_unavailable', 503);
  }
}

export function buildStockFill({ side, amount, quantity, sellAll = false, positionQuantity = '0', quote }) {
  if (side !== 'buy' && side !== 'sell') throw stockError('invalid_side');
  const precision = quote?.szDecimals;
  if (!Number.isInteger(precision) || precision < 0 || precision > 8) throw stockError('stock_price_unavailable', 503);
  const scale = 10n ** BigInt(precision);
  const fx = fixed(quote.fx.rate, 8);
  if (fx <= 0n) throw stockError('stock_price_unavailable', 503);
  const levels = quote.levels?.[side === 'buy' ? 1 : 0];
  if (!Array.isArray(levels) || !levels.length) throw stockError('stock_price_unavailable', 503);
  const denominator = scale * PRICE * PRICE;
  const available = fixed(positionQuantity, 18);
  const budget = amount != null ? fixed(amount) : null;
  const quantityOrder = quantity != null;
  if (Number(budget !== null) + Number(quantityOrder) + Number(sellAll) !== 1 || (side === 'buy' && sellAll)) {
    throw stockError('invalid_amount');
  }
  if (budget !== null && (budget <= 0n || budget > 1000000n * MONEY)) throw stockError('invalid_amount');
  if (side === 'buy' && budget !== null && budget < 100n * MONEY) throw stockError('stock_minimum_amount');
  // Keep quantity arithmetic typed as BigInt, including during Vercel's static tracing.
  let requested = quantityOrder ? fixed(quantity, precision) : 0n;
  if (side === 'sell') {
    if (available <= 0n) throw stockError('insufficient_stock_quantity');
    if (sellAll) requested = available * scale / QTY;
    else if (quantityOrder) requested = fixed(quantity, precision);
    else if (budget !== null) requested = budget * denominator / (fixed(levels[0].px, 8) * fx * MONEY);
    else throw stockError('invalid_amount');
    if (requested * QTY / scale > available) throw stockError('insufficient_stock_quantity');
    // A points request must fit the holding's actual sale value even when a
    // coarse quantity step would round an excessive request down to all units.
    if (budget !== null) {
      let remaining = available * scale / QTY;
      let maximumGross = 0n;
      for (const level of levels) {
        const price = fixed(level.px, 8);
        const size = fixed(level.sz, precision);
        if (price <= 0n || size <= 0n) continue;
        const take = size < remaining ? size : remaining;
        maximumGross += take * price * fx * MONEY / denominator;
        remaining -= take;
        if (remaining === 0n) break;
      }
      if (remaining === 0n && budget > maximumGross) throw stockError('insufficient_stock_quantity');
    }
  }
  let filled = 0n;
  let gross = 0n;
  let usdNumerator = 0n;
  const fills = [];
  // Fee is 0.10% of actual filled notional, rounded up to a micropoint.
  const grossLimit = budget === null ? null : budget * 1000n / 1001n;
  for (const level of levels) {
    const price = fixed(level.px, 8);
    const size = fixed(level.sz, precision);
    if (price <= 0n || size <= 0n) continue;
    let take = size;
    if (side === 'buy' && budget !== null) {
      const room = grossLimit - gross;
      const affordable = room * denominator / (price * fx * MONEY);
      if (take > affordable) take = affordable;
    } else if (take > requested - filled) take = requested - filled;
    if (take <= 0n) break;
    const valueNumerator = take * price * fx * MONEY;
    gross += side === 'buy' ? ceil(valueNumerator, denominator) : valueNumerator / denominator;
    usdNumerator += take * price;
    filled += take;
    fills.push({ quantity: decimal(take, precision), priceUsd: decimal(price, 8) });
    if ((side === 'sell' || quantityOrder) && filled === requested) break;
  }
  if (filled <= 0n) throw stockError('stock_order_too_small');
  if ((side === 'sell' || quantityOrder) && filled !== requested) throw stockError('stock_insufficient_liquidity', 409);
  // For buys, dust smaller than one step is fine; unfilled material size is not.
  const lastPrice = fixed(levels[levels.length - 1].px, 8);
  const dustLimit = ceil(lastPrice * fx * MONEY, denominator);
  if (side === 'buy' && budget !== null && grossLimit - gross >= dustLimit) throw stockError('stock_insufficient_liquidity', 409);
  const fee = ceil(gross, 1000n);
  const total = side === 'buy' ? gross + fee : gross - fee;
  if (side === 'buy' && quantityOrder && total < 100n * MONEY) throw stockError('stock_minimum_amount');
  if (total <= 0n || (side === 'buy' && total > (budget ?? 1000000n * MONEY))) throw stockError('invalid_amount');
  return {
    side, quantity: decimal(filled, precision), gross: decimal(gross), fee: decimal(fee),
    total: decimal(total), unspent: side === 'buy' && budget !== null ? decimal(budget - total) : '0',
    priceUsd: decimal(usdNumerator / filled, 8), fx: quote.fx,
    szDecimals: precision, fills,
  };
}

export function applyStockFill(position, fill) {
  const oldQuantity = fixed(position?.quantity || '0', 18);
  const oldBasis = fixed(position?.cost_basis || '0');
  const oldRealized = parseSignedMoney(position?.realized_pnl || '0');
  const quantity = fixed(fill.quantity, 18);
  const total = fixed(fill.total);
  if (fill.side === 'buy') return {
    quantity: decimal(oldQuantity + quantity, 18), costBasis: decimal(oldBasis + total),
    realizedPnl: decimal(oldRealized), tradePnl: '0', balanceDelta: decimal(-total),
  };
  if (quantity > oldQuantity || quantity <= 0n) throw stockError('insufficient_stock_quantity');
  const allocatedBasis = quantity === oldQuantity ? oldBasis : oldBasis * quantity / oldQuantity;
  return {
    quantity: decimal(oldQuantity - quantity, 18), costBasis: decimal(oldBasis - allocatedBasis),
    realizedPnl: decimal(oldRealized + total - allocatedBasis), tradePnl: decimal(total - allocatedBasis),
    balanceDelta: decimal(total),
  };
}

export function parseSignedMoney(value) {
  const text = String(value);
  return text.startsWith('-') ? -fixed(text.slice(1)) : fixed(text);
}

export function stockPositionValue(quantity, priceUsd, fxRate) {
  return decimal(fixed(quantity, 18) * fixed(priceUsd, 8) * fixed(fxRate, 8) * MONEY / (QTY * PRICE * PRICE));
}

// Tournament settlement is a simulated full liquidation at the common cutoff
// reference, including quantity dust that no longer fits today's book precision.
export function buildStockClosingFill(quantity, mark) {
  if (fixed(quantity, 18) <= 0n || fixed(mark.price_usd, 8) <= 0n || fixed(mark.fx_rate, 8) <= 0n) {
    throw stockError('stock_cutoff_price_unavailable', 503);
  }
  const gross = fixed(stockPositionValue(quantity, mark.price_usd, mark.fx_rate));
  const fee = ceil(gross, 1000n);
  return { side: 'sell', quantity: decimal(fixed(quantity, 18), 18),
    priceUsd: decimal(fixed(mark.price_usd, 8), 8),
    fx: { rate: decimal(fixed(mark.fx_rate, 8), 8), date: mark.fx_date, source: 'Banxico FIX' },
    gross: decimal(gross), fee: decimal(fee), total: decimal(gross - fee), unspent: '0' };
}
