// Shadow accounting only. The snapshot adapter supplies canonical, complete
// ERC20/1155 movements and grant proofs; this module never accesses a wallet.
const ZERO = '0x' + '0'.repeat(40);
const SCALE = 1_000_000n;
const fail = code => { throw new Error(code); };
const units = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) fail('invalid_transfer_units');
  return BigInt(value);
};
const order = (a,b) => a.blockNumber-b.blockNumber || a.logIndex-b.logIndex || (a.itemIndex||0)-(b.itemIndex||0);
const identity = m => `${m.txHash}:${m.logIndex}:${m.itemIndex || 0}`;
const keyOf = m => `${m.pool}:${m.outcomeIndex ?? m.outcome}`;
const ceil = (a,b) => a === 0n ? 0n : (a+b-1n)/b;
const min = (a,b) => a<b?a:b;

export function reconcileTournamentTransfers({ users, registered, events, assetLedger, deployment, asOf }) {
  if (assetLedger.version!==1 || !Number.isSafeInteger(assetLedger.fromBlock) || assetLedger.fromBlock<1
    || !Array.isArray(assetLedger.movements) || !Array.isArray(assetLedger.grants)) fail('invalid_asset_ledger');
  const accounts = new Map(users.map(u=>[u.wallet,{...u,cash:0n,eligibleCash:0n,positions:new Map(),eventCount:0,granted:false}]));
  const position = (account,key) => {
    if (!account.positions.has(key)) account.positions.set(key,{shares:0n,eligible:0n,basis:0n,eligibleBasis:0n});
    return account.positions.get(key);
  };
  const movements=[], seen=new Map(), slots=new Map(), blocks=new Map(), byTx=new Map(), byId=new Map();
  const canonical = m => {
    for (const field of ['blockNumber','logIndex','itemIndex']) if (!Number.isSafeInteger(m[field]) || m[field]<0) fail('invalid_transfer_position');
    if (m.blockNumber<assetLedger.fromBlock || m.blockNumber>asOf.blockNumber
      || !/^0x[0-9a-f]{64}$/.test(m.txHash||'') || !/^0x[0-9a-f]{64}$/.test(m.blockHash||'')) fail('invalid_transfer_position');
    if ((m.blockNumber===asOf.blockNumber && m.blockHash!==asOf.blockHash)
      || (blocks.has(m.blockNumber) && blocks.get(m.blockNumber)!==m.blockHash)) fail('inconsistent_block_hash');
    blocks.set(m.blockNumber,m.blockHash);
    const slot=`${m.blockNumber}:${m.logIndex}`;
    if (slots.has(slot) && slots.get(slot)!==m.txHash) fail('conflicting_log_position');
    slots.set(slot,m.txHash);
  };
  for (const m of assetLedger.movements) {
    canonical(m);units(m.units);
    if (![m.from,m.to].every(a=>/^0x[0-9a-f]{40}$/.test(a||'')) || !['cash','share'].includes(m.kind)) fail('invalid_asset_movement');
    if (m.kind==='cash' && m.token!==deployment.token) fail('transfer_outside_cycle');
    if (m.kind==='share') {
      const market=registered.get(m.pool), version=market?.factory===deployment.factoryV1?'V1':'V2';
      if (!market || m.token!==deployment[`share${version}`] || !Number.isInteger(m.outcomeIndex)
        || m.outcomeIndex<0 || m.outcomeIndex>=market.outcomeCount || m.blockNumber<market.registeredBlock) fail('transfer_outside_cycle');
    }
    const id=identity(m), fingerprint=JSON.stringify(m);
    if (seen.has(id)) {if(seen.get(id)!==fingerprint)fail('conflicting_transfer_identity');continue;}
    seen.set(id,fingerprint);byId.set(id,m);movements.push(m);
    if (!byTx.has(m.txHash)) byTx.set(m.txHash,[]);
    byTx.get(m.txHash).push(m);
  }
  movements.sort(order);
  const assetSlots=new Set(movements.map(m=>`${m.blockNumber}:${m.logIndex}`));
  for (const event of events) {
    canonical({...event,itemIndex:0});
    if (assetSlots.has(`${event.blockNumber}:${event.logIndex}`)) fail('conflicting_log_position');
  }
  const grants=new Map(), grantedWallets=new Set();
  for (const proof of assetLedger.grants) {
    const movement=byId.get(identity(proof)), user=accounts.get(proof.wallet);
    if (!user || grantedWallets.has(user.wallet) || !movement || movement.kind!=='cash' || movement.to!==user.wallet
      || movement.blockNumber!==proof.blockNumber || movement.blockHash!==proof.blockHash
      || movement.units!==user.openingUnits || movement.from!==(user.registeredBlock?deployment.operations:ZERO)
      || (user.registeredBlock && (movement.blockNumber!==user.registeredBlock || movement.logIndex!==user.registeredLogIndex))
      || (!user.registeredBlock && movement.blockNumber>=assetLedger.cycleFromBlock)) fail('invalid_asset_grant');
    grantedWallets.add(user.wallet);grants.set(identity(movement),user.wallet);
  }
  if (grantedWallets.size!==accounts.size) fail('missing_asset_grant');

  // Match exact user-facing legs, not every movement in a trade receipt. Extra
  // gifts in that same transaction remain external. Ambiguous or interleaved
  // user movements require review rather than guessing their attribution.
  const consumed=new Set(), actions=new Map(), previous=new Map();
  for (const event of events) {
    const boundary=`${event.txHash}:${event.pool}`, low=previous.get(boundary)??-1;
    previous.set(boundary,event.logIndex);
    const candidates=(byTx.get(event.txHash)||[]).filter(m=>m.logIndex>low && m.logIndex<event.logIndex);
    const legs=[];
    const take = (predicate,ordered=false) => {
      const found=candidates.filter(m=>!consumed.has(identity(m)) && predicate(m));
      if (!found.length || (!ordered && found.length!==1)) fail('trade_transfer_legs_mismatch');
      found.sort(order);
      const m=found[0];consumed.add(identity(m));legs.push(m);return m;
    };
    const share = (from,to,outcome,amount,burn=false) => take(m=>m.kind==='share' && m.pool===event.pool
      && m.from===from && m.to===to && m.outcomeIndex===outcome && m.units===amount
      && (!burn || m.operator===event.pool),event.side==='refund');
    if (event.side==='refund') {
      for (const burn of event.burns) share(event.wallet,ZERO,burn.outcomeIndex,burn.sharesUnits,true);
    } else share(event.side==='buy'?event.pool:event.wallet,event.side==='buy'?event.wallet:event.side==='sell'?event.pool:ZERO,
      event.outcome,event.sharesUnits,event.side==='redeem');
    if (units(event.collateralUnits)>0n) take(m=>m.kind==='cash' && m.units===event.collateralUnits
      && m.from===(event.side==='buy'?event.wallet:event.pool) && m.to===(event.side==='buy'?event.pool:event.wallet));
    legs.sort(order);
    const first=legs[0];
    if (!first || actions.has(identity(first))) fail('trade_transfer_legs_mismatch');
    actions.set(identity(first),{event,legs});
  }
  for (const {event,legs} of actions.values()) {
    const ids=new Set(legs.map(identity)), first=legs[0];
    if ((byTx.get(event.txHash)||[]).some(m=>m.logIndex>=first.logIndex && m.logIndex<event.logIndex
      && (m.from===event.wallet || m.to===event.wallet) && !ids.has(identity(m)))) fail('interleaved_user_transfers_require_review');
  }
  const external=[], eligibleEvents=[], eligibleRemovals=[];
  function debitCash(account,amount) {
    if (amount>account.cash) fail('transfer_exceeds_actual_cash');
    const eligible=amount===0n?0n:ceil(amount*account.eligibleCash,account.cash);
    account.cash-=amount;account.eligibleCash-=eligible;return eligible;
  }
  function debitShares(p,amount,external=true) {
    if (amount>p.shares) fail('transfer_exceeds_actual_shares');
    const before=p.shares, eligible=amount===0n?0n:ceil(amount*p.eligible,before);
    const basis=eligible===0n?0n:external?ceil(p.eligibleBasis*eligible,p.eligible):p.eligibleBasis*eligible/p.eligible;
    p.shares-=amount;p.eligible-=eligible;p.eligibleBasis-=basis;
    return {before,eligible,basis};
  }
  function trade(event) {
    const account=accounts.get(event.wallet), market=registered.get(event.pool);
    const shares=units(event.sharesUnits), cash=units(event.collateralUnits);
    let scoredShares=0n, scoredCash=0n;
    if (event.side==='buy') {
      if (cash===0n || cash>account.cash) fail('purchase_exceeds_actual_cash');
      const eligibleShares=shares*account.eligibleCash/account.cash;
      const eligibleBasis=cash*account.eligibleCash/account.cash;
      scoredCash=debitCash(account,cash);scoredShares=eligibleShares;
      const p=position(account,keyOf(event));p.shares+=shares;p.eligible+=eligibleShares;p.basis+=cash;p.eligibleBasis+=eligibleBasis;
    } else if (event.side==='refund') {
      let maximum=0n, eligibleMaximum=0n;
      for (const burn of event.burns) {
        const p=position(account,`${event.pool}:${burn.outcomeIndex}`), amount=units(burn.sharesUnits);
        if (amount>p.shares || amount===0n) fail('refund_exceeds_actual_holdings');
        const reduction=p.basis*amount/p.shares;
        const eligibleReduction=min(p.eligibleBasis,reduction*p.eligible/p.shares);
        const removed=debitShares(p,amount,false);
        maximum+=reduction;eligibleMaximum+=min(eligibleReduction,removed.basis);p.basis-=reduction;
      }
      if (cash>maximum) fail('refund_exceeds_cost_basis');
      scoredCash=maximum===0n?0n:cash*eligibleMaximum/maximum;
      account.cash+=cash;account.eligibleCash+=scoredCash;
    } else {
      const p=position(account,keyOf(event));
      if (shares>p.shares || p.shares===0n) fail('sale_or_redemption_exceeds_actual_holdings');
      if (event.side==='redeem' && (market.status!=='resolved' || event.outcome!==market.winner || cash!==shares)) fail('invalid_redemption');
      const eligibleCash=cash*p.eligible/p.shares, reduction=p.basis*shares/p.shares;
      scoredShares=debitShares(p,shares,false).eligible;scoredCash=eligibleCash;
      // Contracts retain purchase basis after redemption; only sales and
      // cancellation refunds reduce it. Scoring basis is a separate budget.
      if (event.side==='sell') p.basis-=reduction;
      account.cash+=cash;account.eligibleCash+=eligibleCash;
    }
    if (account.granted) account.eventCount++;
    if (account.granted && (scoredShares>0n || scoredCash>0n)) eligibleEvents.push({...event,
      sharesUnits:scoredShares.toString(),collateralUnits:scoredCash.toString()});
  }
  for (const m of movements) {
    const action=actions.get(identity(m));
    if (action) {trade(action.event);continue;}
    if (consumed.has(identity(m))) continue;
    const amount=units(m.units), sender=accounts.get(m.from), recipient=accounts.get(m.to);
    if (m.from===m.to || amount===0n) continue;
    if (m.kind==='cash') {
      if (sender) debitCash(sender,amount);
      if (recipient) {recipient.cash+=amount;if(grants.has(identity(m))){recipient.eligibleCash+=amount;recipient.granted=true;}}
    } else {
      if (sender) {
        const removed=debitShares(position(sender,keyOf(m)),amount);
        if (sender.granted && removed.eligible>0n) eligibleRemovals.push({...m,wallet:sender.wallet,sharesUnits:removed.eligible.toString()});
      }
      if (recipient) position(recipient,keyOf(m)).shares+=amount;
    }
    if ((sender||recipient) && !grants.has(identity(m))) external.push(m);
  }
  const accountingPositions=[], actualPositions=[];
  const rows=[...accounts.values()].map(a=>{
    if (!a.granted || a.eligibleCash<0n || a.eligibleCash>a.cash) fail('eligible_balance_invariant');
    let open=0n;
    for (const [key,p] of a.positions) {
      if(p.eligible<0n || p.eligible>p.shares || p.eligibleBasis<0n) fail('eligible_balance_invariant');
      const [pool,outcome]=key.split(':'),market=registered.get(pool);
      const claim=p.shares===0n?0n:min(p.eligibleBasis,p.basis*p.eligible/p.shares);
      const value=market.status==='canceled'?claim:p.eligible*market.prices[Number(outcome)]/SCALE;
      open+=value;
      const common={wallet:a.wallet,pool,outcomeIndex:Number(outcome)};
      accountingPositions.push({...common,sharesUnits:p.eligible.toString(),costBasisUnits:p.eligibleBasis.toString(),valueUnits:value.toString()});
      actualPositions.push({...common,sharesUnits:p.shares.toString(),costBasisUnits:p.basis.toString()});
    }
    const equity=a.eligibleCash+open;
    return {username:a.username,wallet:a.wallet,openingUnits:a.openingUnits,cashUnits:a.eligibleCash.toString(),
      actualCashUnits:a.cash.toString(),excludedCashUnits:(a.cash-a.eligibleCash).toString(),openValueUnits:open.toString(),
      equityUnits:equity.toString(),pnlUnits:(equity-units(a.openingUnits)).toString(),eventCount:a.eventCount};
  });
  rows.sort((a,b)=>BigInt(a.pnlUnits)===BigInt(b.pnlUnits)?a.username.localeCompare(b.username):BigInt(a.pnlUnits)>BigInt(b.pnlUnits)?-1:1);
  return {rows:rows.map((r,i)=>({...r,rank:i+1})),accountingPositions,actualPositions,eligibleEvents,eligibleRemovals,
    transferReconciliation:{version:1,policy:'exclude_incoming_proportional_outgoing',externalMovements:external,
      scoredEvents:rows.reduce((n,r)=>n+r.eventCount,0),historicalBalancesVerified:false}};
}
