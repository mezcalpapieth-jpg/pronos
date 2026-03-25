// ─── ON-CHAIN CONTRACT HELPERS ────────────────────────────────────────────────
// Uses ethers v5 via an embedded Privy wallet provider.

import { ethers } from 'ethers';

// Polygon USDC
export const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
export const USDC_DECIMALS = 6;

// Minimal ERC-20 ABI (just what we need)
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

/**
 * Get an ethers provider + signer from a Privy embedded wallet.
 * @param {object} wallet - wallet object from useWallets()
 */
export async function getSignerFromPrivy(wallet) {
  const provider = await wallet.getEthersProvider();
  return provider.getSigner();
}

/**
 * Get USDC balance for an address.
 * @param {ethers.Signer} signer
 * @param {string} address
 * @returns {Promise<string>} formatted balance (e.g. "12.50")
 */
export async function getUsdcBalance(signer, address) {
  const contract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
  const raw = await contract.balanceOf(address);
  return ethers.utils.formatUnits(raw, USDC_DECIMALS);
}

/**
 * Approve a spender to use USDC.
 * @param {ethers.Signer} signer
 * @param {string} spender
 * @param {number} amountUsd  - human-readable USD amount
 */
export async function approveUsdc(signer, spender, amountUsd) {
  const contract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
  const amount = ethers.utils.parseUnits(String(amountUsd), USDC_DECIMALS);
  const tx = await contract.approve(spender, amount);
  await tx.wait();
  return tx;
}
