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
  137: {
    factory: null,
    token: null,
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  },
  // Arbitrum Sepolia (testnet)
  421614: {
    factory: envAddress('VITE_PRONOS_ARB_SEPOLIA_FACTORY'),
    token: envAddress('VITE_PRONOS_ARB_SEPOLIA_TOKEN'),
    usdc: envAddress('VITE_PRONOS_ARB_SEPOLIA_USDC') || '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  },
  // Arbitrum One (mainnet)
  42161: {
    factory: envAddress('VITE_PRONOS_ARBITRUM_FACTORY'),
    token: envAddress('VITE_PRONOS_ARBITRUM_TOKEN'),
    usdc: envAddress('VITE_PRONOS_ARBITRUM_USDC') || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
};

export function getContracts(chainId) {
  return CONTRACTS[chainId] || null;
}

export function getUsdcAddress(chainId) {
  return CONTRACTS[chainId]?.usdc || null;
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

const CHAIN_IDS = {
  polygon: 137,
  arbitrum: 42161,
  arbitrumSepolia: 421614,
};

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

/**
 * Switch the wallet to the required chain for the current protocol mode.
 * @param {object} wallet - Privy wallet object (from useWallets)
 */
export async function switchToRequiredChain(wallet, testnet = true) {
  const requiredChainId = getRequiredChainId(testnet);
  const currentChainId = await wallet.getChainId?.();
  if (currentChainId !== `eip155:${requiredChainId}`) {
    await wallet.switchChain(requiredChainId);
  }
  return requiredChainId;
}

export { CHAIN_IDS };
