/**
 * Fake /api/points/* backend for the video demo.
 *
 * Answers from the in-browser store instead of the network. Response shapes
 * are copied field-for-field from the live production API (captured against
 * pronos.io while building this) so components can't tell the difference.
 *
 * Trading is not faked: quote-buy and buy run through api/_lib/amm-math.js,
 * the same audited module the real endpoints use. A purchase on camera moves
 * the price by exactly what it would move in production.
 *
 * Tournament rules come from api/_lib/points-tournament-config.js rather than
 * being retyped here, so prize amounts and balances stay in sync when they
 * change upstream.
 */
import {
  binaryBuyQuote,
  binarySellQuote,
  multiBuyQuote,
  multiSellQuote,
} from '../../../../api/_lib/amm-math.js';
import {
  TOURNAMENT_CYCLE_LABEL,
  TOURNAMENT_OPERATION_CLOSE_ISO,
  TOURNAMENT_RANKING_CUTOFF_ISO,
  TOURNAMENT_START_ISO,
  tournamentRulesPayload,
} from '../../../../api/_lib/points-tournament-config.js';
import { getDemoState, updateDemoState } from './demoStore.js';

const json = (body, status = 200) => ({ status, body });

function parseIds(raw) {
  return String(raw || '')
    .split(',')
    .map(v => parseInt(v, 10))
    .filter(Number.isInteger);
}

function findMarket(state, id) {
  return state.markets.find(m => m.id === Number(id)) || null;
}

/** The list endpoint omits a few detail-only fields. Mirrors markets.js. */
function toListShape(market) {
  const { anchorProbs, resolverType, resolverSource, liveScoreConfig, cryptoMeta, lastTradeAt, archivedAt, ...rest } = market;
  return rest;
}

function toDetailShape(market) {
  const { anchorProbs, live, featured, trending, crypto5min, cryptoIntervalMinutes, cryptoWindowMinutes, ...rest } = market;
  return rest;
}

// ─── Handlers ───────────────────────────────────────────────────────────────

function handleMarkets(state, params) {
  const status = params.get('status') || 'active';
  const category = params.get('category');
  const featured = params.get('featured');
  const limit = parseInt(params.get('limit'), 10);

  let rows = state.markets.filter(m => (status === 'all' ? true : m.status === status));
  if (category) rows = rows.filter(m => m.category === category || (m.categoryTags || []).includes(category));
  if (featured === 'true' || featured === '1') rows = rows.filter(m => m.featured);
  if (Number.isInteger(limit) && limit > 0) rows = rows.slice(0, limit);

  return json({ markets: rows.map(toListShape) });
}

function handleMarket(state, params) {
  const market = findMarket(state, params.get('id'));
  if (!market) return json({ error: 'market_not_found' }, 404);
  return json({ market: toDetailShape(market) });
}

function handlePriceHistory(state, params) {
  const ids = parseIds(params.get('ids'));
  const outcome = Math.max(0, parseInt(params.get('outcome'), 10) || 0);
  const limit = parseInt(params.get('limit'), 10) || 200;
  const hours = parseInt(params.get('hours'), 10)
    || (parseInt(params.get('days'), 10) || 1) * 24;
  const cutoff = Math.floor(Date.now() / 1000) - hours * 3600;

  const history = {};
  for (const id of ids) {
    const series = state.history?.[id] || [];
    history[id] = series
      .filter(point => point.t >= cutoff)
      .slice(-limit)
      .map(point => ({ t: point.t, p: point.ps?.[outcome] ?? point.ps?.[0] ?? 50 }));
  }
  return json({ history });
}

