function normalizeAddress(value) {
  const s = String(value || '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(s) ? s.toLowerCase() : null;
}

function eqAddr(a, b) {
  const left = normalizeAddress(a);
  const right = normalizeAddress(b);
  return Boolean(left && right && left === right);
}

export function buildFactoryProbeStatus({
  owner,
  marketCreator,
  resolver,
  collateral,
  deployerAddress,
  resolverAddress,
  expectedCollateral,
} = {}) {
  const deployerIsOwner = eqAddr(owner, deployerAddress);
  const deployerIsMarketCreator = eqAddr(marketCreator, deployerAddress);
  return {
    deployerIsOwner,
    deployerIsMarketCreator,
    deployerCanCreate: deployerIsOwner || deployerIsMarketCreator,
    resolverMatches: resolverAddress ? eqAddr(resolver, resolverAddress) : false,
    collateralMatches: expectedCollateral ? eqAddr(collateral, expectedCollateral) : false,
  };
}

export function appendFactoryProbeWarnings(
  warnings,
  {
    label,
    probe,
    deployerAddress,
    resolverAddress,
    expectedCollateral,
  } = {},
) {
  if (!Array.isArray(warnings) || !probe?.reachable) return warnings;
  if (deployerAddress && !probe.deployerCanCreate) {
    warnings.push(`${label} factory owner/marketCreator do not allow ONCHAIN_DEPLOYER_ADDRESS = ${deployerAddress} — auto-deploy will revert with "not creator"`);
  }
  if (resolverAddress && !probe.resolverMatches) {
    warnings.push(`${label} factory.resolver() = ${probe.resolver} but ONCHAIN_RESOLVER_ADDRESS = ${resolverAddress} — auto-resolve will revert with "not resolver"`);
  }
  if (expectedCollateral && !probe.collateralMatches) {
    warnings.push(`${label} factory.collateral() = ${probe.collateral} but ONCHAIN_COLLATERAL_ADDRESS = ${expectedCollateral} — UI/balance reads will be wrong`);
  }
  return warnings;
}
