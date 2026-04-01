/**
 * Gasless transaction support for Pronos Protocol (Arbitrum).
 *
 * When Privy gas sponsorship is enabled in the dashboard, embedded wallet
 * transactions are automatically sponsored. This module provides helpers
 * for sending transactions through the Privy wallet with proper gas handling.
 *
 * For external wallets (MetaMask, etc.), transactions use normal gas.
 */

import { ethers } from 'ethers';
import { getUsdcAddress } from './protocol.js';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

/**
 * Send a transaction through Privy's embedded wallet.
 * If gas sponsorship is enabled in Privy dashboard, this will be gasless.
 * Falls back to normal gas for external wallets.
 */
export async function sendTransaction(wallet, txData) {
  const provider = await wallet.getEthereumProvider();
  const ethersProvider = new ethers.providers.Web3Provider(provider);
  const signer = ethersProvider.getSigner();

  const tx = await signer.sendTransaction(txData);
  return tx.wait();
}

/**
 * Approve USDC spending on the current chain.
 * Uses the chain-aware USDC address from protocol.js.
 */
export async function approveUsdcOnChain(wallet, spender, amount = ethers.constants.MaxUint256) {
  const provider = await wallet.getEthereumProvider();
  const ethersProvider = new ethers.providers.Web3Provider(provider);
  const signer = ethersProvider.getSigner();
  const network = await ethersProvider.getNetwork();

  const usdcAddr = getUsdcAddress(network.chainId);
  if (!usdcAddr) throw new Error('USDC not configured for this chain');

  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, signer);
  const tx = await usdc.approve(spender, amount);
  return tx.wait();
}

/**
 * Get USDC balance on the current chain.
 */
export async function getUsdcBalanceOnChain(wallet) {
  const provider = await wallet.getEthereumProvider();
  const ethersProvider = new ethers.providers.Web3Provider(provider);
  const signer = ethersProvider.getSigner();
  const address = await signer.getAddress();
  const network = await ethersProvider.getNetwork();

  const usdcAddr = getUsdcAddress(network.chainId);
  if (!usdcAddr) return 0;

  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, ethersProvider);
  const raw = await usdc.balanceOf(address);
  return Number(ethers.utils.formatUnits(raw, 6));
}

/**
 * Check if the connected wallet is a Privy embedded wallet.
 * Embedded wallets support gas sponsorship when enabled.
 */
export function isEmbeddedWallet(wallet) {
  return wallet?.walletClientType === 'privy';
}
