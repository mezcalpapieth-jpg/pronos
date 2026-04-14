/**
 * Pronos Protocol — Contract Interaction Library
 *
 * Wraps ethers.js calls to MarketFactory, PronosAMM, and PronosToken.
 * Designed to work with both embedded (Privy) and external wallets.
 *
 * Usage:
 *   import { getProtocolContracts, buyShares, sellShares, ... } from './contracts.js';
 *   const { factory, amm, token } = getProtocolContracts(signer, chainId);
 */

import { ethers } from 'ethers';
import { CONTRACTS, getRequiredChainId } from './protocol.js';

// ─── ABIs ─────────────────────────────────────────────────────────────────────

export const FACTORY_ABI = [
  'function createMarket(string question, string category, uint256 endTime, string resolutionSource, uint256 seedAmount) external returns (uint256)',
  'function resolveMarket(uint256 marketId, uint8 outcome) external',
  'function pauseMarket(uint256 marketId, bool paused) external',
  'function distributeFees() external',
  'function transferOwnership(address newOwner) external',
  'function setResolver(address newResolver) external',
  'function owner() view returns (address)',
  'function resolver() view returns (address)',
  'function marketCount() view returns (uint256)',
  'function markets(uint256) view returns (address pool, string question, string category, uint256 endTime, string resolutionSource, bool active)',
  'function token() view returns (address)',
  'function collateral() view returns (address)',
  'event MarketCreated(uint256 indexed marketId, address pool, string question, string category, uint256 endTime)',
  'event MarketResolved(uint256 indexed marketId, uint8 outcome)',
];

export const AMM_ABI = [
  'function buy(bool buyYes, uint256 collateralAmount) external returns (uint256 sharesOut)',
  'function sell(bool sellYes, uint256 sharesAmount) external returns (uint256 collateralOut)',
  'function redeem(uint256 amount) external',
  'function priceYes() view returns (uint256)',
  'function priceNo() view returns (uint256)',
  'function currentFeeBps(bool buyYes) view returns (uint256)',
  'function estimateBuy(bool buyYes, uint256 collateralAmount) view returns (uint256)',
  'function estimateSell(bool sellYes, uint256 sharesAmount) view returns (uint256)',
  'function calculateFee(uint256 amount, bool buyYes) view returns (uint256)',
  'function reserveYes() view returns (uint256)',
  'function reserveNo() view returns (uint256)',
  'function outcome() view returns (uint8)',
  'function paused() view returns (bool)',
  'function initialized() view returns (bool)',
  'event SharesBought(address indexed buyer, bool isYes, uint256 collateralIn, uint256 fee, uint256 sharesOut)',
  'event SharesSold(address indexed seller, bool isYes, uint256 sharesIn, uint256 collateralOut, uint256 fee)',
];

export const TOKEN_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
  'function nextMarketId() view returns (uint256)',
];

export const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

// ─── Contract instances ───────────────────────────────────────────────────────

/**
 * Get contract instances for the protocol.
 * @param {ethers.Signer} signer — Connected wallet signer
 * @param {number} chainId — Chain ID (421614 for testnet, 42161 for mainnet)
 * @returns {{ factory, usdc }} — Contract instances (AMM is per-market)
 */
export function getProtocolContracts(signer, chainId) {
  const addrs = CONTRACTS[chainId];
  if (!addrs?.factory) throw new Error(`No contract addresses for chain ${chainId}`);

  return {
    factory: new ethers.Contract(addrs.factory, FACTORY_ABI, signer),
    usdc: new ethers.Contract(addrs.usdc, ERC20_ABI, signer),
  };
}

/**
 * Get an AMM contract instance for a specific market.
 * @param {string} poolAddress — The AMM pool address
 * @param {ethers.Signer} signer
 * @returns {ethers.Contract}
 */
export function getAMMContract(poolAddress, signer) {
  return new ethers.Contract(poolAddress, AMM_ABI, signer);
}

/**
 * Get the token contract.
 * @param {string} tokenAddress
 * @param {ethers.Signer|ethers.Provider} signerOrProvider
 * @returns {ethers.Contract}
 */
export function getTokenContract(tokenAddress, signerOrProvider) {
  return new ethers.Contract(tokenAddress, TOKEN_ABI, signerOrProvider);
}

// ─── Read functions ───────────────────────────────────────────────────────────

