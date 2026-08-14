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
  const collateralOut = round2(quote.collateralOut);
  const markPnl = round2(markValue - costBasis);
  const salePnl = round2(collateralOut - costBasis);
  const slippageMxnp = round2(collateralOut - markValue);
  const slippagePct = markValue > 0 ? round2((slippageMxnp / markValue) * 100) : 0;
  const priceBefore = Number(quote.priceBefore);
  const priceAfter = Number(quote.priceAfter);
  const priceImpactPts = round2(quote.priceImpactPts);

  return {
    shares: round2(shares),
    maxShares: round2(maxShares),
    sharePct: maxShares > 0 ? round2((shares / maxShares) * 100) : 100,
    costBasis,
    markValue,
    collateralOut,
    markPnl,
    salePnl,
    slippageMxnp,
    slippagePct,
    priceBeforePct: Number.isFinite(priceBefore) ? round2(priceBefore * 100) : 0,
    priceAfterPct: Number.isFinite(priceAfter) ? round2(priceAfter * 100) : 0,
    priceImpactPts,
    minCollateralOut: collateralOut > 0 ? round2(collateralOut * 0.99) : 0,
  };
}

export function normalizeSellShares(position = {}, shares) {
  const maxShares = Math.max(0, Number(position?.shares) || 0);
  const raw = Number(shares);
  if (!Number.isFinite(raw)) return maxShares;
  return Math.max(Math.min(0.01, maxShares), Math.min(maxShares, raw));
}