function handleTradeActivity(state, params) {
  const ids = parseIds(params.get('ids'));
  const buckets = Math.min(120, Math.max(12, parseInt(params.get('buckets'), 10) || 48));
  const hours = parseInt(params.get('hours'), 10)
    || (parseInt(params.get('days'), 10) || 1) * 24;
  const bucketSeconds = Math.round((hours * 3600) / buckets);
  const nowSec = Math.floor(Date.now() / 1000);

  const activity = {};
  for (const id of ids) {
    const market = findMarket(state, id);
    if (!market) { activity[id] = []; continue; }

    // Backfill: spread the market's traded volume across the window with a
    // shape that reads as real activity rather than a flat line. This covers
    // the hours before the demo was opened, where no simulated trades exist.
    const total = Number(market.tradeVolume || 0);
    const weights = Array.from({ length: buckets }, (_, i) => 0.4 + Math.abs(Math.sin(i * 1.7)) + (i / buckets) * 0.8);
    const weightSum = weights.reduce((s, w) => s + w, 0) || 1;

    const series = weights.map((w, i) => {
      const volume = Math.round((total * w) / weightSum);
      const buyVolume = Math.round(volume * (0.5 + Math.random() * 0.25));
      return {
        t: nowSec - (buckets - 1 - i) * bucketSeconds,
        count: Math.max(1, Math.round(volume / 900)),
        volume,
        buyVolume,
        sellVolume: volume - buyVolume,
      };
    });

    // Live layer: fold the simulated order flow into whichever bucket each
    // trade falls in. In practice that is the newest one or two, so the
    // right edge of the chart grows while the camera is on it.
    const firstBucketStart = series[0]?.t ?? nowSec;
    for (const trade of state.recentTrades) {
      if (trade.marketId !== Number(id)) continue;
      const slot = Math.floor((trade.t - firstBucketStart) / bucketSeconds);
      const bucket = series[Math.min(series.length - 1, Math.max(0, slot))];
      if (!bucket) continue;
      bucket.count += 1;
      bucket.volume += trade.size;
      if (trade.side === 'buy') bucket.buyVolume += trade.size;
      else bucket.sellVolume += trade.size;
    }

    activity[id] = series;
  }
  return json({ activity, bucketSeconds });
}

function cyclePayload() {
  const now = Date.now();
  const rules = tournamentRulesPayload();
  // Forced 'active' so the tournament page shows the green badge and a
  // live "operación cierra en" countdown. The real cycle is still scheduled,
  // which would render a duller pre-launch state on camera.
  const cycle = {
    id: 1,
    label: TOURNAMENT_CYCLE_LABEL,
    status: 'active',
    paused: false,
    scheduled: false,
    startedAt: TOURNAMENT_START_ISO,
    startsAt: TOURNAMENT_START_ISO,
    operationCloseAt: TOURNAMENT_OPERATION_CLOSE_ISO,
    rankingCutoffAt: TOURNAMENT_RANKING_CUTOFF_ISO,
    endsAt: TOURNAMENT_RANKING_CUTOFF_ISO,
    createdAt: TOURNAMENT_START_ISO,
    closedAt: null,
    secondsUntilStart: 0,
    secondsUntilOperationClose: Math.max(0, Math.floor((new Date(TOURNAMENT_OPERATION_CLOSE_ISO) - now) / 1000)),
    secondsRemaining: Math.max(0, Math.floor((new Date(TOURNAMENT_RANKING_CUTOFF_ISO) - now) / 1000)),
    pastDeadline: false,
  };
  return { paused: false, label: TOURNAMENT_CYCLE_LABEL, window: cycle, rules, cycle };
}

function handleLeaderboard(state) {
  const rules = tournamentRulesPayload();
  const me = state.leaderboard.find(row => row.username === state.user.username) || null;
  return json({
    top: state.leaderboard,
    me,
    totalParticipants: state.leaderboard.length,
    startingBalance: rules.startingBalance,
    rules,
  });
}

