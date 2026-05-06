import { ethers } from 'ethers';

/**
 * Pronos Protocol — own prediction-market contracts on Arbitrum.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  ARCHITECTURE — own protocol, no third-party aggregator
 * ════════════════════════════════════════════════════════════════════════
 *
 *   Pronos runs ITS OWN smart contracts on Arbitrum. We are not a
 *   Polymarket aggregator and we don't proxy CLOB / Gamma. Markets,
 *   buy/sell, resolution, and redemption all happen against
 *   MarketFactory + PronosAMM (or MarketFactoryV2 + PronosAMMMulti
 *   for multi-outcome).
 *
 *   Earlier iterations had a dual-mode toggle that fed Polymarket
 *   markets into the same UI. That mode is REMOVED. Don't reintroduce
 *   it. If something feels like it needs Polymarket data, it doesn't —
 *   we want our own market for it. (See `lib/gamma.js`,
 *   `lib/polymarketApproved.js`, `lib/polymarketFilter.js` for the
 *   deprecated callers; they're being phased out as their consumers
 *   are migrated.)
 *
 * ════════════════════════════════════════════════════════════════════════
 *  CHAINS — Arbitrum only
 * ════════════════════════════════════════════════════════════════════════
 *
 *   Testnet: Arbitrum Sepolia (chain id 421614)
 *   Mainnet: Arbitrum One (chain id 42161)
 *
 *   No Polygon. No Base. No L1.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  COLLATERAL — MXNB (with a testnet stand-in)
 * ════════════════════════════════════════════════════════════════════════
 *
 *   MXNB is Bitso's MXN-pegged stablecoin on Arbitrum.
 *
 *   Mainnet:  real MXNB at 0xF197FFC28c23E0309B5559e7a166f2c6164C80aA
 *   Testnet:  Circle's official USDC on Arbitrum Sepolia
 *             (0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d) is used as
 *             a stand-in. The website labels it "MXNB" everywhere
 *             regardless of chain — same UX, easier testnet liquidity.
 *
 *   The contracts treat collateral as a generic IERC20, so swapping
 *   between USDC-on-Sepolia and MXNB-on-mainnet is a deploy-time
 *   address change, not a code change.
 */

const READ_PROVIDERS = new Map();
const envAddress = (name) => {
  const value = import.meta.env[name];
  return value && value !== '0x0000000000000000000000000000000000000000' ? value : null;
};

export const CHAIN_IDS = Object.freeze({
  arbitrum: 42161,
  arbitrumSepolia: 421614,
});

