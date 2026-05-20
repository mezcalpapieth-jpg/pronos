const round2 = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export function buildSellPreview(position = {}, quote = {}) {
  const markValue = round2(position.currentValue);
  const costBasis = round2(position.costBasis);
  const collateralOut = round2(quote.collateralOut);
  const markPnl = round2(position.pnl ?? (markValue - costBasis));
  const salePnl = round2(collateralOut - costBasis);
  const slippageMxnp = round2(collateralOut - markValue);
  const slippagePct = markValue > 0 ? round2((slippageMxnp / markValue) * 100) : 0;
  const priceBefore = Number(quote.priceBefore);
  const priceAfter = Number(quote.priceAfter);
  const priceImpactPts = round2(quote.priceImpactPts);

  return {
    shares: round2(position.shares),
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
