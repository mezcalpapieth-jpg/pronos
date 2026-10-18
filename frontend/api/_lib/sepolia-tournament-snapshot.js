import { ethers } from 'ethers';
import { address, planHash, MINT_ABI, TOURNAMENT_CHAIN_ID } from './sepolia-tournament.js';
import { tournamentRegistrations, buildTournamentShadowScores } from './sepolia-tournament-scoring.js';
import { verifyMintReceipt } from './sepolia-tournament-funding.js';

const fail = code => { throw new Error(code); };
const integer = value => {
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid_snapshot_integer');
  return value;
};
const hash = value => {
  if (!/^0x[0-9a-f]{64}$/i.test(value || '')) fail('canonical_hash_required');
  return value.toLowerCase();
};
const id = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) fail('market_id_string_required');
  return value;
};
const commonEvents = [
  'event MarketResolved(uint256 indexed marketId,uint8 outcome)',
  'event MarketCanceled(uint256 indexed marketId)',
  'event ResolutionDisputeOpened(uint256 indexed marketId,uint8 outcome)',
  'event ResolutionDisputeCleared(uint256 indexed marketId,uint8 outcome)',
  'event MarketResolutionCorrected(uint256 indexed marketId,uint8 oldOutcome,uint8 newOutcome)',
  'event CancelRefunded(address indexed user,uint256 payout)',
];
const interfaces = {
  V1: new ethers.utils.Interface([
    'event SharesBought(address indexed buyer,bool isYes,uint256 collateralIn,uint256 fee,uint256 sharesOut)',
    'event SharesSold(address indexed seller,bool isYes,uint256 sharesIn,uint256 collateralOut,uint256 fee)',
    'event WinningsRedeemed(address indexed user,uint256 shares,uint256 payout)', ...commonEvents]),
  V2: new ethers.utils.Interface([
    'event SharesBought(address indexed buyer,uint8 indexed outcomeIndex,uint256 collateralIn,uint256 fee,uint256 sharesOut)',
    'event SharesSold(address indexed seller,uint8 indexed outcomeIndex,uint256 sharesIn,uint256 collateralOut,uint256 fee)',
    'event WinningsRedeemed(address indexed user,uint8 indexed outcomeIndex,uint256 shares,uint256 payout)', ...commonEvents]),
};
const creation = {
  V1: new ethers.utils.Interface(['event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime)']),
  V2: new ethers.utils.Interface(['event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime,string resolutionSource,string[] outcomes)']),
};

// A reviewed allowlist must cover every market in these cycle-only factories.
// Adding a market changes the hash and requires a new review, never a payout.
export function tournamentMarketRegistry({ cycleId, planHash: digest, markets }) {
  if (!/^[a-f0-9]{64}$/.test(digest || '') || !Array.isArray(markets)) fail('invalid_market_registry');
  const rows = markets.map(row => ({ factory: address(row.factory), pool: address(row.pool),
    marketId: id(row.marketId), creationTxHash: hash(row.creationTxHash),
    creationLogIndex: integer(row.creationLogIndex) }));
  rows.sort((a,b) => a.factory.localeCompare(b.factory) || (BigInt(a.marketId) < BigInt(b.marketId) ? -1 : BigInt(a.marketId) > BigInt(b.marketId) ? 1 : 0));
  return { version: 1, cycleId, planHash: digest, markets: rows };
}

