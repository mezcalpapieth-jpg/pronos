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
//   event MarketCreated(uint256 indexed marketId, address pool,
//     string question, string category, uint256 endTime);
//
// V2 (multi-outcome 2..8, PronosAMMMulti):
//   function createMarket(string q, string cat, uint256 endTime,
//     string resolutionSource, string[] outcomes, uint256 seed)
//     onlyOwner returns (uint256);
//   event MarketCreated(uint256 indexed marketId, address pool,
//     string question, string category, uint256 endTime,
//     string resolutionSource, string[] outcomes);
//
// Both factories are `onlyOwner` ⇒ the deployer wallet must equal
// factory.owner() on the target chain. `pool` is not indexed in either
// event, so we decode it from the data field.
const MARKET_FACTORY_V1_ABI = [
  'function owner() view returns (address)',
  'function collateral() view returns (address)',
  'function createMarket(string question, string category, uint256 endTime, string resolutionSource, uint256 seedAmount) external returns (uint256)',
  'function getMarket(uint256 marketId) external view returns (address pool, string question, string category, uint256 endTime, string resolutionSource, bool active)',
  'event MarketCreated(uint256 indexed marketId, address pool, string question, string category, uint256 endTime)',
];
const MARKET_FACTORY_V2_ABI = [
  'function owner() view returns (address)',
  'function collateral() view returns (address)',
  'function createMarket(string question, string category, uint256 endTime, string resolutionSource, string[] outcomes, uint256 seedAmount) external returns (uint256)',
  'event MarketCreated(uint256 indexed marketId, address pool, string question, string category, uint256 endTime, string resolutionSource, string[] outcomes)',
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
