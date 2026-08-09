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
import { binaryBuyQuote, multiBuyQuote } from '../../../../api/_lib/amm-math.js';
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

// ─── Router ─────────────────────────────────────────────────────────────────

/**
 * Endpoints the three shots never touch still get a valid empty payload, so a
 * component reaching for one renders its empty state instead of throwing on
 * camera. Keys match what each caller destructures.
 */
const EMPTY_PAYLOADS = {
  '/api/points/history': { history: [] },
  '/api/points/comments': { comments: [] },
  '/api/points/top-holders': { holders: [] },
  '/api/points/orderbook': { bids: [], asks: [] },
  '/api/points/limit-orders': { orders: [] },
  '/api/points/news': { items: [] },
  '/api/points/cycles/history': { cycles: [] },
  '/api/points/claimable': { claimable: [] },
  '/api/points/referrals/stats': { stats: null },
  '/api/points/social-links': { links: [] },
  '/api/points/maker-rewards': { rewards: [] },
  '/api/points/pnl-history': { series: [] },
  '/api/points/support-tickets': { tickets: [] },
  '/api/points/daily-status': { claimed: true, streak: 6, nextAmount: 0, canClaim: false },
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
      default: break;
    }
    if (EMPTY_PAYLOADS[path]) return json(EMPTY_PAYLOADS[path]);
    return json({});
  }

  if (method === 'POST') {
    switch (path) {
      case '/api/points/quote-buy': return handleQuoteBuy(state, body || {});
      case '/api/points/buy': return handleBuy(state, body || {});
      default: return json({ ok: true });
    }
  }

  return json({ ok: true });
}