/**
 * Get current YES/NO prices from an AMM pool.
 * @param {ethers.Provider} provider
 * @param {string} poolAddress
 * @returns {Promise<{yes: number, no: number}>} — Prices as decimals (0-1)
 */
export async function getPoolPrices(provider, poolAddress) {
  const amm = new ethers.Contract(poolAddress, AMM_ABI, provider);
  const [yesRaw, noRaw] = await Promise.all([amm.priceYes(), amm.priceNo()]);
  // Prices are in 1e18 format
  return {
    yes: parseFloat(ethers.utils.formatEther(yesRaw)),
    no: parseFloat(ethers.utils.formatEther(noRaw)),
  };
}

/**
 * Get reserves from an AMM pool.
 * @param {ethers.Provider} provider
 * @param {string} poolAddress
 * @returns {Promise<{yes: string, no: string}>} — Reserves as formatted strings
 */
export async function getPoolReserves(provider, poolAddress) {
  const amm = new ethers.Contract(poolAddress, AMM_ABI, provider);
  const [yesRaw, noRaw] = await Promise.all([amm.reserveYes(), amm.reserveNo()]);
  return {
    yes: ethers.utils.formatUnits(yesRaw, 6), // USDC decimals
    no: ethers.utils.formatUnits(noRaw, 6),
  };
}

/**
 * Estimate shares received for a buy.
 * @param {ethers.Provider} provider
 * @param {string} poolAddress
 * @param {boolean} buyYes — true for YES, false for NO
 * @param {string} amount — USDC amount (human-readable, e.g. "10")
 * @returns {Promise<{shares: string, fee: string}>}
 */
export async function estimateBuy(provider, poolAddress, buyYes, amount) {
  const amm = new ethers.Contract(poolAddress, AMM_ABI, provider);
  const raw = ethers.utils.parseUnits(amount, 6);
  const [sharesRaw, feeRaw] = await Promise.all([
    amm.estimateBuy(buyYes, raw),
    amm.calculateFee(raw, buyYes),
  ]);
  return {
    shares: ethers.utils.formatUnits(sharesRaw, 6),
    fee: ethers.utils.formatUnits(feeRaw, 6),
  };
}

/**
 * Estimate collateral received for a sell.
 * @param {ethers.Provider} provider
 * @param {string} poolAddress
 * @param {boolean} sellYes
 * @param {string} sharesAmount — shares (human-readable)
 * @returns {Promise<string>} — Collateral out
 */
export async function estimateSell(provider, poolAddress, sellYes, sharesAmount) {
  const amm = new ethers.Contract(poolAddress, AMM_ABI, provider);
  const raw = ethers.utils.parseUnits(sharesAmount, 6);
  const out = await amm.estimateSell(sellYes, raw);
  return ethers.utils.formatUnits(out, 6);
}

/**
 * Get user's YES/NO share balances for a market.
 * @param {ethers.Provider} provider
 * @param {string} tokenAddress — PronosToken address
 * @param {string} userAddress
 * @param {number} marketId
 * @returns {Promise<{yes: string, no: string}>}
 */
export async function getShareBalances(provider, tokenAddress, userAddress, marketId) {
  const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
  const yesTokenId = marketId * 2;
  const noTokenId = marketId * 2 + 1;
  const [yesRaw, noRaw] = await token.balanceOfBatch(
    [userAddress, userAddress],
    [yesTokenId, noTokenId],
  );
  return {
    yes: ethers.utils.formatUnits(yesRaw, 6),
    no: ethers.utils.formatUnits(noRaw, 6),
  };
}

// ─── Write functions ──────────────────────────────────────────────────────────

/**
 * Buy shares in a market.
 * @param {ethers.Signer} signer
 * @param {string} poolAddress
 * @param {string} usdcAddress
 * @param {boolean} buyYes
 * @param {string} amount — USDC amount (human-readable)
 * @returns {Promise<ethers.TransactionReceipt>}
 */
export async function buyShares(signer, poolAddress, usdcAddress, buyYes, amount) {
  const raw = ethers.utils.parseUnits(amount, 6);

  // 1. Approve USDC spend
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
  const addr = await signer.getAddress();
  const allowance = await usdc.allowance(addr, poolAddress);
  if (allowance.lt(raw)) {
    const approveTx = await usdc.approve(poolAddress, raw);
    await approveTx.wait();
  }

  // 2. Execute buy
  const amm = new ethers.Contract(poolAddress, AMM_ABI, signer);
  const tx = await amm.buy(buyYes, raw);
  return tx.wait();
}

