// Read models for the Points UI. Database IDs and contract IDs are deliberately
// separate; only a chain + pool + configured factory join establishes identity.
export function jsonArray(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export function marketView(row) {
  const outcomes = jsonArray(row.protocol_outcomes || row.outcomes);
  const count = outcomes.length;
  let prices = jsonArray(row.prices).map(Number);
  if (!prices.length && count === 2 && row.yes_price != null && row.no_price != null) {
    prices = [Number(row.yes_price), Number(row.no_price)];
  }
  const validPrices = prices.length === count && count >= 2
    && prices.every(p => Number.isFinite(p) && p >= 0 && p <= 1);
  const linked = row.protocol_id != null && Number(row.chain_id) === Number(row.protocol_chain_id)
    && String(row.chain_address).toLowerCase() === String(row.pool_address).toLowerCase()
    && row.chain_market_id != null && String(row.chain_market_id) === String(row.contract_market_id);
  return {
    id: Number(row.id), mode: row.mode || 'points',
    parentMarketId: row.parent_id == null ? null : Number(row.parent_id),
    legLabel: row.leg_label || null, question: row.parent_question || row.question,
    category: row.category, outcomes,
    chainId: Number(row.chain_id) || null, chainAddress: row.chain_address,
    chainMarketId: row.chain_market_id == null ? null : String(row.chain_market_id),
    protocolMarketId: linked ? Number(row.protocol_id) : null,
    factoryAddress: linked ? row.factory_address?.toLowerCase() || null : null,
    status: linked ? row.protocol_status : row.status,
    // V1 uses 0=unresolved, 1=YES, 2=NO. V2 and Points use zero-based indexes.
    outcome: linked && row.protocol_status === 'resolved' && row.protocol_outcome != null
      ? Number(row.protocol_outcome) - (row.protocol_version === 'v2' ? 0 : 1) : null,
    endTime: linked ? row.protocol_end_time : row.end_time,
    prices: linked && validPrices ? prices : [],
    volume24h: linked ? Number(row.volume_24h || 0) : 0,
    liquidity: linked ? Number(row.liquidity || 0) : 0,
    snapshotAt: linked ? row.snapshot_at || null : null,
    executionReady: Boolean(linked && validPrices && row.snapshot_at),
  };
}

const num = value => Number(value || 0);
const epsilon = 0.000001;

// Reconstruct per-outcome cost basis from immutable events. The legacy V1
// positions table has a shared total_cost for YES and NO and redemptions do not
// update its share counts, so it cannot back this view safely.
export function portfolioView(markets, trades, redemptions) {
  const byProtocol = new Map(markets.filter(m => m.protocolMarketId).map(m => [m.protocolMarketId, m]));
  const groups = new Map();
  const events = [
    ...trades.map(t => ({ ...t, kind: t.side })),
    ...redemptions.map(r => ({ ...r, kind: 'redeem' })),
  ].sort((a, b) => num(a.block_number) - num(b.block_number) || num(a.log_index) - num(b.log_index));
  for (const event of events) {
    const market = byProtocol.get(Number(event.market_id));
    if (!market) continue;
    let group = groups.get(market.id);
    if (!group) {
      group = { ...market, marketId: market.id, transactions: [], holdings: new Map(), totalInvested: 0, totalReceived: 0 };
      groups.set(market.id, group);
    }
    const index = event.outcome_index != null ? Number(event.outcome_index)
      : event.kind === 'redeem' ? market.outcome : event.is_yes === true ? 0 : event.is_yes === false ? 1 : null;
    const shares = num(event.shares_amt ?? event.shares);
    const collateral = num(event.kind === 'redeem' ? event.payout : event.collateral_amt);
    // Factory cancellation refunds currently carry no per-outcome burn data in
    // the index. Do not report the pre-refund holdings as spendable/claimable.
    if (event.kind === 'redeem' && shares === 0 && collateral > 0) {
      throw Object.assign(new Error('onchain_accounting_unavailable'), { status: 503 });
    }
    if (!Number.isInteger(index) || index < 0 || index >= market.outcomes.length
      || !Number.isFinite(shares) || !Number.isFinite(collateral) || shares < 0 || collateral < 0) {
      throw Object.assign(new Error('onchain_accounting_unavailable'), { status: 503 });
    }
    const holding = group.holdings.get(index) || { shares: 0, costBasis: 0, realizedPnl: 0 };
    if (event.kind === 'buy') {
      holding.shares += shares;
      holding.costBasis += collateral; // gross collateral already includes the fee
      group.totalInvested += collateral;
    } else {
      if (shares > holding.shares + epsilon) {
        throw Object.assign(new Error('onchain_accounting_unavailable'), { status: 503 });
      }
      const removedCost = holding.shares > 0 ? holding.costBasis * Math.min(1, shares / holding.shares) : 0;
      holding.shares = Math.max(0, holding.shares - shares);
      holding.costBasis = Math.max(0, holding.costBasis - removedCost);
      holding.realizedPnl += collateral - removedCost; // sell proceeds are already net of fee
      group.totalReceived += collateral;
    }
    group.holdings.set(index, holding);
    group.transactions.push({
      side: event.kind, outcomeIndex: index, outcomeLabel: market.outcomes[index],
      shares, collateral, fee: num(event.fee_amt), createdAt: event.created_at,
    });
  }
  const positions = [];
  const history = [];
  let realizedPnl = 0;
  let valuationPending = false;
  for (const group of groups.values()) {
    const { holdings, ...base } = group;
    if (group.status === 'resolved' && (!Number.isInteger(group.outcome)
      || group.outcome < 0 || group.outcome >= group.outcomes.length)) {
      throw Object.assign(new Error('onchain_accounting_unavailable'), { status: 503 });
    }
    let markToMarket = 0;
    let claimablePayout = 0;
    let remaining = 0;
    for (const [index, holding] of holdings) {
      realizedPnl += holding.realizedPnl;
      const resolved = group.status === 'resolved';
      const price = resolved ? (group.outcome === index ? 1 : 0) : group.prices[index];
      if (holding.shares > epsilon && price == null) valuationPending = true;
      const currentValue = holding.shares * (price ?? 0);
      remaining += holding.shares;
      markToMarket += currentValue;
      if (resolved && group.outcome === index) claimablePayout += holding.shares;
      if (holding.shares > epsilon) positions.push({
        ...base, ...holding, outcomeIndex: index,
        outcomeLabel: group.legLabel ? `${group.legLabel} · ${group.outcomes[index]}` : group.outcomes[index],
        currentPrice: price ?? null, currentValue,
        unrealizedPnl: currentValue - holding.costBasis,
        pnl: currentValue - holding.costBasis + holding.realizedPnl,
        claimablePayout: resolved && group.outcome === index ? holding.shares : 0,
        canRedeem: resolved && group.outcome === index,
      });
    }
    const winner = group.outcome;
    const won = (holdings.get(winner)?.shares || 0) > epsilon
      || group.transactions.some(t => t.side === 'redeem' && t.outcomeIndex === winner);
    const outcomeStatus = group.status === 'canceled' ? 'canceled'
      : group.status === 'resolved' ? (won ? 'won' : remaining <= epsilon ? 'exited' : 'lost')
        : remaining <= epsilon ? 'exited' : 'open';
    history.push({ ...base, markToMarket, claimablePayout, canRedeem: claimablePayout > epsilon, outcomeStatus,
      winningOutcomeIndex: winner, winningOutcomeLabel: group.outcomes[winner] || null,
      pickedOutcomeLabel: [...holdings.keys()].map(i => group.outcomes[i]).join(', '),
      netPnl: group.totalReceived + markToMarket - group.totalInvested,
    });
  }
  // Never present an incomplete index as a zero-valued position.
  if (valuationPending) throw Object.assign(new Error('onchain_index_pending'), { status: 503 });
  const sum = key => positions.reduce((total, p) => total + num(p[key]), 0);
  return { mode: 'onchain', positions, history: history.reverse(),
    summary: { totalPositions: positions.length, activePositions: positions.filter(p => p.status === 'active').length,
      totalInvested: sum('costBasis'), currentValue: sum('currentValue'), pnl: sum('pnl'),
      unrealizedPnl: sum('unrealizedPnl'), realizedPnl,
      totalPnl: history.reduce((total, h) => total + h.netPnl, 0),
      marketsTotal: history.length,
      marketsWon: history.filter(h => h.outcomeStatus === 'won').length,
      marketsLost: history.filter(h => h.outcomeStatus === 'lost').length,
      marketsOpen: history.filter(h => h.outcomeStatus === 'open').length,
      marketsExited: history.filter(h => h.outcomeStatus === 'exited').length,
      marketsPending: history.filter(h => h.outcomeStatus === 'pending').length,
      marketsCanceled: history.filter(h => h.outcomeStatus === 'canceled').length,
      marketsCycleClosed: 0,
    },
  };
}
