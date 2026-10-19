import { address, planHash, validateTournamentPlan } from './sepolia-tournament.js';
import { normalizeUsername } from './onchain-reset-plan.js';
import { reconcileTournamentTransfers } from './sepolia-tournament-transfers.js';

const SCALE = 1_000_000n;
const fail = code => { throw new Error(code); };
const integer = value => {
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid_block_or_index');
  return value;
};
const units = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) fail('integer_unit_string_required');
  return BigInt(value);
};
const hash = value => {
  if (!/^0x[0-9a-f]{64}$/i.test(value || '')) fail('canonical_hash_required');
  return value.toLowerCase();
};

// Opening grants come only from an immutable, completely funded plan. The
// operations allocation and current ERC20 balances are never registrations.
export function tournamentRegistrations({ cycle, reviewedPlanHash, lateRegistrations = [] }) {
  const plan = validateTournamentPlan(cycle.plan);
  const digest = planHash(plan);
  if (cycle.status !== 'funded' || cycle.plan_hash !== digest || reviewedPlanHash !== digest) {
    fail('reviewed_funded_cycle_required');
  }
  const users = plan.batches.flatMap(b => b.recipients).filter(r => r.kind === 'user')
    .map(r => ({ username:r.username, wallet:r.wallet, suborg:r.suborg, openingUnits:r.units }));
  const names = new Set(users.map(u=>u.username)), wallets = new Set(users.map(u=>u.wallet)), orgs = new Set(users.map(u=>u.suborg));
  let granted = 0n;
  for (const r of lateRegistrations) {
    const wallet = address(r.wallet), timestamp = Date.parse(r.timestamp);
    if (plan.lateJoining!=='open_during_cycle' || r.planHash!==digest || r.openingUnits!==plan.allocationUnits
      || !r.suborg || normalizeUsername(r.username)!==r.username || !r.username
      || names.has(r.username) || wallets.has(wallet) || orgs.has(r.suborg)
      || Object.values(plan.deployment).includes(wallet)
      || !Number.isFinite(timestamp) || timestamp<Date.parse(plan.startsAt) || timestamp>=Date.parse(plan.endsAt)) fail('invalid_late_registration');
    integer(r.blockNumber);integer(r.logIndex);hash(r.txHash);hash(r.blockHash);
    granted += units(r.openingUnits);
    if (granted > units(plan.lateJoinReserveUnits)) fail('late_join_reserve_exceeded');
    names.add(r.username);wallets.add(wallet);orgs.add(r.suborg);
    users.push({...r,wallet,registeredBlock:r.blockNumber,registeredLogIndex:r.logIndex});
  }
  return { plan, digest, users };
}

