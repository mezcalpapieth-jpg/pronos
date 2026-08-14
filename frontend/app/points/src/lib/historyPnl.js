function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const n = finiteNumber(value);
    if (n !== null) return n;
  }
  return null;
}

export function historyPnlValue(market = {}) {
  if (market.outcomeStatus === 'lost') {
    const invested = firstFinite(market.totalInvested, market.buyCollateral);
    if (invested !== null) {
      const received = firstFinite(market.totalReceived, market.sellProceeds, 0);
      return received - invested;
    }
  }

  const net = firstFinite(market.netPnl);
  if (net !== null) return net;

  return firstFinite(market.markToMarket, 0);
}