function handlePositions(state) {
  const positions = state.positions.map(pos => {
    const market = findMarket(state, pos.marketId);
    const price = market?.prices?.[pos.outcomeIndex] ?? 0;
    const currentValue = pos.shares * price;
    return {
      marketId: pos.marketId,
      question: market?.question || '',
      category: market?.category || 'general',
      outcomes: market?.outcomes || [],
      outcomeIndex: pos.outcomeIndex,
      outcomeLabel: market?.outcomes?.[pos.outcomeIndex] || '',
      shares: pos.shares,
      costBasis: pos.costBasis,
      currentPrice: price,
      currentValue,
      pnl: currentValue - pos.costBasis,
      status: market?.status || 'active',
      outcome: market?.outcome ?? null,
      endTime: market?.endTime || null,
      mode: 'points',
    };
  });

  const round2 = n => Math.round(n * 100) / 100;
  const totalInvested = positions.reduce((s, p) => s + p.costBasis, 0);
  const currentValue = positions.reduce((s, p) => s + p.currentValue, 0);

  return json({
    positions,
    summary: {
      totalPositions: positions.length,
      activePositions: positions.filter(p => p.status === 'active').length,
      totalInvested: round2(totalInvested),
      currentValue: round2(currentValue),
      pnl: round2(currentValue - totalInvested),
      unrealizedPnl: round2(currentValue - totalInvested),
      realizedPnl: 0,
    },
  });
}

function quoteFor(market, outcomeIndex, collateral) {
  const reserves = market.reserves.map(Number);
  return reserves.length === 2
    ? binaryBuyQuote(reserves, outcomeIndex, collateral)
    : multiBuyQuote(reserves, outcomeIndex, collateral);
}

function handleQuoteBuy(state, body) {
  const market = findMarket(state, body.marketId);
  if (!market) return json({ error: 'market_not_found' }, 404);
  const oi = parseInt(body.outcomeIndex, 10);
  const amt = Number(body.collateral);
  if (!Number.isInteger(oi) || oi < 0 || oi >= market.reserves.length) {
    return json({ error: 'invalid_outcome_index' }, 400);
  }
  if (!Number.isFinite(amt) || amt <= 0) return json({ error: 'invalid_amount' }, 400);

  const q = quoteFor(market, oi, amt);
  return json({
    collateral: q.collateral,
    fee: q.fee,
    feePct: q.feePct,
    sharesOut: q.sharesOut,
    avgPrice: q.avgPrice,
    priceBefore: q.priceBefore,
    priceAfter: q.priceAfter,
    priceImpactPts: q.priceImpactPts,
    pricesBefore: q.pricesBefore,
    pricesAfter: q.pricesAfter,
  });
}

function handleBuy(state, body) {
  const market = findMarket(state, body.marketId);
  if (!market) return json({ error: 'market_not_found' }, 404);
  const oi = parseInt(body.outcomeIndex, 10);
  const amt = Number(body.collateral);
  if (!Number.isInteger(oi) || oi < 0 || oi >= market.reserves.length) {
    return json({ error: 'invalid_outcome_index' }, 400);
  }
  if (!Number.isFinite(amt) || amt <= 0) return json({ error: 'invalid_amount' }, 400);
  if (amt > state.user.balance) return json({ error: 'insufficient_balance' }, 400);

  const q = quoteFor(market, oi, amt);
  let balance = state.user.balance;

  updateDemoState(s => {
    const target = findMarket(s, body.marketId);
    target.reserves = q.reservesAfter;
    target.prices = q.pricesAfter;
    // Re-anchor so drift mean-reverts to the new price instead of dragging
    // the market back to where it sat before the purchase.
    target.anchorProbs = [...q.pricesAfter];
    target.tradeVolume = Number(target.tradeVolume || 0) + amt;
    target.lastTradeAt = new Date().toISOString();

    s.user.balance = Math.round((s.user.balance - amt) * 100) / 100;
    balance = s.user.balance;

    const existing = s.positions.find(p => p.marketId === target.id && p.outcomeIndex === oi);
    if (existing) {
      existing.shares += q.sharesOut;
      existing.costBasis += amt;
    } else {
      s.positions.push({ marketId: target.id, outcomeIndex: oi, shares: q.sharesOut, costBasis: amt });
    }

    // Logged separately from the position because the history tab and the
    // P&L curve need each individual fill, not just the running total.
    if (!Array.isArray(s.userTrades)) s.userTrades = [];
    s.userTrades.push({
      marketId: target.id,
      outcomeIndex: oi,
      side: 'buy',
      shares: q.sharesOut,
      collateral: amt,
      price: q.avgPrice,
      createdAt: new Date().toISOString(),
    });
  });

  return json({
    ok: true,
    balance,
    sharesOut: q.sharesOut,
    fee: q.fee,
    priceBefore: q.priceBefore,
    priceAfter: q.priceAfter,
    triggeredLimitOrders: [],
  });
}

