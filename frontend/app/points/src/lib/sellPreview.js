const round2 = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export function buildSellPreview(position = {}, quote = {}) {
  const maxShares = Math.max(0, Number(position.shares) || 0);
  const quotedShares = Number(quote.shares ?? position.selectedShares ?? maxShares);
  const shares = Math.max(0, Math.min(maxShares || quotedShares, Number.isFinite(quotedShares) ? quotedShares : maxShares));
  const shareRatio = maxShares > 0 ? shares / maxShares : 1;
  const markValue = round2((Number(position.currentValue) || 0) * shareRatio);
  const costBasis = round2((Number(position.costBasis) || 0) * shareRatio);
  const collateralOut = position.mode === 'onchain'
    ? Math.max(0, Number(quote.collateralOut) || 0)
    : round2(quote.collateralOut);
  const markPnl = round2(markValue - costBasis);
  const salePnl = round2(collateralOut - costBasis);
  const slippageMxnp = round2(collateralOut - markValue);
  const slippagePct = markValue > 0 ? round2((slippageMxnp / markValue) * 100) : 0;
  const priceBefore = quote.priceBefore == null ? NaN : Number(quote.priceBefore);
  const priceAfter = quote.priceAfter == null ? NaN : Number(quote.priceAfter);
  const priceImpactPts = round2(quote.priceImpactPts);

  return {
    shares: position.mode === 'onchain' ? Math.floor(shares * 1e6 + 1e-7) / 1e6 : round2(shares),
    maxShares: position.mode === 'onchain' ? maxShares : round2(maxShares),
    sharePct: maxShares > 0 ? round2((shares / maxShares) * 100) : 100,
    costBasis,
    markValue,
    collateralOut,
    ...(position.mode === 'onchain' ? {
      gross: Math.max(0, Number(quote.gross) || 0),
      fee: Math.max(0, Number(quote.fee) || 0),
      feePct: Math.max(0, Number(quote.feePct) || 0),
    } : {}),
    markPnl,
    salePnl,
    slippageMxnp,
    slippagePct,
    priceBeforePct: Number.isFinite(priceBefore) ? round2(priceBefore * 100) : null,
    priceAfterPct: Number.isFinite(priceAfter) ? round2(priceAfter * 100) : null,
    priceImpactPts,
    minCollateralOut: position.mode === 'onchain'
      ? Math.floor(Math.max(0, Number(quote.collateralOut) || 0) * 0.99 * 1e6) / 1e6
      : collateralOut > 0 ? round2(collateralOut * 0.99) : 0,
  };
}

export function normalizeSellShares(position = {}, shares) {
  const maxShares = Math.max(0, Number(position?.shares) || 0);
  const raw = Number(shares);
  if (!Number.isFinite(raw)) return maxShares;
  return Math.max(Math.min(0.01, maxShares), Math.min(maxShares, raw));
}
