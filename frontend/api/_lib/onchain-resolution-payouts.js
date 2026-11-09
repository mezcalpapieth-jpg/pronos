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
const createdV1 = new ethers.utils.Interface([
  'event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime)',
]);
const createdV2 = new ethers.utils.Interface([
  'event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime,string resolutionSource,string[] outcomes)',
]);
const transfers = new ethers.utils.Interface([
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
  'event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)',
]);
const zeroTopic = ethers.constants.HashZero;
const legacyLogWindow = 9_000_000;

async function legacySupplies({ market, provider, tokenAddress, ids, blockNumber }) {
  const creation = market.protocol_version === 'v2' ? createdV2 : createdV1;
  if (!/^0x[\da-f]{64}$/i.test(market.creation_tx_hash || '')) throw tradeError('settlement_share_supply_unavailable', 409);
  const receipt = await provider.getTransactionReceipt(market.creation_tx_hash);
  const [topic, marketTopic] = creation.encodeFilterTopics('MarketCreated', [market.contract_id]);
  const events = receipt?.logs?.filter(log => address(log.address) === address(market.factory_address)
    && log.topics[0] === topic && log.topics[1] === marketTopic);
  if (receipt?.status !== 1 || !Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber > blockNumber
    || blockNumber - receipt.blockNumber >= legacyLogWindow * 8
    || events?.length !== 1 || address(creation.parseLog(events[0]).args.pool) !== address(market.pool_address)) {
    throw tradeError('settlement_share_supply_unavailable', 409);
  }
  const supplies = new Map(ids.map(id => [id.toString(), 0n]));
  const seeded = new Set();
  // Single-value topics allow the Sepolia RPC to use its indexed filters
  // across older markets. Ordinary ERC-1155 transfers leave supply unchanged.
  for (let fromBlock = receipt.blockNumber; fromBlock <= blockNumber; fromBlock += legacyLogWindow) {
    const toBlock = Math.min(blockNumber, fromBlock + legacyLogWindow - 1);
    await Promise.all(['TransferSingle', 'TransferBatch'].flatMap(name => [true, false].map(async mint => {
      const signature = transfers.getEventTopic(name);
      const topics = mint ? [signature, null, zeroTopic] : [signature, null, null, zeroTopic];
      const logs = await provider.getLogs({ address: tokenAddress, fromBlock, toBlock, topics });
      for (const log of logs) {
        const { args } = transfers.parseLog(log);
        const entries = name === 'TransferSingle' ? [[args.id, args.value]] : args[3].map((id, i) => [id, args[4][i]]);
        for (const [id, amount] of entries) {
          const key = id.toString();
          if (!supplies.has(key)) continue;
          const quantity = units(amount);
          supplies.set(key, supplies.get(key) + (mint ? quantity : -quantity));
          if (mint && quantity > 0n && log.transactionHash === receipt.transactionHash
            && address(args.to) === address(market.pool_address)) seeded.add(key);
        }
      }
    })));
  }
  if (seeded.size !== ids.length) throw tradeError('settlement_share_supply_unavailable', 409);
  return ids.map(id => supplies.get(id.toString()));
}

async function readSupplies({ token, ids, at, ...context }) {
  try {
    return (await Promise.all(ids.map(id => token.totalSupply(id, at)))).map(units);
  } catch (error) {
    // The original Sepolia tokens implement ERC-1155 without ERC1155Supply.
    if (error.code !== 'CALL_EXCEPTION' || error.data !== '0x') throw error;
    return legacySupplies({ ...context, ids, blockNumber: at.blockTag });
  }
}

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
  const indexes = outcome == null ? Array.from({ length: count }, (_, i) => i) : [outcome];
  const ids = await Promise.all(indexes.map(index => multi ? token.tokenId(market.contract_id, index, at)
    : token[index === 0 ? 'yesTokenId' : 'noTokenId'](market.contract_id, at)));
  const [supply, reserves, cashBalance] = await Promise.all([
    readSupplies({ token, ids, at, market, provider, tokenAddress }),
    Promise.all(ids.map(id => token.balanceOf(market.pool_address, id, at))),
    cash.balanceOf(market.pool_address, at),
  ]);
  const balance = units(cashBalance);
  const payouts = indexes.map((index, i) => {
    // A winning share redeems 1:1. The pool's own shares are treasury inventory.
    const payout = supply[i] - units(reserves[i]);
    if (payout < 0n) throw tradeError('settlement_invalid_share_supply', 409);
    return { outcome: index, payoutUnits: String(payout), shortfallUnits: String(payout > balance ? payout - balance : 0n) };
  });
  if ((await provider.getBlock(block.number))?.hash?.toLowerCase() !== block.hash.toLowerCase()) {
    throw tradeError('settlement_resolution_anchor_changed', 409);
  }
  return { blockNumber: block.number, poolBalanceUnits: String(balance), payouts };
}