function handleStats(state) {
  const totalVolume = state.markets.reduce((s, m) => s + Number(m.volume || 0) + Number(m.tradeVolume || 0), 0);
  return json({
    activeMarkets: state.markets.filter(m => m.status === 'active').length,
    totalMarkets: state.markets.length,
    totalUsers: state.leaderboard.length,
    totalVolume,
    totalTrades: Math.round(totalVolume / 850),
  });
}

// ─── Selling ────────────────────────────────────────────────────────────────

function sellQuoteFor(market, outcomeIndex, shares) {
  const reserves = market.reserves.map(Number);
  return reserves.length === 2
    ? binarySellQuote(reserves, outcomeIndex, shares)
    : multiSellQuote(reserves, outcomeIndex, shares);
}

function heldShares(state, marketId, outcomeIndex) {
  const pos = state.positions.find(
    p => p.marketId === Number(marketId) && p.outcomeIndex === outcomeIndex,
  );
  return pos ? Number(pos.shares) || 0 : 0;
}

function validateSell(state, body) {
  const market = findMarket(state, body.marketId);
  if (!market) return { error: json({ error: 'market_not_found' }, 404) };
  const oi = parseInt(body.outcomeIndex, 10);
  const shares = Number(body.shares);
  if (!Number.isInteger(oi) || oi < 0 || oi >= market.reserves.length) {
    return { error: json({ error: 'invalid_outcome_index' }, 400) };
  }
  if (!Number.isFinite(shares) || shares <= 0) {
    return { error: json({ error: 'invalid_amount' }, 400) };
  }
  return { market, oi, shares };
}

function handleQuoteSell(state, body) {
  const v = validateSell(state, body);
  if (v.error) return v.error;

  const q = sellQuoteFor(v.market, v.oi, v.shares);
  return json({
    shares: v.shares,
    collateralOut: q.collateralOut,
    fee: q.fee,
    feePct: q.feePct,
    avgPrice: q.avgPrice,
    priceBefore: q.priceBefore,
    priceAfter: q.priceAfter,
    priceImpactPts: q.priceImpactPts,
    pricesBefore: q.pricesBefore,
    pricesAfter: q.pricesAfter,
  });
}

function handleSell(state, body) {
  const v = validateSell(state, body);
  if (v.error) return v.error;

  const held = heldShares(state, v.market.id, v.oi);
  if (v.shares > held + 0.000001) return json({ error: 'insufficient_shares' }, 400);

  const q = sellQuoteFor(v.market, v.oi, v.shares);
  let balance = state.user.balance;

  updateDemoState(s => {
    const target = findMarket(s, v.market.id);
    target.reserves = q.reservesAfter;
    target.prices = q.pricesAfter;
    // Same re-anchoring as a buy: drift should mean-revert to where the sale
    // left the market, not drag it back to the pre-sale price.
    target.anchorProbs = [...q.pricesAfter];
    target.tradeVolume = Number(target.tradeVolume || 0) + q.collateralOut;
    target.lastTradeAt = new Date().toISOString();

    s.user.balance = Math.round((s.user.balance + q.collateralOut) * 100) / 100;
    balance = s.user.balance;

    const pos = s.positions.find(p => p.marketId === target.id && p.outcomeIndex === v.oi);
    if (pos) {
      // Cost basis comes off proportionally, so a partial sale leaves the
      // remaining shares carrying their share of the original cost and the
      // P&L on what's left stays correct.
      const fraction = Math.min(1, v.shares / (Number(pos.shares) || 1));
      pos.costBasis = Math.max(0, pos.costBasis * (1 - fraction));
      pos.shares = Math.max(0, pos.shares - v.shares);
      if (pos.shares <= 0.000001) {
        s.positions.splice(s.positions.indexOf(pos), 1);
      }
    }

    if (!Array.isArray(s.userTrades)) s.userTrades = [];
    s.userTrades.push({
      marketId: target.id,
      outcomeIndex: v.oi,
      side: 'sell',
      shares: v.shares,
      collateral: q.collateralOut,
      price: q.avgPrice,
      createdAt: new Date().toISOString(),
    });
  });

  return json({
    ok: true,
    balance,
    collateralOut: q.collateralOut,
    fee: q.fee,
    priceBefore: q.priceBefore,
    priceAfter: q.priceAfter,
  });
}

