/**
 * Protocol Switch — Toggle between Polymarket aggregator and own Pronos protocol.
 *
 * Stored in localStorage so it persists. When "own" mode is enabled,
 * the admin panel shows contract management tools and markets route
 * to the on-chain AMM instead of Polymarket CLOB.
 */

// Usernames that can access the admin panel
const ADMIN_USERNAMES = ['mezcal', 'frmm'];

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
 * Check if a username has admin access.
 */
export function isAdmin(username) {
  if (!username) return false;
  return ADMIN_USERNAMES.includes(username.toLowerCase());
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
