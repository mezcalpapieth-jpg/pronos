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

function launchItem(id, title, detail, fix) {
  return { id, title, detail, fix };
}

function pushIfMissing(blockers, env, name, id, title, detail) {
  if (!hasEnv(env, name)) {
    blockers.push(launchItem(id, title, detail, `Set ${name}`));
  }
}

function pushIfAnyMissing(blockers, env, names, id, title, detail) {
  const missing = names.filter(name => !hasEnv(env, name));
  if (missing.length > 0) {
    blockers.push(launchItem(id, title, detail, `Set ${missing.join(', ')}`));
  }
}

function uniqueSteps(items) {
  return Array.from(new Set(items.map(item => item.fix).filter(Boolean)));
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
  const ownerControls = {
    adminSafe: firstEnv(env, ['ADMIN_SAFE_ADDRESS', 'VITE_PRONOS_ARBITRUM_ADMIN_SAFE']),
    resolverSafe: firstEnv(env, ['RESOLVER_SAFE_ADDRESS', 'VITE_PRONOS_ARBITRUM_RESOLVER_SAFE']),
    ownerSuborgId: hasEnv(env, 'ONCHAIN_OWNER_SUBORG_ID'),
    ownerAddress: hasEnv(env, 'ONCHAIN_OWNER_ADDRESS')
      ? env.ONCHAIN_OWNER_ADDRESS.trim()
      : null,
  };
  ownerControls.safeConfigured = Boolean(normalizeAddress(ownerControls.adminSafe));
  ownerControls.resolverSafeConfigured = Boolean(normalizeAddress(ownerControls.resolverSafe));
  ownerControls.ownerSignerConfigured = Boolean(ownerControls.ownerSuborgId && ownerControls.ownerAddress);
  ownerControls.configured = Boolean(ownerControls.safeConfigured || ownerControls.ownerSignerConfigured);

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
  const cre = {
    webhookSecret: hasEnv(env, 'CRE_RESOLUTION_WEBHOOK_SECRET'),
    minConfidenceBps: intEnv(env, 'CRE_RESOLUTION_MIN_CONFIDENCE_BPS') || 9000,
    maxAgeMs: intEnv(env, 'CRE_RESOLUTION_MAX_AGE_MS') || 6 * 60 * 60 * 1000,
  };
  const gas = {
    sponsorshipEnabled: env.GAS_SPONSORSHIP_ENABLED === 'true',
  };

  const blockers = [];
  pushIfMissing(blockers, env, 'DATABASE_URL', 'database_missing', 'Base de datos sin configurar', 'El API no puede crear usuarios, mercados ni historial.');
  pushIfMissing(blockers, env, 'ONCHAIN_RPC_URL', 'rpc_missing', 'RPC on-chain faltante', 'No podemos leer balances ni enviar transacciones.');
  if (!chainId) {
    blockers.push(launchItem('chain_id_missing', 'Chain ID faltante', 'El backend no sabe en qué red operar.', 'Set ONCHAIN_CHAIN_ID=42161'));
  } else if (chainId !== ARBITRUM_ONE_CHAIN_ID) {
    blockers.push(launchItem('chain_id_not_mainnet', 'Chain ID no es Arbitrum One', `ONCHAIN_CHAIN_ID=${chainId}; mainnet requiere ${ARBITRUM_ONE_CHAIN_ID}.`, 'Set ONCHAIN_CHAIN_ID=42161'));
  }
  pushIfAnyMissing(
    blockers,
    env,
    ['ONCHAIN_MARKET_FACTORY_ADDRESS', 'ONCHAIN_MARKET_FACTORY_V2_ADDRESS'],
    'factory_addresses_missing',
    'Factories no configurados',
    'Sin V1/V2 no podemos crear mercados binarios y multi-outcome.',
  );
  pushIfMissing(blockers, env, 'ONCHAIN_COLLATERAL_ADDRESS', 'collateral_missing', 'MXNB no configurado', 'El protocolo no sabe qué token usar como colateral.');
  pushIfAnyMissing(
    blockers,
    env,
    ['ONCHAIN_DEPLOYER_SUBORG_ID', 'ONCHAIN_DEPLOYER_ADDRESS'],
    'deployer_wallet_missing',
    'Wallet deployer Turnkey faltante',
    'La creación automática de mercados necesita sub-org y address del deployer.',
  );
  pushIfAnyMissing(
    blockers,
    env,
    ['ONCHAIN_RESOLVER_SUBORG_ID', 'ONCHAIN_RESOLVER_ADDRESS'],
    'resolver_wallet_missing',
    'Wallet resolver Turnkey faltante',
    'La resolución automática/manual desde admin necesita sub-org y address del resolver.',
  );
  if (!runtimeEnv.policiesEnabled) {
    blockers.push(launchItem(
      'turnkey_policies_disabled',
      'Delegación Turnkey apagada',
      'Los usuarios no podrán operar sin volver a firmar manualmente.',
      'Set TURNKEY_POLICIES_ENABLED=true',
    ));
  }
  pushIfAnyMissing(
    blockers,
    env,
    ['TURNKEY_ORGANIZATION_ID', 'TURNKEY_API_PUBLIC_KEY', 'TURNKEY_API_PRIVATE_KEY', 'VITE_TURNKEY_ORGANIZATION_ID'],
    'turnkey_keys_missing',
    'Turnkey incompleto',
    'Faltan llaves de servidor o configuración cliente.',
  );
  pushIfAnyMissing(
    blockers,
    env,
    ['INDEXER_KEY', 'CRON_SECRET'],
    'ops_keys_missing',
    'Llaves operativas faltantes',
    'Cron/indexer no deben quedar abiertos ni inoperables en mainnet.',
  );
  pushIfAnyMissing(
    blockers,
    env,
    ['JUNO_API_KEY', 'JUNO_API_SECRET', 'JUNO_BEARER_TOKEN', 'JUNO_API_BASE_URL', 'JUNO_WEBHOOK_SECRET'],
    'juno_provider_missing',
    'Juno / Bitso incompleto',
    'El fondeo y los webhooks KYC/onramp no están listos.',
  );
  if (!ownerControls.configured) {
    blockers.push(launchItem(
      'owner_controls_missing',
      'Owner controls no configurados',
      'Cancelaciones, disputas y reembolsos necesitan Safe o signer owner.',
      'Set ADMIN_SAFE_ADDRESS or ONCHAIN_OWNER_SUBORG_ID + ONCHAIN_OWNER_ADDRESS',
    ));
  }

  const reviews = [];
  if (!juno.withdrawalsEnabled) {
    reviews.push(launchItem(
      'juno_withdrawals_manual_queue',
      'Retiros quedan en cola manual',
      'El usuario puede pedir retiro, pero Juno no se invoca automáticamente.',
      'Set JUNO_WITHDRAWALS_ENABLED=true after provider approval',
    ));
  }
  if (!juno.cardCheckoutEnabled && !juno.applePayEnabled) {
    reviews.push(launchItem(
      'juno_checkout_optional_off',
      'Card / Apple Pay apagado',
      'El depósito principal será CLABE/SPEI hasta que Juno habilite checkout.',
      'Set JUNO_CARD_CHECKOUT_ENABLED=true or JUNO_APPLE_PAY_ENABLED=true when available',
    ));
  }
  if (!cre.webhookSecret) {
    reviews.push(launchItem(
      'cre_webhook_dry_run',
      'CRE sigue en modo revisión',
      'Sin secreto, Chainlink CRE no puede enviar resoluciones al webhook.',
      'Set CRE_RESOLUTION_WEBHOOK_SECRET before enabling CRE workflows',
    ));
  }
  if (!gas.sponsorshipEnabled) {
    reviews.push(launchItem(
      'gas_sponsorship_unset',
      'Gas sponsorship no configurado',
      'Turnkey quita popups, pero no cubre ETH de Arbitrum para el usuario.',
      'Set GAS_SPONSORSHIP_ENABLED=true only after relayer/paymaster/funded-wallet support exists',
    ));
  }

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
    ownerControls,
    turnkey,
    juno,
    cre,
    gas,
    deployment,
    policy,
    launch: {
      ready: blockers.length === 0,
      blockerCount: blockers.length,
      reviewCount: reviews.length,
      blockers,
      reviews,
      nextSteps: uniqueSteps([...blockers, ...reviews]),
    },
    warnings,
  };
}
