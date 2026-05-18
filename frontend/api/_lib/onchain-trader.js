/**
 * On-chain trade dispatcher (M5 — real implementation).
 *
 * Given a mode='onchain' market, builds / signs / broadcasts the
 * buy / sell / redeem transaction(s) and returns a result shape
 * compatible with the DB-mode buy.js / sell.js paths.
 *
 * Signing: via Turnkey's delegated API key, scoped by the user's
 * policy (M2). That means ZERO wallet popups — backend signs within
 * whitelisted contracts + selectors, user experiences the trade as
 * a normal "tap → confirm → done" flow.
 *
 * Collateral flow: before buy, the AMM needs allowance on the
 * collateral (MXNB on Arbitrum One, MockMXNB on testnet). We check
 * allowance; if insufficient, we send a MAX_UINT256 approve() tx
 * first. This spends one extra tx on the user's FIRST trade against
 * a given market, then every subsequent trade against that market
 * skips the approve. In mainnet we can move the approve into the
 * delegation consent flow so it's zero-extra-txs, but M5 keeps it
 * explicit for clarity.
 *
 * Hard-gated: `isOnchainReady()` checks required env vars before
 * any chain call. Off by default on preview/dev.
 */

import { ethers } from 'ethers';
import {
  isDelegationEnabled, signDelegatedTransaction,
} from './turnkey-delegation.js';
import {
  formatProtocolBuyQuote,
  formatProtocolSellQuote,
} from './protocol-trade-guards.js';

// ── Config + ABI ────────────────────────────────────────────────────

const BINARY_AMM_ABI = [
  'function buy(bool buyYes, uint256 collateralAmount) external returns (uint256)',
  'function buy(bool buyYes, uint256 collateralAmount, uint256 minSharesOut) external returns (uint256)',
  'function sell(bool sellYes, uint256 sharesAmount) external returns (uint256)',
  'function sell(bool sellYes, uint256 sharesAmount, uint256 minCollateralOut) external returns (uint256)',
  'function redeem(uint256 amount) external',
  'function calculateFee(uint256 amount, bool buyYes) view returns (uint256)',
  'function estimateBuy(bool buyYes, uint256 collateralAmount) view returns (uint256)',
  'function estimateSell(bool sellYes, uint256 sharesAmount) view returns (uint256)',
  'function priceYes() view returns (uint256)',
  'function priceNo() view returns (uint256)',
  'event SharesBought(address indexed buyer, bool isYes, uint256 collateralIn, uint256 fee, uint256 sharesOut)',
  'event SharesSold(address indexed seller, bool isYes, uint256 sharesIn, uint256 collateralOut, uint256 fee)',
];

