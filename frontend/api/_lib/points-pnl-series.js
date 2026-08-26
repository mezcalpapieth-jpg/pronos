/**
 * Cumulative PnL time series for one user.
 *
 * PnL(t) = cashReceived(≤t) + valueOfHoldings(t) − cashInvested(≤t)
 *
 * Unrealized is included at every sample, not just the last one — a buy
 * therefore does NOT move the line (cash out is replaced by shares worth
 * the same at that instant), and an open position drifts with the market.
 * That keeps the curve's endpoint equal to the "PnL total" stat that sits
 * next to the chart, which the cash-flow-only version would not.
 *
 * Historical prices come from points_price_snapshots, which is written
 * best-effort on every trade plus a cron sweep — so there is always a
 * snapshot at each trade boundary, the moments the curve actually bends.
 * Before a market's first snapshot we fall back to its opening odds
 * (uniform 1/n), matching how the market charts open.
 *
 * The replay always starts at the user's first trade, even when the caller
 * only wants the last 30 days: cumulative PnL at the start of the window is
 * a real number, not zero, and resetting it would misreport the curve.
 */

const DEFAULT_MAX_POINTS = 120;

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function toMs(value) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Even-spaced downsample that always keeps the first and last sample.
 * Losing the last point would visibly disagree with the PnL stat, and
 * losing the first would make the window appear to start somewhere else.
 */
function thin(values, maxPoints) {
  if (values.length <= maxPoints) return values;
  const out = [];
  const step = (values.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(values[Math.round(i * step)]);
  }
  return Array.from(new Set(out));
}

/**
 * Latest snapshot at or before `t`, via a per-market cursor that only ever
 * moves forward. Samples are walked in ascending time, so this stays O(n)
 * across the whole series instead of re-scanning snapshots at every step.
 */
function priceLookup(snapshotsByMarket) {
  const cursors = new Map();
  return function pricesAt(marketId, t) {
    const list = snapshotsByMarket.get(marketId);
    if (!list || list.length === 0) return null;
    let i = cursors.get(marketId) ?? 0;
    while (i + 1 < list.length && list[i + 1].t <= t) i += 1;
    cursors.set(marketId, i);
    return list[i].t <= t ? list[i].prices : null;
  };
}

/**
 * @param {object[]} trades   {marketId, side, outcomeIndex, shares, collateral, createdAt}
 * @param {object[]} refunds  {marketId, amount, createdAt, kind?} — cancel/void refunds and correction reversals
 * @param {object[]} markets  {marketId, outcomeCount, status, outcome, resolvedAt}
 * @param {object[]} snapshots {marketId, prices:number[], snapshottedAt}
 * @param {number}   fromMs   window start; earlier trades still replay, they
 *                            just don't emit samples
 * @param {number}   nowMs    window end — always emitted as the final point
 * @returns {{series: {t:number,v:number}[], current:number}}
 */
