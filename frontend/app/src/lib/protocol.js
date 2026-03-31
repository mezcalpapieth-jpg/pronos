/**
 * Protocol Switch — Toggle between Polymarket aggregator and own Pronos protocol.
 *
 * Stored in localStorage so it persists. When "own" mode is enabled,
 * the admin panel shows contract management tools and markets route
 * to the on-chain AMM instead of Polymarket CLOB.
 */

const PROTOCOL_KEY = 'pronos-protocol-mode';

export function getProtocolMode() {
  return localStorage.getItem(PROTOCOL_KEY) || 'polymarket';
}

export function setProtocolMode(mode) {
  if (mode !== 'polymarket' && mode !== 'own') {
    throw new Error('Invalid protocol mode: ' + mode);
  }
  localStorage.setItem(PROTOCOL_KEY, mode);
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

const CONTRACTS = {
  // Base Sepolia (testnet)
  84532: {
    factory: null,  // Set after deployment
    token: null,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
  // Base Mainnet
  8453: {
    factory: null,
    token: null,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
};

export function getContracts(chainId) {
  return CONTRACTS[chainId] || null;
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
  base: 8453,
  baseSepolia: 84532,
};

/**
 * Get the required chain ID based on current protocol mode.
 * Polymarket → Polygon, Own protocol → Base (or Base Sepolia for testnet)
 */
export function getRequiredChainId(testnet = true) {
  const mode = getProtocolMode();
  if (mode === 'own') {
    return testnet ? CHAIN_IDS.baseSepolia : CHAIN_IDS.base;
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