const MULTI_AMM_ABI = [
  'function buy(uint8 outcomeIndex, uint256 collateralAmount) external returns (uint256)',
  'function buy(uint8 outcomeIndex, uint256 collateralAmount, uint256 minSharesOut) external returns (uint256)',
  'function sell(uint8 outcomeIndex, uint256 sharesAmount) external returns (uint256)',
  'function sell(uint8 outcomeIndex, uint256 sharesAmount, uint256 minCollateralOut) external returns (uint256)',
  'function redeem(uint256 amount) external',
  'function calculateFee(uint256 amount, uint8 outcomeIndex) view returns (uint256)',
  'function estimateBuy(uint8 outcomeIndex, uint256 collateralAmount) view returns (uint256)',
  'function estimateSell(uint8 outcomeIndex, uint256 sharesAmount) view returns (uint256)',
  'function price(uint8 outcomeIndex) view returns (uint256)',
  'function prices() view returns (uint256[])',
  'event SharesBought(address indexed buyer, uint8 indexed outcomeIndex, uint256 collateralIn, uint256 fee, uint256 sharesOut)',
  'event SharesSold(address indexed seller, uint8 indexed outcomeIndex, uint256 sharesIn, uint256 collateralOut, uint256 fee)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// MarketFactory ABIs — match contracts/src/{MarketFactory,MarketFactoryV2}.sol.
// Mirrors live here so the deployer doesn't import Solidity build
// artifacts at runtime.
//
// V1 (binary, PronosAMM):
//   function createMarket(string q, string cat, uint256 endTime,
//     string resolutionSource, uint256 seed) onlyOwner returns (uint256);
//   function resolveMarket(uint256 marketId, uint8 outcome) onlyResolver;
//   event MarketCreated(uint256 indexed marketId, address pool,
//     string question, string category, uint256 endTime);
//   event MarketResolved(uint256 indexed marketId, uint8 outcome);
//
// V2 (multi-outcome 2..8, PronosAMMMulti):
//   function createMarket(string q, string cat, uint256 endTime,
//     string resolutionSource, string[] outcomes, uint256 seed)
//     onlyOwner returns (uint256);
//   function resolveMarket(uint256 marketId, uint8 outcome) onlyResolver;
//   event MarketCreated(uint256 indexed marketId, address pool,
//     string question, string category, uint256 endTime,
//     string resolutionSource, string[] outcomes);
//   event MarketResolved(uint256 indexed marketId, uint8 outcome);
//
// createMarket is `onlyOwner` ⇒ deployer must equal factory.owner().
// resolveMarket is `onlyResolver` ⇒ resolver wallet must equal
// factory.resolver() (set via setResolver, defaults to owner at deploy).
// `pool` is not indexed in MarketCreated, so we decode it from the data field.
const MARKET_FACTORY_V1_ABI = [
  'function owner() view returns (address)',
  'function resolver() view returns (address)',
  'function collateral() view returns (address)',
  'function createMarket(string question, string category, uint256 endTime, string resolutionSource, uint256 seedAmount) external returns (uint256)',
  'function resolveMarket(uint256 marketId, uint8 outcome) external',
  'function getMarket(uint256 marketId) external view returns (address pool, string question, string category, uint256 endTime, string resolutionSource, bool active)',
  'event MarketCreated(uint256 indexed marketId, address pool, string question, string category, uint256 endTime)',
  'event MarketResolved(uint256 indexed marketId, uint8 outcome)',
];
const MARKET_FACTORY_V2_ABI = [
  'function owner() view returns (address)',
  'function resolver() view returns (address)',
  'function collateral() view returns (address)',
  'function createMarket(string question, string category, uint256 endTime, string resolutionSource, string[] outcomes, uint256 seedAmount) external returns (uint256)',
  'function resolveMarket(uint256 marketId, uint8 outcome) external',
  'event MarketCreated(uint256 indexed marketId, address pool, string question, string category, uint256 endTime, string resolutionSource, string[] outcomes)',
  'event MarketResolved(uint256 indexed marketId, uint8 outcome)',
];

const MAX_UINT256 = ethers.constants.MaxUint256;

// MXNB decimals.
const COLLATERAL_DECIMALS = 6;

/**
 * Every on-chain dep must be present. Falls back to the simulated
 * path when any is missing. Callers pre-check; nothing fires below
 * if this returns false.
 */
export function isOnchainReady() {
  if (!isDelegationEnabled()) return false;
  if (!process.env.ONCHAIN_RPC_URL) return false;
  if (!process.env.ONCHAIN_COLLATERAL_ADDRESS) return false;
  return true;
}

function requireReady() {
  if (!isOnchainReady()) {
    const err = new Error('onchain_not_enabled');
    err.status = 503;
    err.detail = 'set TURNKEY_POLICIES_ENABLED=true + ONCHAIN_RPC_URL + ONCHAIN_COLLATERAL_ADDRESS';
    throw err;
  }
}

function requireReadReady() {
  if (!process.env.ONCHAIN_RPC_URL) {
    const err = new Error('onchain_quote_not_enabled');
    err.status = 503;
    err.detail = 'set ONCHAIN_RPC_URL';
    throw err;
  }
}

function provider() {
  return new ethers.providers.JsonRpcProvider(process.env.ONCHAIN_RPC_URL);
}

function chainId() {
  return Number(process.env.ONCHAIN_CHAIN_ID || 42161);
}

// ── Turnkey-signed tx broadcast ─────────────────────────────────────

/**
 * Compose an unsigned EIP-1559 transaction, hand it to Turnkey to
 * stamp with the user's delegated policy, and broadcast.
 *
 * Returns the receipt after 1 confirmation. Throws with a useful
 * status if any step fails — the endpoint translates to HTTP.
 */
async function signAndBroadcast({ suborgId, from, to, data, gasLimit }) {
  const prov = provider();
  const nonce = await prov.getTransactionCount(from, 'pending');
  const feeData = await prov.getFeeData();

  const unsignedTx = {
    to,
    nonce,
    gasLimit: gasLimit || ethers.BigNumber.from(600_000),
    maxFeePerGas: feeData.maxFeePerGas || ethers.utils.parseUnits('0.1', 'gwei'),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('0.01', 'gwei'),
    data,
    value: 0,
    chainId: chainId(),
    type: 2,
  };

  // ethers v5 serializeTransaction returns 0x-prefixed hex; Turnkey
  // expects the same (they unwrap it). Strip or keep based on SDK
  // behavior — for @turnkey/sdk-server v5, pass with 0x prefix.
  const unsignedSerialized = ethers.utils.serializeTransaction(unsignedTx);

  const signedSerialized = await signDelegatedTransaction({
    suborgId,
    signWithAddress: from,
    unsignedTx: unsignedSerialized,
  });

  const txResponse = await prov.sendTransaction(signedSerialized);
  const receipt = await txResponse.wait(1);
  if (receipt.status !== 1) {
    const err = new Error('tx_reverted');
    err.status = 400;
    err.detail = `tx ${receipt.transactionHash} reverted`;
    throw err;
  }
  return receipt;
}

// ── Collateral allowance (approve once per market) ──────────────────

async function ensureCollateralAllowance({
  suborgId, ownerAddr, ammAddress, amount, collateralAddr = process.env.ONCHAIN_COLLATERAL_ADDRESS,
}) {
  const prov = provider();
  const c = new ethers.Contract(collateralAddr, ERC20_ABI, prov);
  const current = await c.allowance(ownerAddr, ammAddress);
  if (current.gte(amount)) return null;

  const iface = new ethers.utils.Interface(ERC20_ABI);
  const data = iface.encodeFunctionData('approve', [ammAddress, MAX_UINT256]);
  const receipt = await signAndBroadcast({
    suborgId,
    from: ownerAddr,
    to: collateralAddr,
    data,
    gasLimit: ethers.BigNumber.from(100_000),
  });
  return receipt.transactionHash;
}

function sameAddress(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function formatNative(units) {
  return ethers.utils.formatUnits(units, 'ether');
}

function formatCollateral(units) {
  return ethers.utils.formatUnits(units, COLLATERAL_DECIMALS);
}

function decimalString(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid decimal value: ${value}`);
  return n.toFixed(COLLATERAL_DECIMALS);
}

function parseCollateralUnits(value) {
  return ethers.utils.parseUnits(decimalString(value), COLLATERAL_DECIMALS);
}

function toCollateralNumber(units) {
  return Number(formatCollateral(units));
}

function priceToNumber(units) {
  return Number(ethers.utils.formatUnits(units, 6));
}

function extractRevertDetail(err) {
  const raw = [
    err?.error?.message,
    err?.reason,
    err?.message,
  ].find(Boolean);
  if (!raw) return 'unknown revert';
  return String(raw)
    .replace(/^execution reverted:\s*/i, '')
    .replace(/^call reverted:\s*/i, '')
    .trim();
}

// ── Helpers for encode/decode ───────────────────────────────────────

function isBinary(market) {
  const n = Array.isArray(market?.outcomes) ? market.outcomes.length : 2;
  return n === 2;
}

function ammInterface(market) {
  return new ethers.utils.Interface(isBinary(market) ? BINARY_AMM_ABI : MULTI_AMM_ABI);
}

function encodeBuy(market, outcomeIndex, collateralUnits) {
  return encodeBuyWithMinOut(market, outcomeIndex, collateralUnits, ethers.constants.Zero);
}

function encodeBuyWithMinOut(market, outcomeIndex, collateralUnits, minSharesUnits) {
  const iface = ammInterface(market);
  if (isBinary(market)) {
    return iface.encodeFunctionData('buy(bool,uint256,uint256)', [
      outcomeIndex === 0,
      collateralUnits,
      minSharesUnits || ethers.constants.Zero,
    ]);
  }
  return iface.encodeFunctionData('buy(uint8,uint256,uint256)', [
    outcomeIndex,
    collateralUnits,
    minSharesUnits || ethers.constants.Zero,
  ]);
}

function encodeSell(market, outcomeIndex, sharesUnits) {
  return encodeSellWithMinOut(market, outcomeIndex, sharesUnits, ethers.constants.Zero);
}

function encodeSellWithMinOut(market, outcomeIndex, sharesUnits, minCollateralUnits) {
  const iface = ammInterface(market);
  if (isBinary(market)) {
    return iface.encodeFunctionData('sell(bool,uint256,uint256)', [
      outcomeIndex === 0,
      sharesUnits,
      minCollateralUnits || ethers.constants.Zero,
    ]);
  }
  return iface.encodeFunctionData('sell(uint8,uint256,uint256)', [
    outcomeIndex,
    sharesUnits,
    minCollateralUnits || ethers.constants.Zero,
  ]);
}

function encodeRedeem(amount) {
  return new ethers.utils.Interface(BINARY_AMM_ABI).encodeFunctionData('redeem', [amount]);
}

function parseBuyEvent(market, receipt) {
  const iface = ammInterface(market);
  for (const log of receipt.logs || []) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.name === 'SharesBought') {
        return {
          sharesOut: ethers.utils.formatUnits(parsed.args.sharesOut, COLLATERAL_DECIMALS),
          fee: ethers.utils.formatUnits(parsed.args.fee, COLLATERAL_DECIMALS),
          collateralIn: ethers.utils.formatUnits(parsed.args.collateralIn, COLLATERAL_DECIMALS),
        };
      }
    } catch { /* not this ABI's log */ }
  }
  return null;
}

function parseSellEvent(market, receipt) {
  const iface = ammInterface(market);
  for (const log of receipt.logs || []) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.name === 'SharesSold') {
        return {
          sharesIn: ethers.utils.formatUnits(parsed.args.sharesIn, COLLATERAL_DECIMALS),
          collateralOut: ethers.utils.formatUnits(parsed.args.collateralOut, COLLATERAL_DECIMALS),
          fee: ethers.utils.formatUnits(parsed.args.fee, COLLATERAL_DECIMALS),
        };
      }
    } catch { /* skip */ }
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Lookup the user's EVM wallet address for a given sub-org. We store
 * it on points_users.wallet_address at signup; the dispatcher looks
 * it up via the session's username → passed into these helpers.
 * Exposed so callers can pass from= explicitly without a re-query.
 */
export function requireWalletAddress(row) {
  const addr = row?.wallet_address || row?.walletAddress;
  if (!addr || !ethers.utils.isAddress(addr)) {
    const err = new Error('wallet_not_found');
    err.status = 400;
    err.detail = 'user has no on-chain wallet address stored';
    throw err;
  }
  return addr;
}

async function readAmmPrices(amm, market, outcomeIndex) {
  if (isBinary(market)) {
    const values = await Promise.all([amm.priceYes(), amm.priceNo()]);
    const prices = values.map(priceToNumber);
    return {
      priceBefore: prices[outcomeIndex] ?? null,
      pricesBefore: prices,
    };
  }
  const values = await amm.prices();
  const prices = values.map(priceToNumber);
  return {
    priceBefore: prices[outcomeIndex] ?? null,
    pricesBefore: prices,
  };
}

export async function quoteBuyOnChain({ market, outcomeIndex, collateral }) {
  requireReadReady();
  if (!market?.chain_address) throw new Error('market missing chain_address');

  const amm = new ethers.Contract(
    market.chain_address,
    isBinary(market) ? BINARY_AMM_ABI : MULTI_AMM_ABI,
    provider(),
  );
  const collateralUnits = parseCollateralUnits(collateral);
  const [sharesUnits, feeUnits, prices] = await Promise.all([
    isBinary(market)
      ? amm.estimateBuy(outcomeIndex === 0, collateralUnits)
      : amm.estimateBuy(outcomeIndex, collateralUnits),
    isBinary(market)
      ? amm.calculateFee(collateralUnits, outcomeIndex === 0)
      : amm.calculateFee(collateralUnits, outcomeIndex),
    readAmmPrices(amm, market, outcomeIndex),
  ]);

  return formatProtocolBuyQuote({
    collateral: toCollateralNumber(collateralUnits),
    fee: toCollateralNumber(feeUnits),
    sharesOut: toCollateralNumber(sharesUnits),
    priceBefore: prices.priceBefore,
    priceAfter: null,
    pricesBefore: prices.pricesBefore,
    pricesAfter: null,
  });
}

export async function quoteSellOnChain({ market, outcomeIndex, shares }) {
  requireReadReady();
  if (!market?.chain_address) throw new Error('market missing chain_address');

  const amm = new ethers.Contract(
    market.chain_address,
    isBinary(market) ? BINARY_AMM_ABI : MULTI_AMM_ABI,
    provider(),
  );
  const sharesUnits = parseCollateralUnits(shares);
  const [outUnits, prices] = await Promise.all([
    isBinary(market)
      ? amm.estimateSell(outcomeIndex === 0, sharesUnits)
      : amm.estimateSell(outcomeIndex, sharesUnits),
    readAmmPrices(amm, market, outcomeIndex),
  ]);
  const out = toCollateralNumber(outUnits);

  return formatProtocolSellQuote({
    shares: toCollateralNumber(sharesUnits),
    gross: out,
    fee: 0,
    collateralOut: out,
    priceBefore: prices.priceBefore,
    priceAfter: null,
    pricesBefore: prices.pricesBefore,
    pricesAfter: null,
  });
}

export async function buyOnChain({
  suborgId, ownerAddr, market, outcomeIndex, collateral, minSharesOut,
}) {
  requireReady();
  if (!suborgId) throw new Error('suborgId required');
  if (!ownerAddr) throw new Error('ownerAddr required');
  if (!market?.chain_address) throw new Error('market missing chain_address');

  const ammAddr = market.chain_address;
  const collateralUnits = parseCollateralUnits(collateral);
  const minSharesUnits = minSharesOut != null
    ? parseCollateralUnits(minSharesOut)
    : ethers.constants.Zero;

  await ensureCollateralAllowance({
    suborgId, ownerAddr, ammAddress: ammAddr, amount: collateralUnits,
  });

  const data = encodeBuyWithMinOut(market, outcomeIndex, collateralUnits, minSharesUnits);
  const receipt = await signAndBroadcast({
    suborgId, from: ownerAddr, to: ammAddr, data,
  });

  const ev = parseBuyEvent(market, receipt);
  if (!ev) {
    const err = new Error('event_not_found');
    err.status = 500;
    err.detail = 'SharesBought event missing from receipt';
    throw err;
  }
  return {
    sharesOut: Number(ev.sharesOut),
    fee: Number(ev.fee),
    priceBefore: null,   // off-chain quote already rendered; chain
    priceAfter: null,    //   path relies on indexer snapshot
    balance: null,       // indexer refreshes balance async
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
  };
}

export async function sellOnChain({
  suborgId, ownerAddr, market, outcomeIndex, shares, minCollateralOut,
}) {
  requireReady();
  if (!suborgId) throw new Error('suborgId required');
  if (!ownerAddr) throw new Error('ownerAddr required');
  if (!market?.chain_address) throw new Error('market missing chain_address');

  const ammAddr = market.chain_address;
  const sharesUnits = parseCollateralUnits(shares);
  const minCollateralUnits = minCollateralOut != null
    ? parseCollateralUnits(minCollateralOut)
    : ethers.constants.Zero;

  const data = encodeSellWithMinOut(market, outcomeIndex, sharesUnits, minCollateralUnits);
  const receipt = await signAndBroadcast({
    suborgId, from: ownerAddr, to: ammAddr, data,
  });

  const ev = parseSellEvent(market, receipt);
  if (!ev) {
    const err = new Error('event_not_found');
    err.status = 500;
    err.detail = 'SharesSold event missing from receipt';
    throw err;
  }
  return {
    collateralOut: Number(ev.collateralOut),
    fee: Number(ev.fee),
    priceBefore: null,
    priceAfter: null,
    balance: null,
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
  };
}

export async function redeemOnChain({
  suborgId, ownerAddr, market, amount,
}) {
  requireReady();
  if (!suborgId) throw new Error('suborgId required');
  if (!ownerAddr) throw new Error('ownerAddr required');
  if (!market?.chain_address) throw new Error('market missing chain_address');

  const units = ethers.utils.parseUnits(String(amount), COLLATERAL_DECIMALS);
  const data = encodeRedeem(units);
  const receipt = await signAndBroadcast({
    suborgId, from: ownerAddr, to: market.chain_address, data,
  });
  return {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
  };
}

// ── Auto-deploy a new market via MarketFactory ──────────────────────
//
// Dispatches between V1 (binary PronosAMM) and V2 (multi-outcome
// PronosAMMMulti) based on outcomeCount:
//   · 2 outcomes  → V1 (ONCHAIN_MARKET_FACTORY_ADDRESS)
//   · 3..8        → V2 (ONCHAIN_MARKET_FACTORY_V2_ADDRESS)
//   · 9+          → reject; V2's PronosAMMMulti hard-caps at 8
//   · parallel    → caller's responsibility (loop V1 N times); not
//                   handled here, register manually or via DB tooling
//
// Auth: both factories' `createMarket` are `onlyOwner`. The deployer
// wallet (ONCHAIN_DEPLOYER_ADDRESS) must equal `factory.owner()` on
// whichever variant is being called. Each factory needs its OWN
// MAX-approval on the collateral token from the deployer wallet —
// the helper handles that idempotently.
//
// Returns { marketId, marketAddress, txHash, blockNumber, chainId,
//           question, category, factoryVariant }. `marketAddress` is
// the deployed PronosAMM(Multi), which the rest of the system stores
// as `chain_address`.
export async function deployMarketOnChain({
  deployerSuborgId, deployerAddr,
  question, category, outcomeCount, outcomeLabels, endTime,
  resolutionSource, seedAmount,
}) {
  requireReady();
  if (!deployerSuborgId) throw new Error('deployerSuborgId required');
  if (!deployerAddr) throw new Error('deployerAddr required');
  if (typeof question !== 'string' || question.trim().length < 8) {
    throw new Error('question too short');
  }
  if (typeof category !== 'string' || category.trim() === '') {
    throw new Error('category required');
  }
  const n = Number.parseInt(outcomeCount, 10);
  if (!Number.isInteger(n) || n < 2) {
    throw new Error('outcomeCount must be >= 2');
  }
  if (n > 8) {
    const err = new Error('too_many_outcomes_for_v2');
    err.status = 400;
    err.detail = 'PronosAMMMulti hard-caps at MAX_OUTCOMES=8. For 9+ outcomes, paste a contract manually.';
    throw err;
  }

  // Pick factory variant.
  const useV2 = n >= 3;
  const factoryAddr = useV2
    ? process.env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS
    : process.env.ONCHAIN_MARKET_FACTORY_ADDRESS;
  if (!factoryAddr) {
    const err = new Error('factory_not_configured');
    err.status = 503;
    err.detail = useV2
      ? 'set ONCHAIN_MARKET_FACTORY_V2_ADDRESS for multi-outcome auto-deploy'
      : 'set ONCHAIN_MARKET_FACTORY_ADDRESS for binary auto-deploy';
    throw err;
  }
  if (useV2) {
    // V2 needs the actual outcome label strings to seed PronosAMMMulti.
    if (!Array.isArray(outcomeLabels) || outcomeLabels.length !== n) {
      throw new Error('outcomeLabels[] required for multi-outcome auto-deploy');
    }
    if (!outcomeLabels.every(l => typeof l === 'string' && l.trim() !== '')) {
      throw new Error('outcomeLabels entries must be non-empty strings');
    }
  }

  const endTs = Math.floor(new Date(endTime).getTime() / 1000);
  if (!Number.isFinite(endTs) || endTs <= Math.floor(Date.now() / 1000)) {
    throw new Error('endTime must be a future timestamp');
  }
  const seedUnits = ethers.utils.parseUnits(String(seedAmount), COLLATERAL_DECIMALS);
  const resolutionSrc = (typeof resolutionSource === 'string' && resolutionSource.trim())
    ? resolutionSource.trim()
    : 'Pronos admin (manual resolution)';

  const iface = new ethers.utils.Interface(useV2 ? MARKET_FACTORY_V2_ABI : MARKET_FACTORY_V1_ABI);
  const prov = provider();
  const factory = new ethers.Contract(factoryAddr, useV2 ? MARKET_FACTORY_V2_ABI : MARKET_FACTORY_V1_ABI, prov);
  const gasLimit = ethers.BigNumber.from(useV2 ? 6_500_000 : 4_500_000);
  const [factoryOwner, factoryCollateral, feeData, nativeBalance] = await Promise.all([
    factory.owner(),
    factory.collateral(),
    prov.getFeeData(),
    prov.getBalance(deployerAddr),
  ]);
  if (!sameAddress(factoryOwner, deployerAddr)) {
    const err = new Error('deployer_not_factory_owner');
    err.status = 400;
    err.detail = `factory owner=${factoryOwner}, deployer=${deployerAddr}`;
    throw err;
  }
  const collateral = new ethers.Contract(factoryCollateral, ERC20_ABI, prov);
  const collateralBalance = await collateral.balanceOf(deployerAddr);
  if (collateralBalance.lt(seedUnits)) {
    const err = new Error('deployer_insufficient_collateral');
    err.status = 400;
    err.detail = `wallet ${deployerAddr} has ${formatCollateral(collateralBalance)} collateral at ${factoryCollateral}, needs ${formatCollateral(seedUnits)}`;
    throw err;
  }
  const maxFeePerGas = feeData.maxFeePerGas || ethers.utils.parseUnits('0.1', 'gwei');
  const estimatedNative = gasLimit.mul(maxFeePerGas).mul(2);
  if (nativeBalance.lt(estimatedNative)) {
    const err = new Error('deployer_insufficient_gas');
    err.status = 400;
    err.detail = `wallet ${deployerAddr} has ${formatNative(nativeBalance)} ETH, needs at least ~${formatNative(estimatedNative)} ETH for approve + createMarket`;
    throw err;
  }
  if (process.env.ONCHAIN_COLLATERAL_ADDRESS && !sameAddress(process.env.ONCHAIN_COLLATERAL_ADDRESS, factoryCollateral)) {
    const err = new Error('factory_collateral_mismatch');
    err.status = 500;
    err.detail = `env ONCHAIN_COLLATERAL_ADDRESS=${process.env.ONCHAIN_COLLATERAL_ADDRESS} but factory uses ${factoryCollateral}`;
    throw err;
  }
  const data = useV2
    ? iface.encodeFunctionData('createMarket', [
        question.trim(),
        category.trim(),
        endTs,
        resolutionSrc,
        outcomeLabels.map(l => l.trim()),
        seedUnits,
      ])
    : iface.encodeFunctionData('createMarket', [
        question.trim(),
        category.trim(),
        endTs,
        resolutionSrc,
        seedUnits,
      ]);

  // Factory pulls `seedAmount` of collateral via transferFrom(msg.sender, …).
  // Each factory variant needs its own MAX-approval; ensureCollateralAllowance
  // is keyed on (deployer, factoryAddr) so it's idempotent across calls.
  await ensureCollateralAllowance({
    suborgId: deployerSuborgId,
    ownerAddr: deployerAddr,
    ammAddress: factoryAddr,
    amount: seedUnits,
    collateralAddr: factoryCollateral,
  });

  try {
    await prov.call({ from: deployerAddr, to: factoryAddr, data });
  } catch (e) {
    const err = new Error('factory_create_simulation_failed');
    err.status = 400;
    err.detail = extractRevertDetail(e);
    throw err;
  }

  const receipt = await signAndBroadcast({
    suborgId: deployerSuborgId,
    from: deployerAddr,
    to: factoryAddr,
    data,
    // V2 deploys a heavier ERC-1155-aware AMM with N outcome tokens;
    // bump the gas budget vs V1.
    gasLimit,
  });

  let marketId = null;
  let marketAddress = null;
  for (const log of receipt.logs || []) {
    if ((log.address || '').toLowerCase() !== factoryAddr.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'MarketCreated') {
        marketId = parsed.args.marketId?.toString() || null;
        marketAddress = parsed.args.pool || null;
        break;
      }
    } catch { /* not our event — skip */ }
  }
  if (!marketAddress) {
    const err = new Error('market_created_event_missing');
    err.status = 502;
    err.detail = 'tx succeeded but MarketCreated not found — check factory ABI / address';
    err.txHash = receipt.transactionHash;
    throw err;
  }

  return {
    marketId,
    marketAddress,
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    chainId: chainId(),
    question: question.trim(),
    category: category.trim(),
    factoryVariant: useV2 ? 'v2-multi' : 'v1-binary',
  };
}

// ── Parallel-binary auto-deploy ─────────────────────────────────────
//
// "Parallel" markets are N binary Yes/No markets grouped under a
// single parent question — e.g. "Who wins the F1 GP?" with one Yes/No
// AMM per driver. There's no parallel-specific factory contract, so
// we just loop V1 `MarketFactory.createMarket(...)` once per outcome
// and collect the resulting addresses.
//
// Costs: N transactions, each spending `seedAmountPerLeg` of MXNB.
// Total deployer collateral needed = N × seedAmountPerLeg. Because
// every leg is independent, liquidity doesn't pool across legs — that
// matches what mode='points' parallel already does in approveOne.
//
// Failure semantics: best-effort with abort. If leg `i` fails to
// deploy, we throw immediately. Legs 0..i-1 are already on-chain but
// orphaned — wasted gas but no DB inconsistency. The error names the
// failed leg index so the operator can debug.
//
// Each leg's question is synthesized: parentQuestion + " — " + label
// so the on-chain `question` field is human-readable on Arbiscan
// without depending on our DB.
//
// Returns:
//   { legs: [{label, marketId, marketAddress, txHash}, ...],
//     chainId, factoryVariant: 'v1-binary-parallel' }
export async function deployParallelBinaryOnChain({
  deployerSuborgId, deployerAddr,
  parentQuestion, category, outcomeLabels,
  endTime, resolutionSource, seedAmountPerLeg,
}) {
  requireReady();
  if (!deployerSuborgId) throw new Error('deployerSuborgId required');
  if (!deployerAddr) throw new Error('deployerAddr required');
  if (typeof parentQuestion !== 'string' || parentQuestion.trim().length < 8) {
    throw new Error('parentQuestion too short');
  }
  if (typeof category !== 'string' || category.trim() === '') {
    throw new Error('category required');
  }
  if (!Array.isArray(outcomeLabels) || outcomeLabels.length < 2) {
    throw new Error('outcomeLabels must have at least 2 entries');
  }
  if (!outcomeLabels.every(l => typeof l === 'string' && l.trim() !== '')) {
    throw new Error('every outcomeLabel must be a non-empty string');
  }

  const legs = [];
  for (let i = 0; i < outcomeLabels.length; i++) {
    const label = outcomeLabels[i].trim();
    // Truncate the synthesized question if the parent + label combo
    // would push us past a reasonable on-chain string length. Solidity
    // strings are unbounded but storage costs scale, and most explorers
    // truncate at ~256 chars anyway.
    const rawQ = `${parentQuestion.trim()} — ¿${label}?`;
    const legQuestion = rawQ.length > 240 ? rawQ.slice(0, 237) + '…' : rawQ;
    try {
      const result = await deployMarketOnChain({
        deployerSuborgId,
        deployerAddr,
        question: legQuestion,
        category: category.trim(),
        outcomeCount: 2, // every leg is binary
        endTime,
        resolutionSource: resolutionSource || 'Pronos parallel — leg auto',
        seedAmount: seedAmountPerLeg,
      });
      legs.push({
        label,
        marketId: result.marketId,
        marketAddress: result.marketAddress,
        txHash: result.txHash,
        blockNumber: result.blockNumber,
      });
    } catch (e) {
      // Re-throw with leg context so the caller knows which one died.
      const err = new Error(`leg_${i}_deploy_failed`);
      err.status = e?.status || 500;
      err.detail = `leg ${i} (${label}): ${e?.message || 'unknown'}`;
      err.partialLegs = legs; // legs already deployed before failure
      throw err;
    }
  }

  return {
    legs,
    chainId: chainId(),
    factoryVariant: 'v1-binary-parallel',
  };
}

// ── Resolve a market via MarketFactory.resolveMarket ─────────────────
//
// Cascades on-chain so winning shares can be redeemed for collateral.
// The factory's `resolveMarket(marketId, outcome)` is `onlyResolver`;
// the resolver wallet defaults to the deployer at deploy time and can
// be reassigned via `setResolver(addr)` (e.g. to a Gnosis Safe on
// mainnet for multi-sig resolution).
//
// Inputs:
//   resolverSuborgId, resolverAddr — Turnkey suborg + EVM address that
//     equals factory.resolver() on the target chain. Mismatch → revert.
//   factoryAddress — V1 or V2 factory.
//   factoryVariant — 'v1' | 'v2'. Used to pick the right ABI; the
//     resolveMarket selector is identical across both, but keeping the
//     dispatch consistent with deployMarketOnChain avoids surprises.
//   marketId — bigint-as-string OR number; the factory-issued id.
//   outcome — small integer index of the winning outcome.
//             V1 (binary): 0=YES, 1=NO.
//             V2 (multi):  0..outcomeCount-1.
//
// Pre-flight: simulate via prov.call so a wrong resolver / already-
// resolved market surfaces as `factory_resolve_simulation_failed`
// instead of an opaque on-chain revert post-broadcast.
//
// Returns { txHash, blockNumber, marketId, outcome, factoryVariant }.
// Indexer picks up MarketResolved within ~1 minute and updates
// protocol_markets.status='resolved'.
export async function resolveMarketOnChain({
  resolverSuborgId, resolverAddr,
  factoryAddress, factoryVariant,
  marketId, outcome,
}) {
  requireReady();
  if (!resolverSuborgId) throw new Error('resolverSuborgId required');
  if (!resolverAddr) throw new Error('resolverAddr required');
  if (!factoryAddress) throw new Error('factoryAddress required');

  const useV2 = factoryVariant === 'v2';
  const abi = useV2 ? MARKET_FACTORY_V2_ABI : MARKET_FACTORY_V1_ABI;

  // marketId can come from DB as a bigint string ("123") or as a
  // JS number; both work via ethers.BigNumber.from.
  let marketIdBn;
  try {
    marketIdBn = ethers.BigNumber.from(String(marketId));
  } catch (_) {
    throw new Error(`invalid_marketId: ${marketId}`);
  }
  const outcomeNum = Number.parseInt(outcome, 10);
  if (!Number.isInteger(outcomeNum) || outcomeNum < 0 || outcomeNum > 255) {
    throw new Error('outcome must be an integer in [0, 255]');
  }

  const prov = provider();
  const factory = new ethers.Contract(factoryAddress, abi, prov);
  const onChainResolver = await factory.resolver();
  if (!sameAddress(onChainResolver, resolverAddr)) {
    const err = new Error('not_resolver');
    err.status = 400;
    err.detail = `factory.resolver()=${onChainResolver} but resolverAddr=${resolverAddr} — call setResolver first or use a different signer suborg`;
    throw err;
  }

  const iface = new ethers.utils.Interface(abi);
  const data = iface.encodeFunctionData('resolveMarket', [marketIdBn, outcomeNum]);

  // Simulate first so a bad outcome / already-resolved market gives
  // a useful error before we burn a tx.
  try {
    await prov.call({ from: resolverAddr, to: factoryAddress, data });
  } catch (e) {
    const err = new Error('factory_resolve_simulation_failed');
    err.status = 400;
    err.detail = extractRevertDetail(e);
    throw err;
  }

  const receipt = await signAndBroadcast({
    suborgId: resolverSuborgId,
    from: resolverAddr,
    to: factoryAddress,
    data,
    // resolveMarket is small but writes a Resolved flag, then transfers
    // payouts via transferFrom calls inside the AMM on first redeem;
    // the resolve tx itself only flips a flag and emits the event, so
    // a 250k budget is plenty.
    gasLimit: ethers.BigNumber.from(250_000),
  });

  // Sanity-check: parse the MarketResolved event from the receipt.
  // If it's missing, the tx still succeeded (status==1 enforced by
  // signAndBroadcast) but something's misconfigured at the ABI level.
  let resolvedMarketId = null;
  let resolvedOutcome = null;
  for (const log of receipt.logs || []) {
    if ((log.address || '').toLowerCase() !== factoryAddress.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'MarketResolved') {
        resolvedMarketId = parsed.args.marketId?.toString() || null;
        resolvedOutcome = Number(parsed.args.outcome ?? -1);
        break;
      }
    } catch { /* skip non-matching logs */ }
  }

  return {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    marketId: resolvedMarketId || marketIdBn.toString(),
    outcome: resolvedOutcome ?? outcomeNum,
    factoryVariant: useV2 ? 'v2' : 'v1',
    chainId: chainId(),
  };
}
