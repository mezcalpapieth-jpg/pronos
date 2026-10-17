// Market identity comes from the server's indexed factory/pool join, refreshed
// by the execution adapter before every trade. Status is verified against Turnkey.
export function delegationCoversMarket(status, target) {
  if (!status?.active || Number(status.chainId) !== 421614 || Number(target?.chainId) !== 421614
    || !target.protocolMarketId || target.mode !== 'onchain') return false;
  const pool = target.chainAddress?.toLowerCase();
  if (pool && status.coveredPools?.includes(pool)) return true;
  return Boolean(status.authorizationScope === 'router' && status.coversFutureMarkets === true
    && /^0x[\da-f]{40}$/i.test(status.routerAddress || '')
    && target.factoryAddress && status.coveredFactories?.includes(target.factoryAddress.toLowerCase()));
}
