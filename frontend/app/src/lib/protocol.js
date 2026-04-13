/**
 * Protocol Switch — Toggle between Polymarket aggregator and own Pronos protocol.
 *
 * Stored in localStorage so it persists. When "own" mode is enabled,
 * the admin panel shows contract management tools and markets route
 * to the on-chain AMM instead of Polymarket CLOB.
 */

const PROTOCOL_KEY = 'pronos-protocol-mode';
const envAddress = (name) => {
  const value = import.meta.env[name];
  return value && value !== '0x0000000000000000000000000000000000000000' ? value : null;
};

export const CHAIN_IDS = Object.freeze({
  polygon: 137,
  arbitrum: 42161,
  arbitrumSepolia: 421614,
});

export const CHAIN_CONFIGS = Object.freeze({
  [CHAIN_IDS.polygon]: {
    chainId: CHAIN_IDS.polygon,
    name: 'Polygon',
    shortName: 'Polygon',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    rpcUrls: ['https://polygon-rpc.com'],
    blockExplorerUrls: ['https://polygonscan.com'],
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  },
  [CHAIN_IDS.arbitrumSepolia]: {
    chainId: CHAIN_IDS.arbitrumSepolia,
    name: 'Arbitrum Sepolia',
    shortName: 'Arb Sepolia',
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://sepolia.arbiscan.io'],
    nativeCurrency: { name: 'Arbitrum Sepolia Ether', symbol: 'ETH', decimals: 18 },
  },
  [CHAIN_IDS.arbitrum]: {
    chainId: CHAIN_IDS.arbitrum,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://arbiscan.io'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
});

export function getProtocolMode() {
  return localStorage.getItem(PROTOCOL_KEY) || 'polymarket';
}

export function setProtocolMode(mode) {
  if (mode !== 'polymarket' && mode !== 'own') {
    throw new Error('Invalid protocol mode: ' + mode);
  }
  localStorage.setItem(PROTOCOL_KEY, mode);
  window.dispatchEvent(new CustomEvent('pronos-protocol-change', { detail: mode }));
}

export function isOwnProtocol() {
  return getProtocolMode() === 'own';
}

/**
 * Check if user has admin access.
 * Now uses the isAdmin flag from the server response, not a client-side list.
 * Pass the flag directly from the /api/user response.
 */
export function isAdmin(adminFlag) {
  return adminFlag === true;
}

// ─── Contract addresses per chain ─────────────────────────────────────────

export const CONTRACTS = {
  // Polygon (Polymarket)
  [CHAIN_IDS.polygon]: {
    factory: null,
    token: null,
    usdc: CHAIN_CONFIGS[CHAIN_IDS.polygon].usdc,
  },
  // Arbitrum Sepolia (testnet)
  [CHAIN_IDS.arbitrumSepolia]: {
    factory: envAddress('VITE_PRONOS_ARB_SEPOLIA_FACTORY'),
    token: envAddress('VITE_PRONOS_ARB_SEPOLIA_TOKEN'),
    usdc: envAddress('VITE_PRONOS_ARB_SEPOLIA_USDC') || CHAIN_CONFIGS[CHAIN_IDS.arbitrumSepolia].usdc,
  },
  // Arbitrum One (mainnet)
  [CHAIN_IDS.arbitrum]: {
    factory: envAddress('VITE_PRONOS_ARBITRUM_FACTORY'),
    token: envAddress('VITE_PRONOS_ARBITRUM_TOKEN'),
    usdc: envAddress('VITE_PRONOS_ARBITRUM_USDC') || CHAIN_CONFIGS[CHAIN_IDS.arbitrum].usdc,
  },
};

export function getContracts(chainId) {
  return CONTRACTS[chainId] || null;
}

export function getUsdcAddress(chainId) {
  return CONTRACTS[chainId]?.usdc || null;
}

export function getChainConfig(chainId) {
  return CHAIN_CONFIGS[Number(chainId)] || null;
}

export function getChainDisplayName(chainId) {
  return getChainConfig(chainId)?.name || `Chain ${chainId}`;
}

// ─── Market source detection ──────────────────────────────────────────────

/**
 * Determine if a market is from Polymarket or own protocol.
 * Own protocol markets have a numeric `protocolMarketId`.
 */
export function isProtocolMarket(market) {
  return market && market.source === 'protocol';
}

export function isPolymarket(market) {
  return !market || market.source !== 'protocol';
}

// ─── Network switching ───────────────────────────────────────────────────

/**
 * Get the required chain ID based on current protocol mode.
 * Polymarket → Polygon, Own protocol → Arbitrum (or Arbitrum Sepolia for testnet)
 */
export function getRequiredChainId(testnet = true) {
  const mode = getProtocolMode();
  if (mode === 'own') {
    return testnet ? CHAIN_IDS.arbitrumSepolia : CHAIN_IDS.arbitrum;
  }
  return CHAIN_IDS.polygon;
}

export function normalizeWalletChainId(chainId) {
  if (typeof chainId === 'number') return chainId;
  if (typeof chainId !== 'string') return null;
  if (chainId.startsWith('eip155:')) return Number(chainId.slice('eip155:'.length));
  if (chainId.startsWith('0x')) return Number.parseInt(chainId, 16);
  return Number(chainId);
}

async function getProviderChainId(provider) {
  if (!provider?.request) return null;
  try {
    return normalizeWalletChainId(await provider.request({ method: 'eth_chainId' }));
  } catch {
    return null;
  }
}

async function waitForWalletProviderChain(wallet, chainId) {
  for (let i = 0; i < 10; i++) {
    const provider = await wallet.getEthereumProvider?.();
    const providerChainId = await getProviderChainId(provider);
    if (providerChainId === chainId) return true;

    if (providerChainId == null) {
      const walletChainId = normalizeWalletChainId(await wallet.getChainId?.());
      if (walletChainId === chainId) return true;
    }

    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return false;
}

function isUnknownChainError(err) {
  const code = err?.code ?? err?.data?.originalError?.code;
  const message = String(err?.message || err?.data?.message || '').toLowerCase();
  return code === 4902
    || message.includes('unrecognized chain')
    || message.includes('unknown chain')
    || message.includes('not added')
    || message.includes('not configured');
}

/**
 * Switch to a chain and add it to the wallet if the wallet does not know it.
 * This helps Vivaldi/MetaMask-style injected wallets on Arbitrum Sepolia.
 */
export async function switchWalletChain(wallet, chainId) {
  const numericChainId = Number(chainId);
  let provider = await wallet.getEthereumProvider?.();
  const currentChainId = (await getProviderChainId(provider)) ?? normalizeWalletChainId(await wallet.getChainId?.());
  if (currentChainId === numericChainId) return numericChainId;

  try {
    await wallet.switchChain(numericChainId);
    if (await waitForWalletProviderChain(wallet, numericChainId)) return numericChainId;
  } catch (err) {
    if (!isUnknownChainError(err)) throw err;
  }

  const config = getChainConfig(numericChainId);
  provider = await wallet.getEthereumProvider?.();
  if (!config || !provider?.request) {
    await wallet.switchChain(numericChainId);
    if (!(await waitForWalletProviderChain(wallet, numericChainId))) {
      throw new Error(`La wallet no cambio a ${getChainDisplayName(numericChainId)}. Cambia la red manualmente y vuelve a intentar.`);
    }
    return numericChainId;
  }

  const hexChainId = `0x${numericChainId.toString(16)}`;
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  } catch (switchErr) {
    if (!isUnknownChainError(switchErr)) throw switchErr;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: hexChainId,
        chainName: config.name,
        nativeCurrency: config.nativeCurrency,
        rpcUrls: config.rpcUrls,
        blockExplorerUrls: config.blockExplorerUrls,
      }],
    });
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  }

  if (!(await waitForWalletProviderChain(wallet, numericChainId))) {
    throw new Error(`La wallet no cambio a ${getChainDisplayName(numericChainId)}. Cambia la red manualmente y vuelve a intentar.`);
  }

  return numericChainId;
}

/**
 * Switch the wallet to the required chain for the current protocol mode.
 * @param {object} wallet - Privy wallet object (from useWallets)
 */
export async function switchToRequiredChain(wallet, testnet = true) {
  const requiredChainId = getRequiredChainId(testnet);
  return switchWalletChain(wallet, requiredChainId);
}