export const CHAIN_CONFIGS = Object.freeze({
  [CHAIN_IDS.arbitrumSepolia]: {
    chainId: CHAIN_IDS.arbitrumSepolia,
    name: 'Arbitrum Sepolia',
    shortName: 'Arb Sepolia',
    // Testnet collateral: USDC on Arbitrum Sepolia, displayed as
    // "MXNB" in the UI for parity with mainnet.
    collateral: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://sepolia.arbiscan.io'],
    nativeCurrency: { name: 'Arbitrum Sepolia Ether', symbol: 'ETH', decimals: 18 },
  },
  [CHAIN_IDS.arbitrum]: {
    chainId: CHAIN_IDS.arbitrum,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    // Real MXNB issued by Bitso on Arbitrum One.
    collateral: '0xF197FFC28c23E0309B5559e7a166f2c6164C80aA',
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://arbiscan.io'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
});

// Display label for the collateral token. Always "MXNB" — the testnet
// chain technically uses USDC as a stand-in, but the user-facing label
// stays consistent across environments.
export const COLLATERAL_LABEL = 'MXNB';

// ─── Admin gate ─────────────────────────────────────────────────────────────

/**
 * Check if user has admin access. Adminship is server-evaluated and
 * passed in via the `isAdmin` flag from /api/user — never derive it
 * from a client-side allowlist.
 */
export function isAdmin(adminFlag) {
  return adminFlag === true;
}

// ─── Contract addresses per chain ──────────────────────────────────────────

export const CONTRACTS = {
  [CHAIN_IDS.arbitrumSepolia]: {
    factory:   envAddress('VITE_PRONOS_ARB_SEPOLIA_FACTORY'),
    factoryV2: envAddress('VITE_PRONOS_ARB_SEPOLIA_FACTORY_V2'),
    token:     envAddress('VITE_PRONOS_ARB_SEPOLIA_TOKEN'),
    tokenV2:   envAddress('VITE_PRONOS_ARB_SEPOLIA_TOKEN_V2'),
    collateral: envAddress('VITE_PRONOS_ARB_SEPOLIA_COLLATERAL')
              || CHAIN_CONFIGS[CHAIN_IDS.arbitrumSepolia].collateral,
  },
  [CHAIN_IDS.arbitrum]: {
    factory:   envAddress('VITE_PRONOS_ARBITRUM_FACTORY'),
    factoryV2: envAddress('VITE_PRONOS_ARBITRUM_FACTORY_V2'),
    token:     envAddress('VITE_PRONOS_ARBITRUM_TOKEN'),
    tokenV2:   envAddress('VITE_PRONOS_ARBITRUM_TOKEN_V2'),
    collateral: envAddress('VITE_PRONOS_ARBITRUM_COLLATERAL')
              || CHAIN_CONFIGS[CHAIN_IDS.arbitrum].collateral,
  },
};

export function getContracts(chainId) {
  return CONTRACTS[chainId] || null;
}

/**
 * Address of the collateral token for a given chain. Always labelled
 * "MXNB" in the UI — see COLLATERAL_LABEL.
 */
export function getCollateralAddress(chainId) {
  return CONTRACTS[chainId]?.collateral || null;
}

export function getChainConfig(chainId) {
  return CHAIN_CONFIGS[Number(chainId)] || null;
}

export function getChainDisplayName(chainId) {
  return getChainConfig(chainId)?.name || `Chain ${chainId}`;
}

export function getChainReadProvider(chainId) {
  const numericChainId = Number(chainId);
  const cached = READ_PROVIDERS.get(numericChainId);
  if (cached) return cached;

  const config = getChainConfig(numericChainId);
  const rpcUrl = config?.rpcUrls?.[0];
  if (!rpcUrl) return null;

  const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, numericChainId);
  READ_PROVIDERS.set(numericChainId, provider);
  return provider;
}

// ─── Required chain helper ─────────────────────────────────────────────────

/**
 * The chain Pronos contracts run on. Testnet returns Arbitrum Sepolia,
 * mainnet returns Arbitrum One. There's only one path now — no
 * polymarket / polygon branch.
 */
export function getRequiredChainId(testnet = true) {
  return testnet ? CHAIN_IDS.arbitrumSepolia : CHAIN_IDS.arbitrum;
}

// ─── Wallet chain switching ────────────────────────────────────────────────

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
 * Switch the wallet to a target chain, adding it to the wallet's
 * known networks if necessary (Arbitrum Sepolia in particular needs
 * adding for many wallets).
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
 * Switch the wallet to the required chain (Arbitrum One on mainnet,
 * Arbitrum Sepolia on testnet). Used by buy/sell flows before any
 * write call.
 */
export async function switchToRequiredChain(wallet, testnet = true) {
  const requiredChainId = getRequiredChainId(testnet);
  return switchWalletChain(wallet, requiredChainId);
}

// ─── Deprecated exports kept as no-ops for legacy callers ──────────────────
//
// Kept so the MVP code path (frontend/app/src/components/MarketsGrid.jsx)
// continues to compile while it's being migrated. New code MUST NOT
// import these. Once MarketsGrid is rewritten to fetch protocol
// markets, these can be deleted entirely.
//
// To callers: every Pronos market is a protocol market. There is no
// polymarket source. isProtocolMarket → true. isPolymarket → false.

/** @deprecated Always returns true. All markets are protocol markets. */
export function isProtocolMarket(_market) { return true; }
/** @deprecated Always returns false. Polymarket integration removed. */
export function isPolymarket(_market) { return false; }
/** @deprecated Always returns 'own'. Polymarket mode removed. */
export function getProtocolMode() { return 'own'; }
/** @deprecated No-op. Polymarket mode removed. */
export function setProtocolMode(_mode) { /* no-op */ }
/** @deprecated Always returns true. */
export function isOwnProtocol() { return true; }
/** @deprecated Use getCollateralAddress(chainId) instead. */
export function getUsdcAddress(chainId) { return getCollateralAddress(chainId); }
