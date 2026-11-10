import { ethers } from 'ethers';
import {
  ACCOUNTING_CHAIN_ID, formatUnits, invalidAccountingQuery, isHash, normalizeAddress,
  parseEvent, poolMoneyEvents, seedEvidence, transferEvents,
} from './onchain-accounting.js';

const PAGE_SIZE = 20;
const BLOCK_WINDOW = 100000;
const transferTopic = transferEvents.getEventTopic('Transfer');
const feeDistributionTopic = ethers.utils.id('FeesDistributed(uint256,uint256,uint256)');
const validKinds = ['mxnp', 'eth', 'ethInternal', 'gasGrants'];
const positiveInteger = value => typeof value === 'string' && /^\d{1,10}$/.test(value) && Number(value) > 0;
const raw = value => BigInt(value.toString());
const uint = value => typeof value === 'string' && /^\d{1,78}$/.test(value);

export function accountingQuery(query = {}) {
  const { kind = 'summary', wallet, block, through, logIndex, windowStart, marketBefore, page, tx } = query;
  if ((block !== undefined && !positiveInteger(block))
    || (marketBefore !== undefined && (!positiveInteger(marketBefore) || Number(marketBefore) > 2147483647))) throw invalidAccountingQuery();
  const snapshot = { snapshotBlock: block ? Number(block) : undefined, marketBefore: marketBefore ? Number(marketBefore) : null };
  if (kind === 'summary') return { kind, ...snapshot };
  if (!validKinds.includes(kind)
    || (wallet !== undefined && !normalizeAddress(wallet))
    || (kind !== 'mxnp' && !wallet) || (page !== undefined && (!positiveInteger(page) || Number(page) > 500))
    || (through !== undefined && (typeof through !== 'string' || !/^\d{1,10}$/.test(through)))
    || (logIndex !== undefined && ((!through && !tx) || typeof logIndex !== 'string' || !/^\d{1,8}$/.test(logIndex)))
    || (windowStart !== undefined && (typeof windowStart !== 'string' || !/^\d{1,10}$/.test(windowStart)))
    || (tx !== undefined && (kind !== 'mxnp' || !isHash(tx)))) throw invalidAccountingQuery();
  return { kind, ...snapshot, wallet: normalizeAddress(wallet),
    through: through ? Number(through) : null, logIndex: logIndex === undefined ? null : Number(logIndex),
    windowStart: windowStart === undefined ? null : Number(windowStart), page: Number(page || 1), tx: tx?.toLowerCase() };
}

function endpoints(context, from, to) {
  const fromWallet = context.wallets.get(from);
  const toWallet = context.wallets.get(to);
  if (fromWallet && toWallet) return 'internal';
  if (!from) return 'mint';
  if (!to) return 'burn';
  if (fromWallet) return 'outgoing';
  if (toWallet) return 'incoming';
  return 'custody';
}

export function collateralMovement(context, log, receipt) {
  const transfer = parseEvent(transferEvents, log);
  if (!transfer) return null;
  const from = normalizeAddress(transfer.args.from);
  const to = normalizeAddress(transfer.args.to);
  const amount = raw(transfer.args.value);
  const direction = endpoints(context, from, to);
  let market = context.pools.get(from) ?? context.pools.get(to);
  let category = direction;
  if (receipt && market) {
    const subsequentLogs = receipt.logs.filter(other => other.logIndex > log.logIndex);
    const eventLog = subsequentLogs.find(other => other.address.toLowerCase() === market.address
      && parseEvent(poolMoneyEvents, other));
    const event = eventLog && parseEvent(poolMoneyEvents, eventLog);
    const seed = event?.name === 'LiquidityAdded' && seedEvidence(receipt, market, context.collateral);
    if (seed && from === market.factory && to === market.address && amount === seed.amount) category = 'seed';
    else if (from === market.address) {
      if (event?.name === 'DustRecovered' && normalizeAddress(event.args.recipient) === to && raw(event.args.amount) === amount) {
        category = 'recovery';
      } else if (['CancelRefunded', 'WinningsRedeemed'].includes(event?.name)
        && normalizeAddress(event.args.user) === to && raw(event.args.payout) === amount) {
        category = event.name === 'CancelRefunded' ? 'refund' : 'redemption';
      } else if (event?.name === 'SharesSold' && normalizeAddress(event.args.seller) === to
        && raw(event.args.collateralOut) === amount) {
        // V1 transfers the fee before the seller's payout. Both destinations
        // and amounts can coincide when a fee collector is also the seller.
        const paidLater = raw(event.args.fee) === amount && subsequentLogs.some(other => {
          if (other.logIndex >= eventLog.logIndex || other.address.toLowerCase() !== context.collateral) return false;
          const payment = parseEvent(transferEvents, other);
          return payment && normalizeAddress(payment.args.from) === from && normalizeAddress(payment.args.to) === to
            && raw(payment.args.value) === amount;
        });
        category = paidLater ? 'commission' : 'sale';
      } else if (['SharesBought', 'SharesSold'].includes(event?.name) && raw(event.args.fee) === amount && amount > 0n) {
        category = 'commission';
      }
    } else if (event?.name === 'SharesBought' && raw(event.args.collateralIn) === amount) category = 'purchase';
  } else if (receipt) {
    const created = [...context.pools.values()].find(pool => pool.creationTx === log.transactionHash.toLowerCase() && pool.factory === to);
    const seed = created && seedEvidence(receipt, created, context.collateral);
    if (seed && seed.from === from && seed.amount === amount) {
      market = created;
      category = 'seedFunding';
    } else if (direction === 'internal' && receipt.logs.some(other => other.topics[0] === feeDistributionTopic
      && context.wallets.get(other.address.toLowerCase())?.roles.some(role => role.endsWith('Factory')))) category = 'feeDistribution';
  }
  return { id: log.transactionHash.toLowerCase() + ':' + log.logIndex, tx: log.transactionHash, block: log.blockNumber,
    from, to, amount: formatUnits(amount), category, direction,
    market: market ? { address: market.address, id: market.id, version: market.version, question: market.question } : null };
}