// ─── Trade tape ─────────────────────────────────────────────────────────────

function tapeRow(market, { t, side, size, outcomeIndex, username, shares, price }, key) {
  const label = market.outcomes[outcomeIndex] || '';
  return {
    id: `${market.id}-${t}-${key}`,
    marketId: market.id,
    displayMarketId: market.id,
    username: username || 'anon',
    side,
    outcomeIndex,
    outcomeLabel: label,
    outcomeSideLabel: null,
    outcomeDisplayLabel: label,
    question: market.question,
    shares: Number((shares ?? size / Math.max(0.02, price)).toFixed(2)),
    collateral: size,
    fee: 0,
    price,
    priceBefore: price,
    priceAfter: price,
    priceMin: price,
    priceMax: price,
    fillCount: 1,
    createdAt: new Date(t * 1000).toISOString(),
    t,
  };
}

/**
 * Latest fills per market, the feed behind the home "Más activos" carousel.
 *
 * Two layers, for the same reason handleTradeActivity has two. Live simulated
 * flow covers the seconds since the demo opened; older rows are backfilled
 * from the market's traded volume so a market the rotation hasn't reached yet
 * still shows a history. Without the backfill the carousel renders "sin flujo
 * reciente" next to a chart that plainly shows volume, which reads as broken
 * rather than as quiet.
 *
 * Backfilled rows are seeded off the market id, so a market shows the same
 * past trades on every poll instead of rewriting its own history every 25
 * seconds.
 */
function handleTradeTape(state, params) {
  const ids = parseIds(params.get('ids'));
  const limit = Math.min(50, Math.max(1, parseInt(params.get('limit'), 10) || 20));
  const hours = parseInt(params.get('hours'), 10) || 168;
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff = nowSec - hours * 3600;

  const tape = {};
  for (const id of ids) {
    const market = findMarket(state, id);
    if (!market) { tape[id] = []; continue; }

    const rows = [];
    for (let i = state.recentTrades.length - 1; i >= 0 && rows.length < limit; i -= 1) {
      const trade = state.recentTrades[i];
      if (trade.marketId !== Number(id)) continue;
      if (trade.t < cutoff) break;
      const price = Number(trade.price ?? market.prices?.[trade.outcomeIndex] ?? 0.5);
      rows.push(tapeRow(market, { ...trade, price }, i));
    }

    // Backfill the remainder, walking backwards from the oldest live row.
    const names = state.leaderboard;
    let seed = (Number(market.id) || 1) % 9973;
    const nextSeeded = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let t = rows.length ? rows[rows.length - 1].t : nowSec;
    while (rows.length < limit && t > cutoff) {
      t -= 60 + Math.floor(nextSeeded() * 900);
      if (t <= cutoff) break;
      const outcomeIndex = Math.floor(nextSeeded() * market.outcomes.length);
      const price = Number(market.prices?.[outcomeIndex] ?? 0.5);
      rows.push(tapeRow(market, {
        t,
        side: nextSeeded() < 0.57 ? 'buy' : 'sell',
        size: Math.round(20 + Math.pow(nextSeeded(), 2) * 1800),
        outcomeIndex,
        username: names.length ? names[Math.floor(nextSeeded() * names.length)].username : 'anon',
        shares: null,
        price,
      }, `bf${rows.length}`));
    }

    tape[id] = rows;
  }
  return json({ tape });
}

// ─── Portfolio history and P&L ──────────────────────────────────────────────

function userTradesFor(state) {
  return Array.isArray(state.userTrades) ? state.userTrades : [];
}