// Pure shadow calculation, deliberately not wired into any API or rewards.
// The future indexer adapter must prove canonical logs, complete coverage,
// factory registration and prices at the pinned block before calling this.
// No ERC20/1155 balance, mint, transfer or faucet event can add score.
export function buildTournamentShadowScores({ cycle, reviewedPlanHash, lateRegistrations = [], fromBlock, asOf,
  markets = [], events = [], assetLedger }) {
  const { plan, digest, users } = tournamentRegistrations({ cycle, reviewedPlanHash, lateRegistrations });
  integer(fromBlock); integer(asOf.blockNumber);
  const blockHash = hash(asOf.blockHash), cutoff = Date.parse(asOf.timestamp);
  const start = Date.parse(plan.startsAt), end = Date.parse(plan.endsAt);
  if (asOf.blockNumber < fromBlock || !Number.isFinite(cutoff) || cutoff < start || cutoff > end) fail('invalid_scoring_cutoff');
  if (users.some(u => u.registeredBlock > asOf.blockNumber || (u.timestamp && Date.parse(u.timestamp)>cutoff))) fail('registration_after_cutoff');
  const registered = new Map();
  for (const row of markets) {
    const pool = address(row.pool), factory = address(row.factory);
    if (row.chainId !== plan.deployment.chainId || address(row.collateral) !== plan.deployment.token
      || ![plan.deployment.factoryV1, plan.deployment.factoryV2].includes(factory)) fail('market_outside_cycle');
    if (registered.has(pool)) fail('duplicate_registered_pool');
    units(row.marketId);
    if (!Number.isInteger(row.outcomeCount) || row.outcomeCount < 2 || row.outcomeCount > 8
      || (factory === plan.deployment.factoryV1 && row.outcomeCount !== 2)) fail('invalid_outcome_count');
    if (integer(row.registeredBlock) > asOf.blockNumber) fail('market_registered_after_cutoff');
    if (row.markBlock !== asOf.blockNumber || hash(row.markBlockHash) !== blockHash) fail('stale_market_mark');
    if (!['active', 'resolved', 'canceled'].includes(row.status)) fail('unsupported_market_lifecycle');
    if (row.disputed) fail('open_dispute_requires_review');
    let prices;
    if (row.status === 'resolved') {
      if (!Number.isInteger(row.winner) || row.winner < 0 || row.winner >= row.outcomeCount) fail('invalid_winner');
      prices = Array.from({ length: row.outcomeCount }, (_, i) => i === row.winner ? SCALE : 0n);
    } else if (row.status === 'canceled') {
      prices = Array.from({length:row.outcomeCount},()=>0n);
    } else {
      if (!Array.isArray(row.pricesUnits) || row.pricesUnits.length !== row.outcomeCount) fail('missing_market_prices');
      prices = row.pricesUnits.map(units);
      const total = prices.reduce((a,b) => a+b, 0n);
      if (prices.some(p => p > SCALE) || total > SCALE
        || total < SCALE - BigInt(row.outcomeCount)) fail('invalid_market_prices');
    }
    registered.set(pool, { ...row, pool, factory, prices });
  }
  const accounts = new Map(users.map(user => [user.wallet, {
    ...user, cash: units(user.openingUnits), positions: new Map(), basis: new Map(), eventCount: 0,
  }]));
  const seen = new Map(), slots = new Map(), blockHashes = new Map(), accepted = [];
  for (const registration of lateRegistrations) {
    const value=hash(registration.blockHash), n=registration.blockNumber;
    if (blockHashes.has(n)&&blockHashes.get(n)!==value) fail('inconsistent_block_hash');
    blockHashes.set(n,value);
  }
  let ignored = 0, duplicates = 0;
  for (const row of events) {
    // Foreign-chain markets, unregistered wallets and token transfers cannot
    // enter the cashflow ledger, even if a caller supplies a large balance.
    const market = registered.get(String(row.pool || '').toLowerCase());
    const account = accounts.get(String(row.wallet || '').toLowerCase());
    if (!market || !account || row.chainId !== plan.deployment.chainId
      || !['buy','sell','redeem','refund'].includes(row.side)) { ignored++; continue; }
    const blockNumber = integer(row.blockNumber), logIndex = integer(row.logIndex);
    const timestamp = Date.parse(row.timestamp);
    if (!Number.isFinite(timestamp)) fail('event_timestamp_required');
    if (blockNumber < fromBlock || blockNumber > asOf.blockNumber || timestamp < start || timestamp > cutoff) { ignored++; continue; }
    if (!assetLedger && account.registeredBlock && (blockNumber < account.registeredBlock
      || (blockNumber===account.registeredBlock && logIndex<=account.registeredLogIndex))) { ignored++;continue; }
    if (blockNumber < market.registeredBlock) fail('event_precedes_market_registration');
    if (timestamp >= end && !['redeem','refund'].includes(row.side)) fail('trade_after_cycle_end');
    const eventBlockHash = hash(row.blockHash);
    if ((blockNumber === asOf.blockNumber && eventBlockHash !== blockHash)
      || (blockHashes.has(blockNumber) && blockHashes.get(blockNumber) !== eventBlockHash)) fail('inconsistent_block_hash');
    blockHashes.set(blockNumber, eventBlockHash);
    const outcome = row.side==='refund' ? -1 : row.outcomeIndex == null && row.side === 'redeem'
      && market.factory === plan.deployment.factoryV1 ? market.winner : row.outcomeIndex;
    if (row.side!=='refund' && (!Number.isInteger(outcome) || outcome < 0 || outcome >= market.outcomeCount)) fail('invalid_event_outcome');
    const shares = units(row.sharesUnits), collateral = units(row.collateralUnits);
    if (shares === 0n) fail('zero_event_shares');
    // buy.collateral is gross; sell.collateral is already net of its fee.
    // Neither fee is subtracted twice. Redemption is 1:1 on these contracts.
    let burns;
    if (row.side==='refund') {
      if (market.status!=='canceled' || !Array.isArray(row.burns) || !row.burns.length) fail('invalid_refund');
      burns = row.burns.map(b=>{
        if (!Number.isInteger(b.outcomeIndex)||b.outcomeIndex<0||b.outcomeIndex>=market.outcomeCount||units(b.sharesUnits)===0n) fail('invalid_refund_burn');
        return {outcomeIndex:b.outcomeIndex,sharesUnits:b.sharesUnits};
      });
      if (burns.reduce((sum,b)=>sum+units(b.sharesUnits),0n)!==shares) fail('refund_burn_total_mismatch');
    }
    const event = { ...(burns?{burns}:{}), chainId: row.chainId, pool: market.pool, wallet: account.wallet, side: row.side,
      blockNumber, blockHash: eventBlockHash, logIndex, txHash: hash(row.txHash), timestamp,
      outcome, sharesUnits: shares.toString(), collateralUnits: collateral.toString() };
    const id = `${row.chainId}:${event.txHash}:${logIndex}`, fingerprint = planHash(event);
    const slot = `${blockNumber}:${logIndex}`;
    if (slots.has(slot) && slots.get(slot) !== id) fail('conflicting_log_position');
    slots.set(slot, id);
    if (seen.has(id)) {
      if (seen.get(id) !== fingerprint) fail('conflicting_event_identity');
      duplicates++; continue;
    }
    seen.set(id, fingerprint); accepted.push(event);
  }
  accepted.sort((a,b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  if (assetLedger) {
    if (assetLedger.cycleFromBlock!==fromBlock || assetLedger.fromBlock>fromBlock) fail('invalid_asset_ledger');
    const reconciled=reconcileTournamentTransfers({users,registered,events:accepted,assetLedger,deployment:plan.deployment,
      asOf:{...asOf,blockHash}});
    return {mode:'shadow',readyForRewards:false,cycleId:plan.cycleId,planHash:digest,token:plan.deployment.token,
      chainId:plan.deployment.chainId,asOf:{blockNumber:asOf.blockNumber,blockHash,timestamp:new Date(cutoff).toISOString()},
      acceptedEvents:reconciled.transferReconciliation.scoredEvents,
      ignoredEvents:ignored+accepted.length-reconciled.transferReconciliation.scoredEvents,duplicateEvents:duplicates,...reconciled};
  }
  for (const event of accepted) {
    const account = accounts.get(event.wallet), market = registered.get(event.pool);
    const shares = units(event.sharesUnits), collateral = units(event.collateralUnits);
    if (event.side==='refund') {
      let refundable = 0n;
      for (const burn of event.burns) {
        const key=`${event.pool}:${burn.outcomeIndex}`, held=account.positions.get(key)||0n, amount=units(burn.sharesUnits);
        if (amount>held) fail('refund_exceeds_registered_holdings');
        const basis=account.basis.get(key)||0n, reduction=basis*amount/held;
        refundable+=reduction;account.positions.set(key,held-amount);account.basis.set(key,basis-reduction);
      }
      if (collateral>refundable) fail('refund_exceeds_cost_basis');
      account.cash+=collateral;account.eventCount++;continue;
    }
    const key = `${event.pool}:${event.outcome}`, held = account.positions.get(key) || 0n;
    if (event.side === 'buy') {
      if (collateral === 0n || collateral > account.cash) fail('purchase_exceeds_scoring_cash');
      account.cash -= collateral; account.positions.set(key, held + shares);
      account.basis.set(key,(account.basis.get(key)||0n)+collateral);
    } else {
      if (shares > held) fail('sale_or_redemption_exceeds_registered_holdings');
      if (event.side === 'redeem' && (market.status !== 'resolved'
        || event.outcome !== market.winner || collateral !== shares)) fail('invalid_redemption');
      account.cash += collateral; account.positions.set(key, held - shares);
      const basis=account.basis.get(key)||0n;
      account.basis.set(key,basis-basis*shares/held);
    }
    account.eventCount++;
  }
  const rows = [...accounts.values()].map(account => {
    let open = 0n;
    for (const [key, shares] of account.positions) {
      const [pool, outcome] = key.split(':');
      open += registered.get(pool).status==='canceled' ? account.basis.get(key)||0n
        : shares * registered.get(pool).prices[Number(outcome)] / SCALE;
    }
    const equity = account.cash + open;
    return { username: account.username, wallet: account.wallet, openingUnits: account.openingUnits,
      cashUnits: account.cash.toString(), openValueUnits: open.toString(), equityUnits: equity.toString(),
      pnlUnits: (equity - units(account.openingUnits)).toString(), eventCount: account.eventCount };
  });
  rows.sort((a,b) => BigInt(a.pnlUnits) === BigInt(b.pnlUnits) ? (a.username < b.username ? -1 : a.username > b.username ? 1 : 0)
    : BigInt(a.pnlUnits) > BigInt(b.pnlUnits) ? -1 : 1);
  return { mode: 'shadow', readyForRewards: false, cycleId: plan.cycleId, planHash: digest,
    token: plan.deployment.token, chainId: plan.deployment.chainId,
    asOf: { blockNumber: asOf.blockNumber, blockHash, timestamp: new Date(cutoff).toISOString() },
    acceptedEvents: accepted.length, ignoredEvents: ignored, duplicateEvents: duplicates,
    transferReconciliation:{version:1,historicalBalancesVerified:false,policy:'not_captured'},
    accountingPositions:[...accounts.values()].flatMap(a=>[...a.positions].map(([key,shares])=>{
      const [pool,outcome]=key.split(':');return {wallet:a.wallet,pool,outcomeIndex:Number(outcome),sharesUnits:shares.toString(),costBasisUnits:(a.basis.get(key)||0n).toString()};
    })),
    rows: rows.map((row,index) => ({ ...row, rank: index+1 })) };
}