async function collateralHistory(context, query) {
  const { block, provider, collateral, wallets, pools } = context;
  const addresses = new Set(query.wallet ? [query.wallet] : [...wallets.keys(), ...pools.keys()]);
  let logs;
  let fromBlock = null;
  let toBlock = null;
  let lookupReceipt = null;
  if (query.tx) {
    lookupReceipt = await provider.getTransactionReceipt(query.tx);
    logs = lookupReceipt?.status === 1 && lookupReceipt.blockNumber <= block.number ? lookupReceipt.logs.filter(log => {
      if (log.address.toLowerCase() !== collateral || log.topics[0] !== transferTopic) return false;
      const event = parseEvent(transferEvents, log);
      return event && (addresses.has(normalizeAddress(event.args.from)) || addresses.has(normalizeAddress(event.args.to)));
    }) : [];
  } else {
    toBlock = query.through ?? block.number;
    if (toBlock > block.number) throw invalidAccountingQuery();
    fromBlock = Math.max(0, toBlock - BLOCK_WINDOW + 1);
    // A second page in the same block window must preserve its lower boundary.
    if (query.logIndex !== null) {
      if (query.windowStart === null || query.windowStart > toBlock || toBlock - query.windowStart >= BLOCK_WINDOW) throw invalidAccountingQuery();
      fromBlock = query.windowStart;
    }
    const topics = [...addresses].map(address => ethers.utils.hexZeroPad(address, 32));
    logs = topics.length ? (await Promise.all([
      provider.getLogs({ address: collateral, fromBlock, toBlock, topics: [transferTopic, topics] }),
      provider.getLogs({ address: collateral, fromBlock, toBlock, topics: [transferTopic, null, topics] }),
    ])).flat() : [];
  }
  const unique = [...new Map(logs.filter(log => !log.removed).map(log => [log.transactionHash + ':' + log.logIndex, log])).values()]
    .filter(log => query.logIndex === null || log.blockNumber < toBlock || log.logIndex < query.logIndex)
    .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  const visible = unique.slice(0, PAGE_SIZE);
  const receiptByHash = new Map();
  let unclassified = false;
  await Promise.all([...new Set(visible.map(log => log.transactionHash))].map(async hash => {
    try {
      const receipt = lookupReceipt ?? await provider.getTransactionReceipt(hash);
      if (receipt?.status === 1) receiptByHash.set(hash, receipt);
      else unclassified = true;
    } catch { unclassified = true; }
  }));
  const last = visible.at(-1);
  const next = unique.length > PAGE_SIZE
    ? (query.tx ? { logIndex: last.logIndex } : { through: last.blockNumber, logIndex: last.logIndex, windowStart: fromBlock })
    : fromBlock > 0 ? { through: fromBlock - 1 } : null;
  return { items: visible.map(log => collateralMovement(context, log, receiptByHash.get(log.transactionHash))).filter(Boolean),
    coverage: 'erc20', fromBlock, toBlock, unclassified, next };
}