export function buildPnlSeries({
  trades = [],
  refunds = [],
  markets = [],
  snapshots = [],
  fromMs = 0,
  nowMs = Date.now(),
  maxPoints = DEFAULT_MAX_POINTS,
} = {}) {
  const marketMeta = new Map();
  for (const m of markets) {
    marketMeta.set(m.marketId, {
      outcomeCount: Math.max(2, num(m.outcomeCount) || 2),
      status: m.status,
      outcome: m.outcome == null ? null : Number(m.outcome),
      resolvedAtMs: toMs(m.resolvedAt),
    });
  }

  const snapshotsByMarket = new Map();
  for (const s of snapshots) {
    const t = toMs(s.snapshottedAt);
    const prices = Array.isArray(s.prices) ? s.prices.map(num) : null;
    if (t == null || !prices) continue;
    if (!snapshotsByMarket.has(s.marketId)) snapshotsByMarket.set(s.marketId, []);
    snapshotsByMarket.get(s.marketId).push({ t, prices });
  }
  for (const list of snapshotsByMarket.values()) list.sort((a, b) => a.t - b.t);

  // Trades and refunds share one ordered stream so the replay applies them
  // in true chronological order rather than trades-then-refunds.
  const events = [];
  for (const tr of trades) {
    const t = toMs(tr.createdAt);
    if (t == null) continue;
    events.push({
      t,
      marketId: tr.marketId,
      side: tr.side,
      outcomeIndex: Number(tr.outcomeIndex),
      shares: num(tr.shares),
      collateral: num(tr.collateral),
    });
  }
  for (const rf of refunds) {
    const t = toMs(rf.createdAt);
    if (t == null) continue;
    const side = rf.kind === 'redemption_reversal' ? 'redemption_reversal' : 'refund';
    events.push({ t, marketId: rf.marketId, side, collateral: num(rf.amount) });
  }
  events.sort((a, b) => a.t - b.t);

  if (events.length === 0) return { series: [], current: 0 };

  // Sample wherever the curve can actually bend: every trade, every price
  // snapshot, every resolution, plus `now`. Resolution matters because a
  // losing position goes to zero at resolved_at with no trade of its own.
  const sampleSet = new Set([nowMs]);
  for (const e of events) sampleSet.add(e.t);
  for (const list of snapshotsByMarket.values()) for (const s of list) sampleSet.add(s.t);
  for (const meta of marketMeta.values()) {
    if (meta.resolvedAtMs != null) sampleSet.add(meta.resolvedAtMs);
  }

  const firstEventMs = events[0].t;
  const windowStart = Math.max(fromMs, firstEventMs);
  const samples = thin(
    Array.from(sampleSet).filter(t => t >= windowStart && t <= nowMs).sort((a, b) => a - b),
    maxPoints,
  );
  if (samples.length === 0) return { series: [], current: 0 };

  const pricesAt = priceLookup(snapshotsByMarket);
  // sharesByMarket holds NET shares: buys add, sells and redeems subtract.
  // Redeeming converts shares into cash, so subtracting there keeps the
  // curve continuous across a claim instead of double-counting the payout.
  const sharesByMarket = new Map();
  let cashInvested = 0;
  let cashReceived = 0;
  let cursor = 0;

  const series = [];
  for (const t of samples) {
    while (cursor < events.length && events[cursor].t <= t) {
      const e = events[cursor];
      cursor += 1;
      if (e.side === 'refund') {
        cashReceived += e.collateral;
        // A refunded market is unwound — drop the stake so it stops being
        // marked to market on a book that no longer settles.
        sharesByMarket.delete(e.marketId);
        continue;
      }
      if (e.side === 'redemption_reversal') {
        // A correction only claws back an incorrect redeem payout. It must
        // not unwind the whole market, because the user may also hold the
        // newly-correct winning outcome on the same market.
        cashReceived += e.collateral;
        continue;
      }
      if (!sharesByMarket.has(e.marketId)) sharesByMarket.set(e.marketId, new Map());
      const held = sharesByMarket.get(e.marketId);
      const prev = held.get(e.outcomeIndex) || 0;
      if (e.side === 'buy') {
        cashInvested += e.collateral;
        held.set(e.outcomeIndex, prev + e.shares);
      } else if (e.side === 'sell') {
        cashReceived += e.collateral;
        held.set(e.outcomeIndex, Math.max(0, prev - e.shares));
      } else if (e.side === 'redeem') {
        cashReceived += e.collateral;
        held.set(e.outcomeIndex, Math.max(0, prev - e.shares));
      }
    }

    let holdings = 0;
    for (const [marketId, held] of sharesByMarket.entries()) {
      const meta = marketMeta.get(marketId);
      const outcomeCount = meta?.outcomeCount || 2;
      const resolved = meta?.resolvedAtMs != null && meta.resolvedAtMs <= t;

      if (resolved) {
        // Settled: the winning outcome is worth 1 per share, everything
        // else is worth nothing. A resolved-but-unclaimed win therefore
        // shows its gain immediately, matching history.js's claimable payout.
        if (meta.outcome == null) continue; // canceled — refund handles the cash
        holdings += (held.get(meta.outcome) || 0) * 1;
        continue;
      }

      const prices = pricesAt(marketId, t) || Array.from({ length: outcomeCount }, () => 1 / outcomeCount);
      for (const [oi, shares] of held.entries()) {
        if (shares <= 0) continue;
        holdings += shares * num(prices[oi]);
      }
    }

    series.push({ t: Math.round(t / 1000), v: round2(cashReceived + holdings - cashInvested) });
  }

  return { series, current: series.length ? series[series.length - 1].v : 0 };
}