/**
 * Sell shares in a market.
 * @param {ethers.Signer} signer
 * @param {string} poolAddress
 * @param {string} tokenAddress — PronosToken address
 * @param {boolean} sellYes
 * @param {string} sharesAmount
 * @returns {Promise<ethers.TransactionReceipt>}
 */
export async function sellShares(signer, poolAddress, tokenAddress, sellYes, sharesAmount) {
  const raw = ethers.utils.parseUnits(sharesAmount, 6);

  // 1. Approve ERC-1155 transfer (setApprovalForAll if not already)
  const token = new ethers.Contract(tokenAddress, [
    ...TOKEN_ABI,
    'function isApprovedForAll(address owner, address operator) view returns (bool)',
    'function setApprovalForAll(address operator, bool approved)',
  ], signer);
  const addr = await signer.getAddress();
  const approved = await token.isApprovedForAll(addr, poolAddress);
  if (!approved) {
    const approveTx = await token.setApprovalForAll(poolAddress, true);
    await approveTx.wait();
  }

  // 2. Execute sell
  const amm = new ethers.Contract(poolAddress, AMM_ABI, signer);
  const tx = await amm.sell(sellYes, raw);
  return tx.wait();
}

/**
 * Redeem winning shares after market resolution.
 * @param {ethers.Signer} signer
 * @param {string} poolAddress
 * @param {string} amount — shares to redeem
 * @returns {Promise<ethers.TransactionReceipt>}
 */
export async function redeemShares(signer, poolAddress, amount) {
  const raw = ethers.utils.parseUnits(amount, 6);
  const amm = new ethers.Contract(poolAddress, AMM_ABI, signer);
  const tx = await amm.redeem(raw);
  return tx.wait();
}

/**
 * Create a binary market on the Pronos protocol and seed its first liquidity.
 * The MarketFactory pulls seed USDC from the admin, so approval goes to the
 * factory before calling createMarket.
 *
 * @param {ethers.Signer} signer
 * @param {number} chainId
 * @param {{ question: string, category: string, endTime: number, resolutionSource: string, seedAmount: string }} market
 * @returns {Promise<{ receipt: ethers.TransactionReceipt, marketId?: number, poolAddress?: string }>}
 */
export async function createProtocolMarket(signer, chainId, market) {
  const { factory, usdc } = getProtocolContracts(signer, chainId);
  const seedRaw = ethers.utils.parseUnits(String(market.seedAmount), 6);
  const admin = await signer.getAddress();
  const owner = await factory.owner();
  if (owner.toLowerCase() !== admin.toLowerCase()) {
    throw new Error(`Esta wallet no es owner del MarketFactory. Conecta ${owner} o redeploya el protocolo con tu wallet como ADMIN_ADDRESS.`);
  }

  const balance = await usdc.balanceOf(admin);
  if (balance.lt(seedRaw)) {
    throw new Error(`Tu wallet admin tiene ${ethers.utils.formatUnits(balance, 6)} USDC. Necesitas al menos ${market.seedAmount} USDC en ${admin}.`);
  }

  const allowance = await usdc.allowance(admin, factory.address);
  if (allowance.lt(seedRaw)) {
    const approveTx = await usdc.approve(factory.address, seedRaw);
    await approveTx.wait();
  }

  const tx = await factory.createMarket(
    market.question,
    market.category,
    market.endTime,
    market.resolutionSource,
    seedRaw,
  );
  const receipt = await tx.wait();
  const createdEvent = receipt.events?.find((event) => event.event === 'MarketCreated');

  return {
    receipt,
    marketId: createdEvent?.args?.marketId?.toNumber?.(),
    poolAddress: createdEvent?.args?.pool,
  };
}

/**
 * Get all market info from the factory.
 * @param {ethers.Provider} provider
 * @param {string} factoryAddress
 * @returns {Promise<Array>} — Array of market data
 */
export async function getAllMarkets(provider, factoryAddress) {
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
  const count = await factory.marketCount();
  const markets = [];
  for (let i = 0; i < count.toNumber(); i++) {
    const m = await factory.markets(i);
    markets.push({
      id: i,
      pool: m.pool,
      question: m.question,
      category: m.category,
      endTime: m.endTime.toNumber(),
      resolutionSource: m.resolutionSource,
      active: m.active,
    });
  }
  return markets;
}