/**
 * Per-market trade history for the portfolio's Historial tab.
 *
 * Groups the demo account's own fills by market. Only the fields the tab
 * actually renders are produced — the live endpoint additionally computes
 * resolution and redemption bookkeeping that no demo market ever reaches,
 * since nothing here resolves during a presentation.
 */
function handleHistory(state) {
  const round2 = n => Math.round(n * 100) / 100;
  const byMarket = new Map();

  for (const trade of userTradesFor(state)) {
    const market = findMarket(state, trade.marketId);
    if (!market) continue;
    if (!byMarket.has(trade.marketId)) {
      byMarket.set(trade.marketId, {
        marketId: trade.marketId,
        parentMarketId: null,
        legLabel: null,
        question: market.question,
        category: market.category,
        status: market.status,
        outcome: market.outcome,
        outcomes: market.outcomes,
        reserves: market.reserves,
        endTime: market.endTime,
        resolvedAt: market.resolvedAt,
        transactions: [],
        totalInvested: 0,
        totalReceived: 0,
      });
    }
    const bucket = byMarket.get(trade.marketId);
    bucket.transactions.push({
      type: trade.side,
      side: trade.side,
      shares: round2(trade.shares),
      collateral: round2(trade.collateral),
      price: trade.price,
      outcomeIndex: trade.outcomeIndex,
      outcomeLabel: market.outcomes[trade.outcomeIndex] || '',
      createdAt: trade.createdAt,
    });
    if (trade.side === 'buy') bucket.totalInvested += trade.collateral;
    else bucket.totalReceived += trade.collateral;
  }

  const history = [...byMarket.values()].map(entry => {
    const open = state.positions.filter(p => p.marketId === entry.marketId);
    const markToMarket = open.reduce((sum, p) => {
      const market = findMarket(state, p.marketId);
      return sum + p.shares * Number(market?.prices?.[p.outcomeIndex] ?? 0);
    }, 0);
    const netPnl = round2(entry.totalReceived + markToMarket - entry.totalInvested);
    return {
      ...entry,
      totalInvested: round2(entry.totalInvested),
      totalReceived: round2(entry.totalReceived),
      netPnl,
      // Anything still held is open; a market the account fully exited is
      // "exited". Nothing in the demo resolves, so won/lost never appear.
      outcomeStatus: open.length > 0 ? 'open' : 'exited',
      claimablePayout: 0,
      canRedeem: false,
      winningOutcomeIndex: null,
      winningOutcomeLabel: null,
    };
  });

  history.sort((a, b) => {
    const lastA = a.transactions[a.transactions.length - 1]?.createdAt || 0;
    const lastB = b.transactions[b.transactions.length - 1]?.createdAt || 0;
    return new Date(lastB) - new Date(lastA);
  });

  return json({
    history,
    summary: {
      totalPnl: round2(history.reduce((s, m) => s + m.netPnl, 0)),
      marketsTotal: history.length,
      marketsWon: 0,
      marketsLost: 0,
      marketsCanceled: 0,
      marketsExited: history.filter(m => m.outcomeStatus === 'exited').length,
      marketsOpen: history.filter(m => m.outcomeStatus === 'open').length,
      marketsPending: 0,
      marketsCycleClosed: 0,
    },
    cycle: null,
  });
}

/**
 * Cumulative P&L, as [{ t: unix seconds, v: cumulative }].
 *
 * Walks the account's own trades in order: a buy spends cash for shares, a
 * sell returns it, and the tail carries the mark-to-market of whatever is
 * still open — so the last point agrees with the portfolio summary instead of
 * telling a different story on the adjacent screen.
 */
function handlePnlHistory(state) {
  const trades = [...userTradesFor(state)]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (trades.length === 0) return json({ series: [], current: 0, cycle: null });

  const series = [];
  let invested = 0;
  let received = 0;

  for (const trade of trades) {
    if (trade.side === 'buy') invested += trade.collateral;
    else received += trade.collateral;
    series.push({
      t: Math.floor(new Date(trade.createdAt).getTime() / 1000),
      v: Math.round((received - invested) * 100) / 100,
    });
  }

  const markToMarket = state.positions.reduce((sum, p) => {
    const market = findMarket(state, p.marketId);
    return sum + p.shares * Number(market?.prices?.[p.outcomeIndex] ?? 0);
  }, 0);
  const current = Math.round((received + markToMarket - invested) * 100) / 100;
  series.push({ t: Math.floor(Date.now() / 1000), v: current });

  return json({ series, current, cycle: null });
}

