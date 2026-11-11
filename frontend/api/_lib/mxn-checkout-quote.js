// Exact arithmetic for a read-only MXN quote over displayed levels.
export const TICKETS_MXN = [100, 300, 1000];
export const FEE_CAP_BPS = 500;
export const BOOK_TTL_MS = 15_000;
export const FX_TTL_MS = 120_000;
export const HIP4_VENUE_BPS = 10;
export const HIP4_BUILDER_BPS = 25;

const UNIT = 1_000_000n;
const CASH = UNIT ** 4n;
const MXN = CASH * UNIT;
const BPS = 10_000n;

export function checkoutError(code) {
  return Object.assign(new Error(code), { code });
}

export function units(value, code, { max = UNIT * 1_000_000_000_000n, zero = false } = {}) {
  const string = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  const raw = typeof string === 'string' && string.length <= 40
    ? string.replace(/(\.\d{6})0+$/, '$1') : string;
  if (typeof raw !== 'string' || !/^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(raw)) throw checkoutError(code);
  const [whole, fraction = ''] = raw.split('.');
  const amount = BigInt(whole) * UNIT + BigInt(fraction.padEnd(6, '0'));
  if (amount > max || (!zero && !amount)) throw checkoutError(code);
  return amount;
}

function format(value, scale) {
  if (value < 0n) return '-' + format(-value, scale);
  const fractional = ((value % scale) * UNIT / scale).toString().padStart(6, '0').replace(/0+$/, '');
  return String(value / scale) + (fractional ? '.' + fractional : '');
}

function normalizeSide(levels, buy) {
  if (!Array.isArray(levels) || !levels.length || levels.length > 1000) throw checkoutError('invalid_depth');
  const sorted = levels.map(({ price, size } = {}) => ({
    price: units(price, 'invalid_depth', { max: UNIT - 1n }),
    size: units(size, 'invalid_depth'),
  })).sort((a, b) => (buy ? 1 : -1) * Number(a.price - b.price));
  if (sorted.some((level, index) => index && sorted[index - 1].price === level.price)) throw checkoutError('invalid_depth');
  return sorted;
}

function tradeAt(price, size, curve, venueBps, builderBps) {
  const gross = price * size;
  return {
    gross: gross * UNIT ** 2n,
    venue: curve == null ? gross * venueBps * (UNIT ** 2n / BPS) : gross * curve * (UNIT - price),
    builder: gross * builderBps * (UNIT ** 2n / BPS),
  };
}

