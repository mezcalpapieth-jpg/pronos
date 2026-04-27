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
 * collateral (USDC on Sepolia, MXNB on mainnet). We check
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

// ── Config + ABI ────────────────────────────────────────────────────

const BINARY_AMM_ABI = [
  'function buy(bool buyYes, uint256 collateralAmount) external returns (uint256)',
  'function sell(bool sellYes, uint256 sharesAmount) external returns (uint256)',
  'function redeem(uint256 amount) external',
  'event SharesBought(address indexed buyer, bool isYes, uint256 collateralIn, uint256 fee, uint256 sharesOut)',
  'event SharesSold(address indexed seller, bool isYes, uint256 sharesIn, uint256 collateralOut, uint256 fee)',
];

const MULTI_AMM_ABI = [
  'function buy(uint8 outcomeIndex, uint256 collateralAmount) external returns (uint256)',
  'function sell(uint8 outcomeIndex, uint256 sharesAmount) external returns (uint256)',
  'function redeem(uint256 amount) external',
  'event SharesBought(address indexed buyer, uint8 indexed outcomeIndex, uint256 collateralIn, uint256 fee, uint256 sharesOut)',
  'event SharesSold(address indexed seller, uint8 indexed outcomeIndex, uint256 sharesIn, uint256 collateralOut, uint256 fee)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// MarketFactory ABI — assumed shape for the contract that deploys new
// AMMs on demand. Tweak the function/event signatures here once you
// finalize the actual Solidity contract; the rest of deployMarketOnChain
// will keep working as long as the names match.
//
// Assumed contract:
//   function createBinaryMarket(string question, uint256 endTime, uint256 seedAmount)
//       external returns (uint256 marketId, address market);
//   function createMultiMarket(string question, uint8 outcomeCount,
//       uint256 endTime, uint256 seedAmount)
//       external returns (uint256 marketId, address market);
//   event MarketCreated(uint256 indexed marketId, address indexed market,
//       address indexed creator, uint8 outcomeCount, uint256 endTime);
const MARKET_FACTORY_ABI = [
  'function createBinaryMarket(string question, uint256 endTime, uint256 seedAmount) external returns (uint256, address)',
  'function createMultiMarket(string question, uint8 outcomeCount, uint256 endTime, uint256 seedAmount) external returns (uint256, address)',
  'event MarketCreated(uint256 indexed marketId, address indexed market, address indexed creator, uint8 outcomeCount, uint256 endTime)',
];

const MAX_UINT256 = ethers.constants.MaxUint256;

// USDC/MXNB decimals — both happen to be 6.
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

function provider() {
  return new ethers.providers.JsonRpcProvider(process.env.ONCHAIN_RPC_URL);
}

function chainId() {
  return Number(process.env.ONCHAIN_CHAIN_ID || 421614);
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

async function ensureCollateralAllowance({ suborgId, ownerAddr, ammAddress, amount }) {
  const prov = provider();
  const collateralAddr = process.env.ONCHAIN_COLLATERAL_ADDRESS;
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

// ── Helpers for encode/decode ───────────────────────────────────────

function isBinary(market) {
  const n = Array.isArray(market?.outcomes) ? market.outcomes.length : 2;
  return n === 2;
}

function ammInterface(market) {
  return new ethers.utils.Interface(isBinary(market) ? BINARY_AMM_ABI : MULTI_AMM_ABI);
}

function encodeBuy(market, outcomeIndex, collateralUnits) {
  const iface = ammInterface(market);
  if (isBinary(market)) {
    return iface.encodeFunctionData('buy', [outcomeIndex === 0, collateralUnits]);
  }
  return iface.encodeFunctionData('buy', [outcomeIndex, collateralUnits]);
}

function encodeSell(market, outcomeIndex, sharesUnits) {
  const iface = ammInterface(market);
  if (isBinary(market)) {
    return iface.encodeFunctionData('sell', [outcomeIndex === 0, sharesUnits]);
  }
  return iface.encodeFunctionData('sell', [outcomeIndex, sharesUnits]);
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

export async function buyOnChain({
  suborgId, ownerAddr, market, outcomeIndex, collateral,
}) {
  requireReady();
  if (!suborgId) throw new Error('suborgId required');
  if (!ownerAddr) throw new Error('ownerAddr required');
  if (!market?.chain_address) throw new Error('market missing chain_address');

  const ammAddr = market.chain_address;
  const collateralUnits = ethers.utils.parseUnits(String(collateral), COLLATERAL_DECIMALS);

  await ensureCollateralAllowance({
    suborgId, ownerAddr, ammAddress: ammAddr, amount: collateralUnits,
  });

  const data = encodeBuy(market, outcomeIndex, collateralUnits);
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
  suborgId, ownerAddr, market, outcomeIndex, shares,
}) {
  requireReady();
  if (!suborgId) throw new Error('suborgId required');
  if (!ownerAddr) throw new Error('ownerAddr required');
  if (!market?.chain_address) throw new Error('market missing chain_address');

  const ammAddr = market.chain_address;
  const sharesUnits = ethers.utils.parseUnits(String(shares), COLLATERAL_DECIMALS);

  const data = encodeSell(market, outcomeIndex, sharesUnits);
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
// Caller passes a pending market description; we encode the factory
// call, sign via the deployer's Turnkey delegation, broadcast, and
// parse the MarketCreated event for the new (marketId, address).
//
// `deployerSuborgId` and `deployerAddr` are the SUB-ORG that owns the
// creation rights. Two reasonable choices:
//   1. A dedicated deployer sub-org (e.g. ONCHAIN_DEPLOYER_SUBORG_ID)
//      that has a separate delegation policy authorizing factory calls.
//      Recommended — keeps user trades and admin deploys on different
//      keys, simpler audit trail.
//   2. The admin's own user sub-org if the admin's policy whitelists
//      the factory address. Works but mixes concerns.
//
// Hard-gated: factory address must be set, plus the standard onchain
// pre-checks. Returns { marketId, marketAddress, txHash, blockNumber }.
export async function deployMarketOnChain({
  deployerSuborgId, deployerAddr,
  question, outcomeCount, endTime, seedAmount,
}) {
  requireReady();
  const factoryAddr = process.env.ONCHAIN_MARKET_FACTORY_ADDRESS;
  if (!factoryAddr) {
    const err = new Error('factory_not_configured');
    err.status = 503;
    err.detail = 'set ONCHAIN_MARKET_FACTORY_ADDRESS to enable auto-deploy';
    throw err;
  }
  if (!deployerSuborgId) throw new Error('deployerSuborgId required');
  if (!deployerAddr) throw new Error('deployerAddr required');
  if (typeof question !== 'string' || question.trim().length < 8) {
    throw new Error('question too short');
  }
  const n = Number.parseInt(outcomeCount, 10);
  if (!Number.isInteger(n) || n < 2 || n > 10) {
    throw new Error('outcomeCount must be 2..10');
  }
  const endTs = Math.floor(new Date(endTime).getTime() / 1000);
  if (!Number.isFinite(endTs) || endTs <= Math.floor(Date.now() / 1000)) {
    throw new Error('endTime must be a future timestamp');
  }
  const seedUnits = ethers.utils.parseUnits(String(seedAmount), COLLATERAL_DECIMALS);

  const iface = new ethers.utils.Interface(MARKET_FACTORY_ABI);
  const data = n === 2
    ? iface.encodeFunctionData('createBinaryMarket', [question, endTs, seedUnits])
    : iface.encodeFunctionData('createMultiMarket', [question, n, endTs, seedUnits]);

  // The factory pulls seed collateral from the deployer's wallet on
  // creation, so make sure the deployer has approved MAX on the
  // collateral token towards the factory. ensureCollateralAllowance
  // approves towards an arbitrary spender — reuse it.
  await ensureCollateralAllowance({
    suborgId: deployerSuborgId,
    ownerAddr: deployerAddr,
    ammAddress: factoryAddr,
    amount: seedUnits,
  });

  const receipt = await signAndBroadcast({
    suborgId: deployerSuborgId,
    from: deployerAddr,
    to: factoryAddr,
    data,
    gasLimit: 4_000_000n, // contract deploys are heavier than trades
  });

  // Parse MarketCreated event from the receipt logs.
  let marketId = null;
  let marketAddress = null;
  for (const log of receipt.logs || []) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'MarketCreated') {
        marketId = parsed.args.marketId?.toString() || null;
        marketAddress = parsed.args.market || null;
        break;
      }
    } catch { /* not our event — skip */ }
  }
  if (!marketAddress) {
    const err = new Error('market_created_event_missing');
    err.status = 502;
    err.detail = 'tx succeeded but MarketCreated event not found — check factory ABI';
    err.txHash = receipt.transactionHash;
    throw err;
  }

  return {
    marketId,
    marketAddress,
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    chainId: chainId(),
  };
}
