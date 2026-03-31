/**
 * Safe Multisig Integration for Pronos Admin Panel
 *
 * Provides functions to:
 * - Create new Safe multisigs (admin 3/5, resolver 2/3)
 * - Propose transactions to Safe (market resolution, pause, fee distribution)
 * - Sign pending transactions
 * - Execute transactions once threshold is met
 *
 * Uses @safe-global/protocol-kit + @safe-global/api-kit
 */

import Safe from '@safe-global/protocol-kit';
import SafeApiKit from '@safe-global/api-kit';
import { ethers } from 'ethers';

// ─── Chain Configuration ─────────────────────────────────────────────────

const CHAIN_CONFIG = {
  // Base Sepolia (testnet)
  84532: {
    chainId: 84532n,
    txServiceUrl: 'https://safe-transaction-base-sepolia.safe.global',
    name: 'Base Sepolia',
  },
  // Base Mainnet
  8453: {
    chainId: 8453n,
    txServiceUrl: 'https://safe-transaction-base.safe.global',
    name: 'Base',
  },
};

// ─── Safe addresses (set after creation) ─────────────────────────────────

const SAFE_KEY = 'pronos-safe-config';

function loadSafeConfig() {
  try {
    return JSON.parse(localStorage.getItem(SAFE_KEY)) || {};
  } catch { return {}; }
}

function saveSafeConfig(config) {
  localStorage.setItem(SAFE_KEY, JSON.stringify(config));
}

export function getSafeAddresses(chainId) {
  const config = loadSafeConfig();
  return config[chainId] || { admin: null, resolver: null };
}

export function setSafeAddresses(chainId, admin, resolver) {
  const config = loadSafeConfig();
  config[chainId] = { admin, resolver };
  saveSafeConfig(config);
}

// ─── Factory ABI (only the functions we call via multisig) ───────────────

export const FACTORY_ABI = [
  'function createMarket(string question, string category, uint256 endTime, string resolutionSource, uint256 seedAmount) external returns (uint256)',
  'function resolveMarket(uint256 marketId, uint8 outcome) external',
  'function pauseMarket(uint256 marketId, bool paused) external',
  'function distributeFees() external',
  'function transferOwnership(address newOwner) external',
  'function setResolver(address newResolver) external',
  'function setFeeCollector(address _feeCollector) external',
  'function setTreasury(address _treasury) external',
  'function setLiquidityReserve(address _reserve) external',
  'function setEmergencyReserve(address _reserve) external',
  'function owner() view returns (address)',
  'function resolver() view returns (address)',
  'function marketCount() view returns (uint256)',
];

// ─── Initialize SDK instances ────────────────────────────────────────────

/**
 * Get an ApiKit instance for the given chain.
 */
export function getApiKit(chainId) {
  const config = CHAIN_CONFIG[chainId];
  if (!config) throw new Error(`Unsupported chain: ${chainId}`);
  return new SafeApiKit({ chainId: config.chainId });
}

/**
 * Initialize a Protocol Kit instance connected to an existing Safe.
 * @param {object} provider - EIP-1193 provider (from Privy wallet)
 * @param {string} safeAddress - The Safe address to connect to
 */
export async function getSafeSDK(provider, safeAddress) {
  const ethersProvider = new ethers.providers.Web3Provider(provider);
  const signer = ethersProvider.getSigner();
  const signerAddress = await signer.getAddress();

  return Safe.default.init({
    provider,
    signer: signerAddress,
    safeAddress,
  });
}

// ─── Create Safe ─────────────────────────────────────────────────────────

/**
 * Deploy a new Safe multisig.
 * @param {object} provider - EIP-1193 provider
 * @param {string[]} owners - Array of owner addresses
 * @param {number} threshold - Number of required signatures
 * @returns {{ safeAddress: string }} The deployed Safe address
 */
export async function createSafe(provider, owners, threshold) {
  const ethersProvider = new ethers.providers.Web3Provider(provider);
  const signer = ethersProvider.getSigner();
  const signerAddress = await signer.getAddress();

  const protocolKit = await Safe.default.init({
    provider,
    signer: signerAddress,
    predictedSafe: {
      safeAccountConfig: {
        owners,
        threshold,
      },
    },
  });

  const deploymentResult = await protocolKit.createSafeDeploymentTransaction();
  const txResponse = await signer.sendTransaction({
    to: deploymentResult.to,
    data: deploymentResult.data,
    value: deploymentResult.value,
  });
  await txResponse.wait();

  const safeAddress = await protocolKit.getAddress();
  return { safeAddress, txHash: txResponse.hash };
}