export function quoteMxn({ snapshot, fx, side, ticketMxn, nowMs }) {
  if (!TICKETS_MXN.includes(ticketMxn) || !['buy', 'sell'].includes(side)) throw checkoutError('invalid_query');
  const { bookTimeMs, minOrderSize, builderFeeBps, builderFeeStatus, venueFeeStatus, venueFeeRate, venueFeeBps } = snapshot;
  const expiresAtMs = Math.min(bookTimeMs + BOOK_TTL_MS, snapshot.expiresAtMs, fx.timeMs + FX_TTL_MS);
  if (!Number.isSafeInteger(expiresAtMs) || nowMs >= expiresAtMs || bookTimeMs > nowMs || fx.timeMs > nowMs) {
    throw checkoutError('stale_quote');
  }
  const bid = units(fx.bid, 'invalid_fx');
  const ask = units(fx.ask, 'invalid_fx');
  if (bid > ask) throw checkoutError('invalid_fx');
  const buy = side === 'buy';
  const fxRate = buy ? ask : bid;
  const asks = normalizeSide(snapshot.asks, true);
  const bids = normalizeSide(snapshot.bids, false);
  if (bids[0].price >= asks[0].price) throw checkoutError('invalid_depth');
  const levels = buy ? asks : bids;
  const priceSum = asks[0].price + bids[0].price;
  const fxSum = bid + ask;
  const budget = BigInt(ticketMxn) * MXN;
  const requested = buy ? null : (BigInt(ticketMxn) * 4n * UNIT ** 2n / (priceSum * fxSum)) * UNIT;
  const curve = venueFeeRate == null ? null : units(venueFeeRate, 'unsupported_fees', { max: UNIT, zero: true });
  if (!Number.isInteger(builderFeeBps) || builderFeeBps < 0 || builderFeeBps > 100
    || (curve == null && (!Number.isInteger(venueFeeBps) || venueFeeBps < 0 || venueFeeBps > 500))) {
    throw checkoutError('unsupported_fees');
  }
  const builderBps = BigInt(builderFeeBps);
  const venueBps = BigInt(venueFeeBps ?? 0);
  const minimum = units(minOrderSize, 'invalid_depth');
  const sizeAtPrice = (price, size) => tradeAt(price, size, curve, venueBps, builderBps);
  const cash = ({ gross, venue, builder }) => buy ? gross + venue + builder : gross - venue - builder;

  function sweep(quantity) {
    const total = { gross: 0n, venue: 0n, builder: 0n, filled: 0n, worst: null };
    for (const { price, size } of levels) {
      const remaining = quantity - total.filled;
      if (remaining === 0n) break;
      const filled = size < remaining ? size : remaining;
      const charge = sizeAtPrice(price, filled);
      total.gross += charge.gross;
      total.venue += charge.venue;
      total.builder += charge.builder;
      total.filled += filled;
      total.worst = price;
    }
    return total;
  }

  const visibleWhole = levels.reduce((sum, level) => sum + level.size, 0n) / UNIT;
  let quantity = requested;
  let depthLimited = false;
  if (buy) {
    let low = 0n;
    let high = visibleWhole;
    while (low < high) {
      const mid = (low + high + 1n) / 2n;
      if (cash(sweep(mid * UNIT)) * fxRate <= budget) low = mid;
      else high = mid - 1n;
    }
    quantity = low * UNIT;
    // After all displayed whole shares are used, a meaningful unspent budget
    // is still depth-limited if it could buy one more at the last visible price.
    depthLimited = low === visibleWhole
      && (cash(sweep(quantity)) + cash(sizeAtPrice(levels.at(-1).price, UNIT))) * fxRate <= budget;
  }
  const fill = sweep(quantity);
  const gross = fill.gross * fxRate;
  const net = cash(fill) * fxRate;
  const totalFee = fill.venue + fill.builder;
  let status = 'eligible';
  if (depthLimited || fill.filled < quantity) status = 'partial_depth';
  else if (!quantity) status = 'below_one_share';
  else if (fill.filled < minimum) status = 'below_minimum';
  else if (totalFee * BPS > fill.gross * BigInt(FEE_CAP_BPS)) status = 'fee_cap_exceeded';
  return {
    side, status, eligible: status === 'eligible', reason: status === 'eligible' ? null : status,
    executable: false, feeCapBps: FEE_CAP_BPS,
    feeBps: fill.gross ? Number(totalFee * BPS * UNIT / fill.gross) / Number(UNIT) : null,
    builderFeeBps, builderFeeStatus, venueFeeStatus, expiresAt: new Date(expiresAtMs).toISOString(),
    ticketMxn, requestedShares: requested == null ? null : format(requested, UNIT),
    filledShares: format(fill.filled, UNIT), minOrderSize: format(minimum, UNIT),
    grossMxn: format(gross, MXN), venueFeeMxn: format(fill.venue * fxRate, MXN),
    pronosFeeMxn: format(fill.builder * fxRate, MXN), netMxn: format(net, MXN),
    remainingMxn: buy ? format(budget - net, MXN) : null,
    fxRate: format(fxRate, UNIT), fxBid: format(bid, UNIT), fxAsk: format(ask, UNIT),
    fxCostMxn: format(cash(fill) * (ask - bid) / 2n, MXN),
    fundingCostMxn: null, fundingMode: 'existing_venue_balance',
    midpoint: format(priceSum, 2n * UNIT), vwap: fill.filled ? format(fill.gross / UNIT ** 2n, fill.filled * UNIT) : null,
    worstPrice: fill.worst == null ? null : format(fill.worst, UNIT), netCollateral: format(cash(fill), CASH),
  };
}