// ─── Market detail panels ───────────────────────────────────────────────────

/**
 * Biggest shareholders, ranked by mark-to-market value.
 *
 * Derived from the leaderboard handles rather than invented per call, so the
 * same market shows the same holders on every poll — a table that reshuffles
 * its names every few seconds reads as broken.
 */
function handleTopHolders(state, params) {
  const market = findMarket(state, params.get('marketId'));
  if (!market) return json({ holders: [] });
  const limit = Math.min(50, Math.max(1, parseInt(params.get('limit'), 10) || 10));

  const seed = (Number(market.id) || 1) % 97;
  const holders = state.leaderboard.slice(0, limit + 4).map((row, i) => {
    const outcomeIndex = (seed + i) % market.outcomes.length;
    const price = Number(market.prices?.[outcomeIndex] ?? 0.5);
    const shares = Math.round(((seed % 11) + 3) * 180 / (i + 1.4));
    const value = shares * price;
    return {
      username: row.username,
      outcomeIndex,
      outcomeLabel: market.outcomes[outcomeIndex] || '',
      shares: Math.round(shares * 100) / 100,
      // Entered below the current price so the table shows holders in profit.
      costBasis: Math.round(shares * price * 0.86 * 100) / 100,
      value: Math.round(value * 100) / 100,
    };
  });

  holders.sort((a, b) => b.value - a.value);
  return json({ holders: holders.slice(0, limit) });
}

/**
 * Depth around the current AMM price.
 *
 * Real Pronos books are a hybrid of resting limit orders and treasury maker
 * depth. The demo has neither, so levels are laid out symmetrically around
 * the current price with size growing as you walk away from it — the shape a
 * maker-quoted book actually has.
 */
function handleOrderbook(state, params) {
  const market = findMarket(state, params.get('marketId'));
  const outcomeIndex = Math.max(0, parseInt(params.get('outcomeIndex'), 10) || 0);
  if (!market) return json({ asks: [], bids: [] });

  const levels = Math.min(12, Math.max(3, parseInt(params.get('levels'), 10) || 8));
  const price = Number(market.prices?.[outcomeIndex] ?? 0.5);
  const depth = market.reserves.reduce((s, r) => s + Number(r), 0);
  const tick = 0.01;
  const spread = tick;

  const build = (direction) => {
    const rows = [];
    let total = 0;
    for (let i = 1; i <= levels; i += 1) {
      const levelPrice = price + direction * (spread / 2 + (i - 1) * tick);
      if (levelPrice <= 0.005 || levelPrice >= 0.995) break;
      const shares = Math.round((depth / 40) * (0.6 + i * 0.35));
      total += shares;
      rows.push({
        price: Math.round(levelPrice * 1000) / 1000,
        shares,
        total,
        orderCount: 1 + (i % 4),
      });
    }
    return rows;
  };

  const asks = build(1).sort((a, b) => b.price - a.price);
  const bids = build(-1).sort((a, b) => b.price - a.price);

  return json({
    marketId: market.id,
    outcomeIndex,
    outcomeLabel: market.outcomes[outcomeIndex] || '',
    status: market.status,
    currentPrice: price,
    lastPrice: price,
    ammPrice: price,
    spread,
    asks,
    bids,
    bookType: 'mock_orderbook',
    mockMakerDepth: Math.round(depth / 40),
    limitAskCount: 0,
    limitBidCount: 0,
    makerAskCount: asks.length,
    makerBidCount: bids.length,
  });
}

/**
 * Market comments.
 *
 * A small rotating set of neutral Spanish reactions, keyed off the market id
 * so a market always shows the same thread. Deliberately generic: these end
 * up on a projector, and nothing here should read as a claim about a real
 * event or a real person's opinion of it.
 */