async function gasGrants(context, query) {
  const asOf = new Date(context.block.timestamp * 1000).toISOString();
  const rows = await context.sql`SELECT tx_hash, wallet_address, amount_wei::text, confirmed_at
    FROM sepolia_gas_transfers WHERE chain_id = 421614 AND funder_address = ${query.wallet}
      AND status = 'confirmed' AND confirmed_at <= ${asOf}::timestamptz
    ORDER BY confirmed_at DESC, tx_hash DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${(query.page - 1) * PAGE_SIZE}`;
  return { coverage: 'indexedGas', items: rows.slice(0, PAGE_SIZE).map(row => ({
    id: row.tx_hash, tx: row.tx_hash, from: query.wallet, to: row.wallet_address,
    amount: formatUnits(raw(row.amount_wei), 18), category: 'gasGrant', direction: 'outgoing', time: row.confirmed_at,
  })), next: rows.length > PAGE_SIZE && query.page < 500 ? { page: query.page + 1 } : null };
}

async function explorerHistory(context, query, key, fetcher) {
  if (!key) return { items: [], coverage: 'explorerUnconfigured', next: null };
  const internal = query.kind === 'ethInternal';
  const url = new URL('https://api.etherscan.io/v2/api');
  url.search = new URLSearchParams({
    chainid: String(ACCOUNTING_CHAIN_ID), module: 'account', action: internal ? 'txlistinternal' : 'txlist',
    address: query.wallet, startblock: '0', endblock: String(context.block.number), page: String(query.page),
    offset: String(PAGE_SIZE), sort: 'desc', apikey: key,
  });
  const response = await fetcher(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('accounting_explorer_unavailable');
  const data = await response.json();
  const empty = data.status === '0' && data.message === 'No transactions found' && Array.isArray(data.result) && !data.result.length;
  if (!empty && (data.status !== '1' || !Array.isArray(data.result))) throw new Error('accounting_explorer_unavailable');
  const items = [];
  let unclassified = false;
  await Promise.all(data.result.slice(0, PAGE_SIZE).map(async row => {
    const from = normalizeAddress(row.from);
    const to = normalizeAddress(row.to) ?? normalizeAddress(row.contractAddress);
    const block = Number(row.blockNumber);
    if (!isHash(row.hash) || !uint(row.value) || !Number.isSafeInteger(block) || block > context.block.number
      || (from !== query.wallet && to !== query.wallet)) {
      unclassified = true;
      return;
    }
    const id = row.hash + (internal ? ':' + row.traceId : '');
    const direction = endpoints(context, from, to);
    const fields = { tx: row.hash, block, from, to };
    if (row.isError === '0' && raw(row.value) > 0n) items.push({ ...fields, id, amount: formatUnits(raw(row.value), 18),
      category: context.wallets.get(from)?.roles.includes('gasFunder') && !context.wallets.has(to) ? 'gasFundingTransfer' : direction, direction });
    if (!internal && from === query.wallet) {
      let receipt;
      try { receipt = await context.provider.getTransactionReceipt(row.hash); } catch { /* show the missing fee */ }
      const gas = receipt?.gasUsed && receipt.effectiveGasPrice ? raw(receipt.gasUsed) * raw(receipt.effectiveGasPrice) : null;
      if (gas === null) unclassified = true;
      items.push({ ...fields, id: id + ':gas', to: null, amount: formatUnits(gas, 18), category: 'networkFee', direction: 'outgoing' });
    }
  }));
  const networkFees = items.filter(item => item.category === 'networkFee');
  const gasSpent = internal || unclassified ? null
    : formatUnits(networkFees.reduce((total, item) => total + raw(ethers.utils.parseEther(item.amount)), 0n), 18);
  return { items: items.sort((a, b) => b.block - a.block || a.id.localeCompare(b.id)), unclassified, gasSpent,
    coverage: internal ? 'explorerInternal' : 'explorer', next: data.result.length >= PAGE_SIZE && query.page < 500 ? { page: query.page + 1 } : null };
}

export async function accountingMovements(context, query, explorerKey, fetcher = fetch) {
  if (query.wallet && !context.wallets.has(query.wallet) && !context.pools.has(query.wallet)) throw invalidAccountingQuery();
  const result = await (query.kind === 'mxnp' ? collateralHistory(context, query)
    : query.kind === 'gasGrants' ? gasGrants(context, query) : explorerHistory(context, query, explorerKey, fetcher));
  return { ...result, chainId: ACCOUNTING_CHAIN_ID, readOnly: true, block: context.block.number, warnings: context.warnings };
}