// ─── Propose Transaction ─────────────────────────────────────────────────

/**
 * Propose a transaction to the Safe Transaction Service.
 * The proposer signs it first, then other owners can confirm.
 *
 * @param {object} provider - EIP-1193 provider
 * @param {number} chainId - Chain ID
 * @param {string} safeAddress - Safe multisig address
 * @param {string} to - Target contract address
 * @param {string} data - Encoded function call data
 * @param {string} [value='0'] - ETH value to send
 */
export async function proposeTransaction(provider, chainId, safeAddress, to, data, value = '0') {
  const protocolKit = await getSafeSDK(provider, safeAddress);
  const apiKit = getApiKit(chainId);

  const ethersProvider = new ethers.providers.Web3Provider(provider);
  const signerAddress = await ethersProvider.getSigner().getAddress();

  // Create the Safe transaction
  const safeTransaction = await protocolKit.createTransaction({
    transactions: [{
      to,
      data,
      value,
    }],
  });

  // Sign it
  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);
  const signature = await protocolKit.signHash(safeTxHash);

  // Propose to Transaction Service
  await apiKit.proposeTransaction({
    safeAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: signerAddress,
    senderSignature: signature.data,
  });

  return { safeTxHash };
}

// ─── Confirm (sign) a pending transaction ────────────────────────────────

/**
 * Add a confirmation signature to a pending Safe transaction.
 */
export async function confirmTransaction(provider, chainId, safeAddress, safeTxHash) {
  const protocolKit = await getSafeSDK(provider, safeAddress);
  const apiKit = getApiKit(chainId);

  const signature = await protocolKit.signHash(safeTxHash);

  await apiKit.confirmTransaction(safeTxHash, signature.data);

  return { safeTxHash, signature: signature.data };
}

// ─── Execute a fully-signed transaction ──────────────────────────────────

/**
 * Execute a Safe transaction that has enough confirmations.
 */
export async function executeTransaction(provider, chainId, safeAddress, safeTxHash) {
  const protocolKit = await getSafeSDK(provider, safeAddress);
  const apiKit = getApiKit(chainId);

  const safeTransaction = await apiKit.getTransaction(safeTxHash);
  const result = await protocolKit.executeTransaction(safeTransaction);

  return { txHash: result.hash };
}

// ─── Get pending transactions ────────────────────────────────────────────

/**
 * List pending (awaiting confirmations) transactions for a Safe.
 */
export async function getPendingTransactions(chainId, safeAddress) {
  const apiKit = getApiKit(chainId);
  const response = await apiKit.getPendingTransactions(safeAddress);
  return response.results || [];
}

/**
 * Get Safe info (owners, threshold, nonce, etc.)
 */
export async function getSafeInfo(chainId, safeAddress) {
  const apiKit = getApiKit(chainId);
  return apiKit.getSafeInfo(safeAddress);
}

// ─── Helper: encode contract calls ───────────────────────────────────────

const factoryInterface = new ethers.utils.Interface(FACTORY_ABI);

export function encodeResolveMarket(marketId, outcome) {
  return factoryInterface.encodeFunctionData('resolveMarket', [marketId, outcome]);
}

export function encodePauseMarket(marketId, paused) {
  return factoryInterface.encodeFunctionData('pauseMarket', [marketId, paused]);
}

export function encodeDistributeFees() {
  return factoryInterface.encodeFunctionData('distributeFees');
}

export function encodeTransferOwnership(newOwner) {
  return factoryInterface.encodeFunctionData('transferOwnership', [newOwner]);
}

export function encodeSetResolver(newResolver) {
  return factoryInterface.encodeFunctionData('setResolver', [newResolver]);
}

export function encodeCreateMarket(question, category, endTime, resolutionSource, seedAmount) {
  return factoryInterface.encodeFunctionData('createMarket', [
    question, category, endTime, resolutionSource, seedAmount,
  ]);
}