const COMMENT_LINES = [
  'El mercado se movió bastante esta semana.',
  'Yo le veo más valor al otro lado, pero vamos a ver.',
  'Entré temprano y voy bien hasta ahorita.',
  'Ojo con el cierre, todavía falta.',
  'Buen volumen hoy.',
  'Me salí con ganancia, suerte a los que siguen dentro.',
  'La probabilidad se ve baja para lo que está pasando.',
  'Aguanto hasta el final.',
];

function handleComments(state, params) {
  const marketId = Number(params.get('marketId'));
  const market = findMarket(state, marketId);
  if (!market) return json({ comments: [] });

  const seed = (Number(market.id) || 1) % 97;
  const count = 3 + (seed % 4);
  const now = Date.now();

  const comments = Array.from({ length: count }, (_, i) => {
    const author = state.leaderboard[(seed + i * 3) % state.leaderboard.length];
    return {
      id: `${market.id}-${i}`,
      marketId: market.id,
      username: author?.username || 'anon',
      body: COMMENT_LINES[(seed + i * 5) % COMMENT_LINES.length],
      createdAt: new Date(now - (i + 1) * (40 + seed) * 60 * 1000).toISOString(),
      canDelete: false,
    };
  });

  return json({ comments });
}

// ─── Router ─────────────────────────────────────────────────────────────────

/**
 * Endpoints the three shots never touch still get a valid empty payload, so a
 * component reaching for one renders its empty state instead of throwing on
 * camera. Keys match what each caller destructures.
 */
const EMPTY_PAYLOADS = {
  '/api/points/limit-orders': { orders: [] },
  '/api/points/news': { items: [] },
  '/api/points/cycles/history': { cycles: [] },
  '/api/points/claimable': { claimable: [] },
  '/api/points/referrals/stats': { stats: null },
  '/api/points/social-links': { links: [] },
  '/api/points/maker-rewards': { rewards: [] },
  '/api/points/support-tickets': { tickets: [] },
  '/api/points/daily-status': {
    alreadyClaimedToday: true,
    claimedAmount: 200,
    streakDay: 6,
    bestStreak: 6,
    nextClaimAtUtc: '2026-08-27T06:00:00.000Z',
  },
  '/api/points/pwa-install-status': { eligible: false, claimed: true },
  '/api/points/turnkey/delegation-status': { delegated: true },
};

export function routeDemoRequest(url, method, body) {
  const parsed = new URL(url, window.location.origin);
  const path = parsed.pathname;
  const params = parsed.searchParams;
  const state = getDemoState();

  if (method === 'GET') {
    switch (path) {
      case '/api/points/auth/me': return json(state.user);
      case '/api/points/markets': return handleMarkets(state, params);
      case '/api/points/market': return handleMarket(state, params);
      case '/api/points/price-history': return handlePriceHistory(state, params);
      case '/api/points/trade-activity': return handleTradeActivity(state, params);
      case '/api/points/leaderboard': return handleLeaderboard(state);
      case '/api/points/cycles/current': return json(cyclePayload());
      case '/api/points/positions': return handlePositions(state);
      case '/api/points/stats': return handleStats(state);
      case '/api/points/trade-tape': return handleTradeTape(state, params);
      case '/api/points/history': return handleHistory(state);
      case '/api/points/pnl-history': return handlePnlHistory(state);
      case '/api/points/top-holders': return handleTopHolders(state, params);
      case '/api/points/orderbook': return handleOrderbook(state, params);
      case '/api/points/comments': return handleComments(state, params);
      default: break;
    }
    if (EMPTY_PAYLOADS[path]) return json(EMPTY_PAYLOADS[path]);
    return json({});
  }

  if (method === 'POST') {
    switch (path) {
      case '/api/points/quote-buy': return handleQuoteBuy(state, body || {});
      case '/api/points/buy': return handleBuy(state, body || {});
      case '/api/points/quote-sell': return handleQuoteSell(state, body || {});
      case '/api/points/sell': return handleSell(state, body || {});
      default: return json({ ok: true });
    }
  }

  return json({ ok: true });
}
