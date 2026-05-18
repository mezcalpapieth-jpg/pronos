function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function optionalFiniteNumber(value) {
  const n = finiteNumber(value);
  return n !== null && n >= 0 ? n : null;
}

function priceMoved(detail) {
  const err = new Error('price_moved');
  err.status = 409;
  err.detail = detail;
  return err;
}

export function enforceProtocolBuySlippage({ quote, minSharesOut, maxAvgPrice } = {}) {
  const minShares = optionalFiniteNumber(minSharesOut);
  const maxPrice = optionalFiniteNumber(maxAvgPrice);
  const sharesOut = finiteNumber(quote?.sharesOut);
  const avgPrice = finiteNumber(quote?.avgPrice);

  if (minShares !== null && sharesOut !== null && sharesOut < minShares) {
    throw priceMoved(`shares_out=${sharesOut.toFixed(6)} below min=${minShares}`);
  }
  if (maxPrice !== null && avgPrice !== null && avgPrice > maxPrice) {
    throw priceMoved(`avg_price=${avgPrice.toFixed(6)} above max=${maxPrice}`);
  }
}

export function enforceProtocolSellSlippage({ quote, minCollateralOut } = {}) {
  const minOut = optionalFiniteNumber(minCollateralOut);
  const collateralOut = finiteNumber(quote?.collateralOut);
  if (minOut !== null && collateralOut !== null && collateralOut < minOut) {
    throw priceMoved(`out=${collateralOut.toFixed(6)} below min=${minOut}`);
  }
}

export function defaultMinSharesOut(quote, tolerancePct = 2) {
  const sharesOut = finiteNumber(quote?.sharesOut);
  if (sharesOut === null || sharesOut <= 0) return null;
  return sharesOut * (1 - tolerancePct / 100);
}

export function defaultMinCollateralOut(quote, tolerancePct = 2) {
  const collateralOut = finiteNumber(quote?.collateralOut);
  if (collateralOut === null || collateralOut <= 0) return null;
  return collateralOut * (1 - tolerancePct / 100);
}

export function formatProtocolBuyQuote({
  collateral,
  fee,
  sharesOut,
  priceBefore = null,
  priceAfter = null,
  pricesBefore = null,
  pricesAfter = null,
}) {
  const collateralNum = finiteNumber(collateral) ?? 0;
  const feeNum = finiteNumber(fee) ?? 0;
  const sharesNum = finiteNumber(sharesOut) ?? 0;
  const netCollateral = Math.max(0, collateralNum - feeNum);
  const avgPrice = sharesNum > 0 ? netCollateral / sharesNum : 0;
  const feePct = collateralNum > 0 ? (feeNum / collateralNum) * 100 : 0;
  const before = finiteNumber(priceBefore);
  const after = finiteNumber(priceAfter);

  return {
    collateral: collateralNum,
    fee: feeNum,
    feePct,
    sharesOut: sharesNum,
    avgPrice,
    payout: sharesNum,
    profit: sharesNum - collateralNum,
    priceBefore: before,
    priceAfter: after,
    currentPrice: before,
    postTradePrice: after,
    priceImpactPts: before !== null && after !== null ? (after - before) * 100 : null,
    pricesBefore,
    pricesAfter,
  };
}

export function formatProtocolSellQuote({
  shares,
  gross,
  fee,
  collateralOut,
  priceBefore = null,
  priceAfter = null,
  pricesBefore = null,
  pricesAfter = null,
}) {
  const sharesNum = finiteNumber(shares) ?? 0;
  const grossNum = finiteNumber(gross) ?? 0;
  const feeNum = finiteNumber(fee) ?? 0;
  const outNum = finiteNumber(collateralOut) ?? 0;
  const feePct = grossNum > 0 ? (feeNum / grossNum) * 100 : 0;
  const before = finiteNumber(priceBefore);
  const after = finiteNumber(priceAfter);

  return {
    shares: sharesNum,
    gross: grossNum,
    fee: feeNum,
    feePct,
    collateralOut: outNum,
    priceBefore: before,
    priceAfter: after,
    currentPrice: before,
    postTradePrice: after,
    priceImpactPts: before !== null && after !== null ? (after - before) * 100 : null,
    pricesBefore,
    pricesAfter,
  };
}
