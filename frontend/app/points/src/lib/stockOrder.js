import { decimal, fixed, stockError } from '../../../../api/_lib/stock-math.js';

// Round down at the venue's quantity step; floating-point percentages can
// otherwise accidentally request more than the wallet owns.
export function stockQuantityAtPercent(quantity, percent, precision) {
  if (!Number.isInteger(precision) || precision < 0 || precision > 8
      || !Number.isInteger(percent) || percent < 0 || percent > 100) throw stockError('invalid_amount');
  const units = fixed(quantity || '0', 18) * (10n ** BigInt(precision)) * BigInt(percent) / ((10n ** 18n) * 100n);
  return decimal(units, precision);
}

export function stockFormRequest({ ticker, side, unitMode, amount, quantity, sellPercent = null, positionQuantity = '0', precision = 8 }) {
  if (side === 'sell' && sellPercent !== null) {
    return sellPercent === 100 ? { ticker, side, sellAll: true }
      : { ticker, side, quantity: stockQuantityAtPercent(positionQuantity, sellPercent, precision) };
  }
  const value = String(unitMode === 'units' ? quantity : amount).trim().replace(',', '.');
  return { ticker, side, ...(unitMode === 'units' ? { quantity: value } : { amount: value }) };
}

export function stockSalePercent(quantity, positionQuantity) {
  try {
    const held = fixed(positionQuantity || '0', 18);
    return held > 0n ? Math.min(100, Number(fixed(quantity || '0', 18) * 100n / held)) : 0;
  } catch { return 0; }
}
