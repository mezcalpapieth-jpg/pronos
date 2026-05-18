const ARBITRUM_ONE_CHAIN_ID = 42161;

function hasEnv(env, name) {
  return typeof env?.[name] === 'string' && env[name].trim() !== '';
}

function intEnv(env, name) {
  const n = Number.parseInt(env?.[name], 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeAddress(value) {
  const s = String(value || '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(s) ? s.toLowerCase() : null;
}

function sameAddress(a, b) {
  const left = normalizeAddress(a);
  const right = normalizeAddress(b);
  return Boolean(left && right && left === right);
}

export function parseOnchainAddressList(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map(normalizeAddress)
    .filter(Boolean);
}

function firstEnv(env, names) {
  for (const name of names) {
    if (hasEnv(env, name)) return env[name].trim();
  }
  return null;
}

function warnMissing(warnings, env, name) {
  if (!hasEnv(env, name)) warnings.push(`${name} missing`);
}

function warnAddressMismatch(warnings, env, name, expected, expectedName) {
  if (!hasEnv(env, name) || !expected) return;
  if (!sameAddress(env[name], expected)) {
    warnings.push(`${name} does not match ${expectedName}`);
  }
}

function warnChainMismatch(warnings, env, name, expected, expectedName) {
  const actual = intEnv(env, name);
  if (actual == null || expected == null) return;
  if (actual !== expected) {
    warnings.push(`${name}=${actual} does not match ${expectedName}=${expected}`);
  }
}

export function collectOnchainReadiness({
  env = process.env,
  protocolPools = [],
  protocolPoolError = null,
} = {}) {
  const warnings = [];
  const chainId = intEnv(env, 'ONCHAIN_CHAIN_ID');
  const clientChainId = intEnv(env, 'VITE_ONCHAIN_CHAIN_ID');
  const indexerChainId = intEnv(env, 'CHAIN_ID');
  const protocolChainId = intEnv(env, 'PROTOCOL_CHAIN_ID');
  const factoryV1 = hasEnv(env, 'ONCHAIN_MARKET_FACTORY_ADDRESS')
    ? env.ONCHAIN_MARKET_FACTORY_ADDRESS.trim()
    : null;
  const factoryV2 = hasEnv(env, 'ONCHAIN_MARKET_FACTORY_V2_ADDRESS')
    ? env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS.trim()
    : null;
  const collateral = hasEnv(env, 'ONCHAIN_COLLATERAL_ADDRESS')
    ? env.ONCHAIN_COLLATERAL_ADDRESS.trim()
    : null;
  const indexerFactoryV1 = firstEnv(env, [
    'FACTORY_ADDRESS',
    'PRONOS_FACTORY_ADDRESS',
    chainId === 421614 ? 'VITE_PRONOS_ARB_SEPOLIA_FACTORY' : 'VITE_PRONOS_ARBITRUM_FACTORY',
  ]);
  const indexerFactoryV2 = firstEnv(env, [
    'FACTORY_V2_ADDRESS',
    'PRONOS_FACTORY_V2_ADDRESS',
    chainId === 421614 ? 'VITE_PRONOS_ARB_SEPOLIA_FACTORY_V2' : 'VITE_PRONOS_ARBITRUM_FACTORY_V2',
  ]);
  const indexerRpc = firstEnv(env, [
    'ARB_RPC_URL',
    chainId === 421614 ? 'ARB_SEPOLIA_RPC' : 'ARB_MAINNET_RPC',
    chainId === 421614 ? 'ARBITRUM_SEPOLIA_RPC_URL' : 'ARBITRUM_RPC_URL',
  ]);

  const runtimeEnv = {
    rpc: hasEnv(env, 'ONCHAIN_RPC_URL'),
    chainId,
    factoryV1,
    factoryV2,
    collateral,
    deployerSuborgId: hasEnv(env, 'ONCHAIN_DEPLOYER_SUBORG_ID'),
    deployerAddress: hasEnv(env, 'ONCHAIN_DEPLOYER_ADDRESS')
      ? env.ONCHAIN_DEPLOYER_ADDRESS.trim()
      : null,
    resolverSuborgId: hasEnv(env, 'ONCHAIN_RESOLVER_SUBORG_ID'),
    resolverAddress: hasEnv(env, 'ONCHAIN_RESOLVER_ADDRESS')
      ? env.ONCHAIN_RESOLVER_ADDRESS.trim()
      : null,
    policiesEnabled: env.TURNKEY_POLICIES_ENABLED === 'true',
    databaseUrl: hasEnv(env, 'DATABASE_URL'),
    databaseReadUrl: hasEnv(env, 'DATABASE_READ_URL'),
    indexerKey: hasEnv(env, 'INDEXER_KEY'),
    cronSecret: hasEnv(env, 'CRON_SECRET'),
  };

  const turnkey = {
    policiesEnabled: runtimeEnv.policiesEnabled,
    organizationId: hasEnv(env, 'TURNKEY_ORGANIZATION_ID'),
    apiPublicKey: hasEnv(env, 'TURNKEY_API_PUBLIC_KEY'),
    apiPrivateKey: hasEnv(env, 'TURNKEY_API_PRIVATE_KEY'),
    apiBaseUrl: hasEnv(env, 'TURNKEY_API_BASE_URL')
      ? env.TURNKEY_API_BASE_URL.trim()
      : 'https://api.turnkey.com',
    clientOrganizationId: hasEnv(env, 'VITE_TURNKEY_ORGANIZATION_ID'),
    serverConfigured: hasEnv(env, 'TURNKEY_ORGANIZATION_ID')
      && hasEnv(env, 'TURNKEY_API_PUBLIC_KEY')
      && hasEnv(env, 'TURNKEY_API_PRIVATE_KEY'),
    clientConfigured: hasEnv(env, 'VITE_TURNKEY_ORGANIZATION_ID'),
  };
  const juno = {
    apiKey: hasEnv(env, 'JUNO_API_KEY'),
    apiSecret: hasEnv(env, 'JUNO_API_SECRET'),
    bearerToken: hasEnv(env, 'JUNO_BEARER_TOKEN'),
    apiBaseUrl: hasEnv(env, 'JUNO_API_BASE_URL')
      ? env.JUNO_API_BASE_URL.trim()
      : null,
    webhookSecret: hasEnv(env, 'JUNO_WEBHOOK_SECRET'),
    cardCheckoutEnabled: env.JUNO_CARD_CHECKOUT_ENABLED === 'true',
    applePayEnabled: env.JUNO_APPLE_PAY_ENABLED === 'true',
    withdrawalsEnabled: env.JUNO_WITHDRAWALS_ENABLED === 'true',
  };
  juno.configured = Boolean(
    juno.apiKey
    && juno.apiSecret
    && juno.bearerToken
    && juno.apiBaseUrl
    && juno.webhookSecret,
  );

  const configuredPools = [
    ...parseOnchainAddressList(env.ONCHAIN_MARKET_POOL_ADDRESSES),
    ...parseOnchainAddressList(env.ONCHAIN_AMM_ADDRESSES),
  ];
  const configuredSet = new Set(configuredPools);
  const indexedPools = Array.from(new Set(
    protocolPools.map(normalizeAddress).filter(Boolean),
  ));
  const missingPools = indexedPools.filter(pool => !configuredSet.has(pool));
  const policy = {
    configuredPoolCount: configuredSet.size,
    indexedPoolCount: indexedPools.length,
    missingPools,
    coverageError: protocolPoolError,
    autoIncludesIndexedPools: true,
  };

  const deployment = {
    expectedMainnetChainId: ARBITRUM_ONE_CHAIN_ID,
    clientChainId,
    indexerChainId,
    protocolChainId,
    indexerRpc: Boolean(indexerRpc),
    indexerFactoryV1,
    indexerFactoryV2,
    clientFactoryV1: hasEnv(env, 'VITE_PRONOS_ARBITRUM_FACTORY')
      ? env.VITE_PRONOS_ARBITRUM_FACTORY.trim()
      : null,
    clientFactoryV2: hasEnv(env, 'VITE_PRONOS_ARBITRUM_FACTORY_V2')
      ? env.VITE_PRONOS_ARBITRUM_FACTORY_V2.trim()
      : null,
    clientCollateral: hasEnv(env, 'VITE_PRONOS_ARBITRUM_TOKEN')
      ? env.VITE_PRONOS_ARBITRUM_TOKEN.trim()
      : null,
  };

  warnMissing(warnings, env, 'DATABASE_URL');
  warnMissing(warnings, env, 'ONCHAIN_RPC_URL');
  if (!chainId) warnings.push('ONCHAIN_CHAIN_ID missing or 0');
  if (chainId && chainId !== ARBITRUM_ONE_CHAIN_ID) {
    warnings.push(`ONCHAIN_CHAIN_ID=${chainId} is not Arbitrum One (${ARBITRUM_ONE_CHAIN_ID})`);
  }
  warnMissing(warnings, env, 'ONCHAIN_MARKET_FACTORY_ADDRESS');
  warnMissing(warnings, env, 'ONCHAIN_MARKET_FACTORY_V2_ADDRESS');
  warnMissing(warnings, env, 'ONCHAIN_COLLATERAL_ADDRESS');
  warnMissing(warnings, env, 'ONCHAIN_DEPLOYER_SUBORG_ID');
  warnMissing(warnings, env, 'ONCHAIN_DEPLOYER_ADDRESS');
  warnMissing(warnings, env, 'ONCHAIN_RESOLVER_SUBORG_ID');
  warnMissing(warnings, env, 'ONCHAIN_RESOLVER_ADDRESS');
  if (!runtimeEnv.policiesEnabled) {
    warnings.push('TURNKEY_POLICIES_ENABLED is not "true" - Turnkey delegation gated off');
  }
  warnMissing(warnings, env, 'TURNKEY_ORGANIZATION_ID');
  warnMissing(warnings, env, 'TURNKEY_API_PUBLIC_KEY');
  warnMissing(warnings, env, 'TURNKEY_API_PRIVATE_KEY');
  warnMissing(warnings, env, 'VITE_TURNKEY_ORGANIZATION_ID');
  warnMissing(warnings, env, 'INDEXER_KEY');
  warnMissing(warnings, env, 'CRON_SECRET');
  warnMissing(warnings, env, 'JUNO_API_KEY');
  warnMissing(warnings, env, 'JUNO_API_SECRET');
  warnMissing(warnings, env, 'JUNO_BEARER_TOKEN');
  warnMissing(warnings, env, 'JUNO_API_BASE_URL');
  warnMissing(warnings, env, 'JUNO_WEBHOOK_SECRET');

  if (!indexerRpc) {
    warnings.push('Indexer RPC missing - set ARB_RPC_URL or ARB_MAINNET_RPC');
  }
  if (factoryV1 && !indexerFactoryV1) {
    warnings.push('Indexer V1 factory alias missing - set FACTORY_ADDRESS or PRONOS_FACTORY_ADDRESS');
  }
  if (factoryV2 && !indexerFactoryV2) {
    warnings.push('Indexer V2 factory alias missing - set FACTORY_V2_ADDRESS or PRONOS_FACTORY_V2_ADDRESS');
  }
  if (!hasEnv(env, 'VITE_ONCHAIN_CHAIN_ID')) {
    warnings.push('VITE_ONCHAIN_CHAIN_ID missing');
  }
  if (factoryV1 && !hasEnv(env, 'VITE_PRONOS_ARBITRUM_FACTORY')) {
    warnings.push('VITE_PRONOS_ARBITRUM_FACTORY missing');
  }
  if (factoryV2 && !hasEnv(env, 'VITE_PRONOS_ARBITRUM_FACTORY_V2')) {
    warnings.push('VITE_PRONOS_ARBITRUM_FACTORY_V2 missing');
  }
  if (collateral && !hasEnv(env, 'VITE_PRONOS_ARBITRUM_TOKEN')) {
    warnings.push('VITE_PRONOS_ARBITRUM_TOKEN missing');
  }

  warnChainMismatch(warnings, env, 'VITE_ONCHAIN_CHAIN_ID', chainId, 'ONCHAIN_CHAIN_ID');
  warnChainMismatch(warnings, env, 'CHAIN_ID', chainId, 'ONCHAIN_CHAIN_ID');
  warnChainMismatch(warnings, env, 'PROTOCOL_CHAIN_ID', chainId, 'ONCHAIN_CHAIN_ID');
  warnAddressMismatch(warnings, env, 'FACTORY_ADDRESS', factoryV1, 'ONCHAIN_MARKET_FACTORY_ADDRESS');
  warnAddressMismatch(warnings, env, 'PRONOS_FACTORY_ADDRESS', factoryV1, 'ONCHAIN_MARKET_FACTORY_ADDRESS');
  warnAddressMismatch(warnings, env, 'VITE_PRONOS_ARBITRUM_FACTORY', factoryV1, 'ONCHAIN_MARKET_FACTORY_ADDRESS');
  warnAddressMismatch(warnings, env, 'FACTORY_V2_ADDRESS', factoryV2, 'ONCHAIN_MARKET_FACTORY_V2_ADDRESS');
  warnAddressMismatch(warnings, env, 'PRONOS_FACTORY_V2_ADDRESS', factoryV2, 'ONCHAIN_MARKET_FACTORY_V2_ADDRESS');
  warnAddressMismatch(warnings, env, 'VITE_PRONOS_ARBITRUM_FACTORY_V2', factoryV2, 'ONCHAIN_MARKET_FACTORY_V2_ADDRESS');
  warnAddressMismatch(warnings, env, 'VITE_PRONOS_ARBITRUM_TOKEN', collateral, 'ONCHAIN_COLLATERAL_ADDRESS');

  if (policy.coverageError) {
    warnings.push(`protocol pool coverage check failed: ${String(policy.coverageError).slice(0, 160)}`);
  }
  return {
    ok: warnings.length === 0,
    env: runtimeEnv,
    turnkey,
    juno,
    deployment,
    policy,
    warnings,
  };
}
