import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { gasError, sepoliaGasSettings } from './sepolia-gas-config.js';
import { sepoliaGasStore } from './sepolia-gas-store.js';
import { ensureSepoliaGas } from './sepolia-gas-funding.js';
import { loadTradingDelegation } from './trading-delegation-store.js';
import { verifyTradingPolicy } from './trading-delegation.js';
import { signDelegatedTransaction } from './turnkey-delegation.js';

const POOL_ABI = [
  'function token() view returns(address)', 'function collateral() view returns(address)',
  'function marketId() view returns(uint256)', 'function paused() view returns(bool)',
  'function resolved() view returns(bool)', 'function canceled() view returns(bool)',
  'function estimateBuy(bool,uint256) view returns(uint256)',
  'function estimateBuy(uint8,uint256) view returns(uint256)',
  'function estimateSell(bool,uint256) view returns(uint256)',
  'function estimateSell(uint8,uint256) view returns(uint256)',
];
const TOKEN_ABI = [
  'function balanceOf(address) view returns(uint256)',
  'function balanceOf(address,uint256) view returns(uint256)',
  'function tokenId(uint256,uint8) pure returns(uint256)',
];
const reject = code => { throw Object.assign(new Error(code), { status: 409 }); };

export async function authorizeGasTrade({ sql, provider, suborgId, ownerAddr, pool, route, action,
  binary, units, outcomeIndex, minOut, data, target,
  loadDelegation = loadTradingDelegation, contractAt = (a, abi) => new ethers.Contract(a, abi, provider) }) {
  const owner = ownerAddr.toLowerCase();
  const users = await sql`SELECT wallet_address, turnkey_sub_org_id FROM points_users
    WHERE LOWER(wallet_address) = ${owner} OR turnkey_sub_org_id = ${suborgId} LIMIT 2`;
  if (users.length !== 1 || users[0].wallet_address?.toLowerCase() !== owner
    || users[0].turnkey_sub_org_id !== suborgId) throw gasError();
  const grant = await loadDelegation(sql, { sub: suborgId });
  const installed = grant.snapshot.policies.find(p => p.policyId === grant.row.delegation_policy_id);
  const verified = grant.backendUserId && verifyTradingPolicy(installed, grant.config);
  const known = grant.config.pools.find(p => p.address === pool.toLowerCase());
  if (grant.row.wallet_address?.toLowerCase() !== owner || grant.policyIds.length !== 1 || !verified || !known
    || (route ? !known.routed || verified.routerAddress !== route.address
      : !verified.pools.some(p => p.address === pool.toLowerCase()))) reject('delegation_required');
  if (!units.gt(0) || !['buy', 'sell', 'redeem'].includes(action)) reject('invalid_amount');
  if (action === 'redeem') {
    // This call burns/pays only in simulation, with the actual sender. It
    // rejects no holdings, unresolved/disputed/canceled pools and bad amounts.
    // ethers v5 provider.call may normalize an empty revert into "0x". A
    // void-returning redeem cannot distinguish that from success. Raw RPC
    // preserves the error, so failed redemptions cannot collect test ETH.
    await provider.send('eth_call', [{ from: owner, to: target, data, gasPrice: '0x0' }, 'latest']);
    return;
  }
  const amm = contractAt(pool, POOL_ABI);
  const [paused, resolved, canceled, collateral] = await Promise.all([
    amm.paused(), amm.resolved(), amm.canceled(), amm.collateral(),
  ]);
  if (paused || resolved || canceled || collateral.toLowerCase() !== grant.config.collateral.toLowerCase()) reject('market_not_active');
  const side = binary ? outcomeIndex === 0 : outcomeIndex;
  const signature = `${action === 'buy' ? 'estimateBuy' : 'estimateSell'}(${binary ? 'bool' : 'uint8'},uint256)`;
  if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0 || (binary && outcomeIndex > 1)
    || !minOut?.gt(0)) reject('invalid_amount');
  const estimated = await amm[signature](side, units);
  if (estimated.lte(0) || estimated.lt(minOut)) reject('slippage_exceeded');
  if (action === 'buy') {
    const balance = await contractAt(collateral, TOKEN_ABI)['balanceOf(address)'](owner);
    if (balance.lt(units)) reject('insufficient_balance');
  } else {
    const [token, marketId] = await Promise.all([amm.token(), amm.marketId()]);
    const shares = contractAt(token, TOKEN_ABI);
    const id = binary ? marketId.mul(2).add(outcomeIndex) : await shares.tokenId(marketId, outcomeIndex);
    if ((await shares['balanceOf(address,uint256)'](owner, id)).lt(units)) reject('insufficient_available_shares');
  }
}

// Called only from user buy/sell/redeem, before their first approval. Operations
// transactions and unauthenticated quotes never trigger a gas transfer.
export async function prepareUserTradeGas(args) {
  const settings = sepoliaGasSettings();
  if (!settings.enabled) return;
  try {
    const sql = settings.configured ? neon(process.env.DATABASE_URL) : null;
    await ensureSepoliaGas({ ...args, settings, store: sql && sepoliaGasStore(sql),
      sign: signDelegatedTransaction, authorize: () => authorizeGasTrade({ ...args, sql }) });
  } catch (error) {
    if (error.status) throw error;
    console.error('[sepolia-gas]', { code: error.code || 'funding_failed' });
    throw gasError();
  }
}