// Read-only provider methods only. No DB client, env loading, signer, funding
// execution or protocol-indexer import (the latter initializes a write client).
// The RPC is a trusted source; this is not a consensus or receipt-trie proof.
export async function buildTournamentSnapshot({ cycle, reviewedPlanHash, registry,
  reviewedRegistryHash, funding, fromBlock, asOfBlock }, { provider, readIndexerCoverage }) {
  const { plan, digest } = tournamentRegistrations({ cycle, reviewedPlanHash });
  const d = plan.deployment;
  const manifest = tournamentMarketRegistry(registry);
  const registryHash = planHash(manifest);
  if (manifest.cycleId !== plan.cycleId || manifest.planHash !== digest
    || registryHash !== reviewedRegistryHash) fail('reviewed_market_registry_required');
  integer(fromBlock); integer(asOfBlock);
  if (fromBlock < 1 || asOfBlock < fromBlock || asOfBlock - fromBlock > 2_000_000
    || manifest.markets.length > 100) fail('snapshot_bounds_exceeded');
  if ((await provider.getNetwork()).chainId !== TOURNAMENT_CHAIN_ID) fail('rpc_chain_mismatch');
  const tip = integer(await provider.getBlockNumber());
  if (tip - asOfBlock < 1) fail('snapshot_needs_two_confirmations');
  let requests = 0, logCount = 0;
  const budget = () => { if (++requests > 10_000) fail('snapshot_request_budget_exceeded'); };
  const blocks = new Map(), receipts = new Map(), slots = new Map();
  async function block(n) {
    integer(n);
    if (!blocks.has(n)) {
      budget(); const value = await provider.getBlock(n);
      if (!value || value.number !== n || !Number.isSafeInteger(value.timestamp)) fail('canonical_block_missing');
      hash(value.hash); blocks.set(n, value);
    }
    return blocks.get(n);
  }
  async function read(to, signature, args = [], all = false) {
    budget(); const abi = new ethers.utils.Interface([`function ${signature}`]);
    const name = Object.keys(abi.functions)[0];
    const result = abi.decodeFunctionResult(name, await provider.call({ to, data: abi.encodeFunctionData(name, args) }, asOfBlock));
    return all ? result : result[0];
  }
  async function receipt(txHash) {
    const key = hash(txHash);
    if (!receipts.has(key)) {
      budget(); const value = await provider.getTransactionReceipt(key);
      if (!value || value.status !== 1 || hash(value.transactionHash) !== key
        || integer(value.blockNumber) > asOfBlock || !Array.isArray(value.logs)
        || value.logs.length > 50_000) fail('canonical_receipt_missing');
      if (hash(value.blockHash) !== hash((await block(value.blockNumber)).hash)) fail('receipt_reorg');
      const indices = new Set();
      for (const log of value.logs) {
        if (log.removed || hash(log.transactionHash) !== key || log.blockNumber !== value.blockNumber
          || hash(log.blockHash) !== hash(value.blockHash) || indices.has(integer(log.logIndex))) fail('receipt_log_metadata_mismatch');
        indices.add(log.logIndex);
      }
      receipts.set(key, value);
    }
    return receipts.get(key);
  }
  async function verifyLog(log) {
    if (log.removed) fail('removed_log');
    const r = await receipt(log.transactionHash);
    const b = await block(integer(log.blockNumber));
    if (r.blockNumber !== log.blockNumber || hash(log.blockHash) !== hash(b.hash)) fail('log_block_mismatch');
    const found = r.logs.find(l => l.logIndex === integer(log.logIndex));
    if (!found || address(found.address) !== address(log.address) || found.data !== log.data
      || JSON.stringify(found.topics) !== JSON.stringify(log.topics)) fail('log_receipt_mismatch');
    const slot = `${log.blockNumber}:${log.logIndex}`;
    const fingerprint = planHash({ txHash: hash(log.transactionHash), address: address(log.address), data: log.data, topics: log.topics });
    if (slots.has(slot) && slots.get(slot) !== fingerprint) fail('conflicting_log_position');
    slots.set(slot, fingerprint);
    return new Date(b.timestamp * 1000).toISOString();
  }
  const pinned = await block(asOfBlock), first = await block(fromBlock), previous = await block(fromBlock - 1);
  const start = Date.parse(plan.startsAt), end = Date.parse(plan.endsAt);
  if (first.timestamp * 1000 < start || previous.timestamp * 1000 >= start
    || pinned.timestamp * 1000 < start || pinned.timestamp * 1000 > end) fail('cycle_block_boundary_mismatch');
  const coverage = await readIndexerCoverage([d.factoryV1, d.factoryV2]);
  for (const factory of [d.factoryV1, d.factoryV2]) {
    const rows = coverage.filter(r => r.chainId === TOURNAMENT_CHAIN_ID && address(r.factory) === factory);
    if (rows.length !== 1 || integer(rows[0].lastBlock) < asOfBlock) fail('incomplete_indexer_coverage');
  }
  const mint = new ethers.utils.Interface(MINT_ABI);
  if (!Array.isArray(funding) || funding.length !== plan.batches.length) fail('complete_funding_receipts_required');
  const funded = new Set(), fundingProof = [];
  for (const batch of plan.batches) {
    const rows = funding.filter(r => r.batchIndex === batch.index);
    if (rows.length !== 1 || funded.has(hash(rows[0].txHash))) fail('duplicate_or_missing_funding_batch');
    const txHash = hash(rows[0].txHash), r = await receipt(txHash);
    if ((await block(r.blockNumber)).timestamp * 1000 >= start || asOfBlock - r.blockNumber < 1) fail('funding_not_final_before_start');
    budget(); const tx = await provider.getTransaction(txHash);
    const expected = mint.encodeFunctionData('batchMint', [batch.recipients.map(r => r.wallet), batch.recipients.map(r => r.units)]);
    if (!tx || hash(tx.hash) !== txHash || tx.blockNumber !== r.blockNumber || hash(tx.blockHash) !== hash(r.blockHash)
      || tx.chainId !== TOURNAMENT_CHAIN_ID || address(tx.from) !== d.owner || address(tx.to) !== d.token
      || !ethers.BigNumber.from(tx.value).isZero() || tx.data !== expected) fail('funding_transaction_mismatch');
    verifyMintReceipt(r, plan, batch);
    funded.add(txHash); fundingProof.push({ batchIndex: batch.index, txHash, blockNumber: r.blockNumber, blockHash: hash(r.blockHash) });
  }
  if ((await read(d.token, 'totalSupply() view returns(uint256)')).toString() !== plan.totalUnits
    || Number(await read(d.token, 'decimals() view returns(uint8)')) !== 6) fail('cycle_supply_mismatch');
  budget();
  if (ethers.utils.keccak256(await provider.getCode(d.router, asOfBlock)) !== d.routerCodeHash) fail('router_code_mismatch');
  for (const [field, expected] of [['factoryV1',d.factoryV1],['factoryV2',d.factoryV2],
    ['collateral',d.token],['tokenV1',d.shareV1],['tokenV2',d.shareV2]]) {
    if (address(await read(d.router, `${field}() view returns(address)`)) !== expected) fail('router_binding_mismatch');
  }
  const markets = [], events = [], poolSet = new Set();
  for (const version of ['V1','V2']) {
    const factory = d[`factory${version}`], entries = manifest.markets.filter(m => m.factory === factory);
    for (const [field, expected] of [['collateral',d.token],['token',d[`share${version}`]],['tradingRouter',d.router]]) {
      if (address(await read(factory, `${field}() view returns(address)`)) !== expected) fail('factory_binding_mismatch');
    }
    if (address(await read(d[`share${version}`], 'owner() view returns(address)')) !== factory) fail('share_owner_mismatch');
    if ((await read(factory, 'marketCount() view returns(uint256)')).toString() !== String(entries.length)
      || entries.some((m,i) => m.marketId !== String(i))) fail('incomplete_factory_registry');
    for (const entry of entries) {
      if (poolSet.has(entry.pool)) fail('duplicate_registered_pool');
      poolSet.add(entry.pool);
      const fields = 'address pool,string question,string category,uint256 endTime,string resolutionSource'
        + (version === 'V2' ? ',uint8 outcomeCount' : '') + ',bool active';
      const binding = await read(factory, `markets(uint256) view returns(${fields})`, [entry.marketId], true);
      if (address(binding.pool) !== entry.pool) fail('factory_membership_mismatch');
      const r = await receipt(entry.creationTxHash);
      const log = r.logs.find(l => l.logIndex === entry.creationLogIndex);
      if (!log || address(log.address) !== factory) fail('market_creation_missing');
      await verifyLog(log);
      const created = creation[version].parseLog(log);
      if (created.args.marketId.toString() !== entry.marketId || address(created.args.pool) !== entry.pool) fail('market_creation_mismatch');
      const registeredBlock = r.blockNumber;
      if (asOfBlock - Math.min(fromBlock, registeredBlock) > 2_000_000) fail('snapshot_bounds_exceeded');
      for (const [field, expected] of [['factory',factory],['collateral',d.token],['token',d[`share${version}`]]]) {
        if (address(await read(entry.pool, `${field}() view returns(address)`)) !== expected) fail('pool_binding_mismatch');
      }
      if ((await read(entry.pool, 'marketId() view returns(uint256)')).toString() !== entry.marketId) fail('pool_market_id_mismatch');
      const outcomeCount = version === 'V1' ? 2 : Number(await read(entry.pool, 'outcomeCount() view returns(uint8)'));
      if (version === 'V2' && (Number(binding.outcomeCount) !== outcomeCount
        || created.args.outcomes.length !== outcomeCount)) fail('outcome_registry_mismatch');
      if (outcomeCount < 2 || outcomeCount > 8 || !await read(entry.pool, 'initialized() view returns(bool)')
        || await read(entry.pool, 'canceled() view returns(bool)') || await read(entry.pool, 'disputed() view returns(bool)')) fail('unsupported_market_lifecycle');
      const resolved = await read(entry.pool, 'resolved() view returns(bool)');
      const market = { chainId: TOURNAMENT_CHAIN_ID, pool: entry.pool, factory, collateral: d.token,
        marketId: entry.marketId, outcomeCount, registeredBlock, status: resolved ? 'resolved' : 'active',
        markBlock: asOfBlock, markBlockHash: hash(pinned.hash) };
      if (resolved) market.winner = Number(await read(entry.pool, 'outcome() view returns(uint8)')) - (version === 'V1' ? 1 : 0);
      else market.pricesUnits = version === 'V1' ? [
        (await read(entry.pool, 'priceYes() view returns(uint256)')).toString(),
        (await read(entry.pool, 'priceNo() view returns(uint256)')).toString(),
      ] : (await read(entry.pool, 'prices() view returns(uint256[])')).map(String);
      markets.push(market);
      const abi = interfaces[version], seen = new Map();
      let resolutions = 0;
      for (let from = registeredBlock; from <= asOfBlock; from += 2000) {
        budget(); const logs = await provider.getLogs({ address: entry.pool, fromBlock: from,
          toBlock: Math.min(from + 1999, asOfBlock), topics: [Object.keys(abi.events).map(name => abi.getEventTopic(name))] });
        logCount += logs.length;
        if (logCount > 50_000) fail('snapshot_log_budget_exceeded');
        for (const log of logs) {
          if (address(log.address) !== entry.pool || log.blockNumber < from || log.blockNumber > Math.min(from + 1999,asOfBlock)) fail('log_outside_requested_range');
          const timestamp = await verifyLog(log), parsed = abi.parseLog(log), a = parsed.args;
          const key = `${hash(log.transactionHash)}:${log.logIndex}`;
          const fingerprint = planHash({ blockHash: hash(log.blockHash), data: log.data, topics: log.topics });
          if (seen.has(key)) { if (seen.get(key) !== fingerprint) fail('conflicting_event_identity'); continue; }
          seen.set(key, fingerprint);
          if (['MarketCanceled','ResolutionDisputeOpened','ResolutionDisputeCleared','MarketResolutionCorrected','CancelRefunded'].includes(parsed.name)) fail('unsupported_market_lifecycle');
          if (parsed.name === 'MarketResolved') {
            resolutions++;
            if (a.marketId.toString() !== entry.marketId || !resolved
              || Number(a.outcome) - (version === 'V1' ? 1 : 0) !== market.winner) fail('resolution_mark_mismatch');
            continue;
          }
          if (log.blockNumber < fromBlock) fail('trade_precedes_cycle');
          const side = { SharesBought:'buy', SharesSold:'sell', WinningsRedeemed:'redeem' }[parsed.name];
          if (!side) fail('unknown_scoring_event');
          events.push({ chainId: TOURNAMENT_CHAIN_ID, pool: entry.pool,
            wallet: address(a.buyer || a.seller || a.user), side, blockNumber: log.blockNumber,
            blockHash: hash(log.blockHash), logIndex: log.logIndex, txHash: hash(log.transactionHash), timestamp,
            outcomeIndex: version === 'V2' ? Number(a.outcomeIndex) : side === 'redeem' ? null : a.isYes ? 0 : 1,
            sharesUnits: (a.sharesOut || a.sharesIn || a.shares).toString(),
            collateralUnits: (a.collateralIn || a.collateralOut || a.payout).toString() });
        }
      }
      if (resolutions !== (resolved ? 1 : 0)) fail('resolution_history_mismatch');
    }
  }
  if (markets.length !== manifest.markets.length) fail('market_outside_cycle');
  // Numeric historical eth_call is bracketed by hash checks for every block
  // used, including funding/creation blocks and the pricing cutoff.
  for (const [n,b] of blocks) {
    budget(); if (hash((await provider.getBlock(n))?.hash) !== hash(b.hash)) fail('snapshot_reorg');
  }
  events.sort((a,b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  const snapshot = { cycle, reviewedPlanHash: digest, fromBlock,
    asOf: { blockNumber: asOfBlock, blockHash: hash(pinned.hash), timestamp: new Date(pinned.timestamp * 1000).toISOString() }, markets, events };
  const scores = buildTournamentShadowScores(snapshot);
  const artifact = { version: 1, mode: 'shadow', readyForRewards: false, registry: manifest,
    registryHash, funding: fundingProof, snapshot, scores };
  return { ...artifact, snapshotHash: planHash(artifact) };
}
