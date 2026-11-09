import { ethers } from 'ethers';
import { tradeError } from './trade-requests.js';

const address = value => ethers.utils.getAddress(value).toLowerCase();
const units = value => BigInt(value.toString());
const poolAbi = [
  'function resolved() view returns(bool)',
  'function disputed() view returns(bool)',
  'function canceled() view returns(bool)',
  'function token() view returns(address)',
  'function collateral() view returns(address)',
];
const tokenAbi = [
  'function totalSupply(uint256) view returns(uint256)',
  'function balanceOf(address,uint256) view returns(uint256)',
  'function tokenId(uint256,uint8) view returns(uint256)',
  'function yesTokenId(uint256) view returns(uint256)',
  'function noTokenId(uint256) view returns(uint256)',
];

export async function previewResolutionPayouts({ market, provider, env, outcome,
  contractAt = (addr, abi) => new ethers.Contract(addr, abi, provider) }) {
  const multi = market.protocol_version === 'v2';
  const count = Number(market.outcome_count);
  if (market.status !== 'active') throw tradeError('settlement_market_state_changed', 409);
  if (!Number.isInteger(count) || count < 2 || count > 8 || (!multi && count !== 2)
    || (outcome != null && (!Number.isInteger(outcome) || outcome < 0 || outcome >= count))) {
    throw tradeError('settlement_invalid_outcomes', 409);
  }
  const block = await provider.getBlock('latest');
  if (!block?.hash || !Number.isSafeInteger(block.number) || !Number.isSafeInteger(block.timestamp)) {
    throw tradeError('settlement_resolution_anchor_changed', 409);
  }
  const at = { blockTag: block.number };
  const pool = contractAt(market.pool_address, poolAbi);
  const factory = contractAt(market.factory_address, [
    'function collateral() view returns(address)',
    `function getMarket(uint256) view returns(address,string,string,uint256,string,${multi ? 'uint8,' : ''}bool)`,
  ]);
  const [registered, factoryCollateral, collateral, tokenAddress, resolved, disputed, canceled] = await Promise.all([
    factory.getMarket(market.contract_id, at), factory.collateral(at), pool.collateral(at), pool.token(at),
    pool.resolved(at), pool.disputed(at), pool.canceled(at),
  ]);
  if (address(registered[0]) !== address(market.pool_address) || address(collateral) !== address(env.ONCHAIN_COLLATERAL_ADDRESS)
    || address(factoryCollateral) !== address(collateral) || (multi && Number(registered[5]) !== count)) {
    throw tradeError('settlement_contract_binding_mismatch', 409);
  }
  if (resolved || disputed || canceled || !registered[multi ? 6 : 5]) throw tradeError('settlement_market_state_changed', 409);
  if (units(registered[3]) > BigInt(block.timestamp)) throw tradeError('settlement_market_still_open', 409);

  const token = contractAt(tokenAddress, tokenAbi);
  const cash = contractAt(collateral, ['function balanceOf(address) view returns(uint256)']);
  const balance = units(await cash.balanceOf(market.pool_address, at));
  const indexes = outcome == null ? Array.from({ length: count }, (_, i) => i) : [outcome];
  const payouts = await Promise.all(indexes.map(async index => {
    const id = multi ? await token.tokenId(market.contract_id, index, at)
      : await token[index === 0 ? 'yesTokenId' : 'noTokenId'](market.contract_id, at);
    const [supply, reserve] = await Promise.all([token.totalSupply(id, at), token.balanceOf(market.pool_address, id, at)]);
    // A winning share redeems 1:1. The pool's own shares are treasury inventory.
    const payout = units(supply) - units(reserve);
    if (payout < 0n) throw tradeError('settlement_invalid_share_supply', 409);
    return { outcome: index, payoutUnits: String(payout), shortfallUnits: String(payout > balance ? payout - balance : 0n) };
  }));
  if ((await provider.getBlock(block.number))?.hash?.toLowerCase() !== block.hash.toLowerCase()) {
    throw tradeError('settlement_resolution_anchor_changed', 409);
  }
  return { blockNumber: block.number, poolBalanceUnits: String(balance), payouts };
}
