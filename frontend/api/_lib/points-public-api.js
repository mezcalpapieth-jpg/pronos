import { binaryPrices, multiPrices } from './amm-math.js';
import { binaryPricesWithBookTrade } from './points-display-prices.js';

export function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function roundNumber(value, places = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

export function pricesFromReserves(reserves, outcomeCount, row = {}) {
  const count = Math.max(2, Number(outcomeCount) || 2);
  if (String(row.status || '') === 'resolved') {
    const outcome = Number(row.outcome);
    if (Number.isInteger(outcome) && outcome >= 0 && outcome < count) {
      return Array.from({ length: count }, (_, i) => (i === outcome ? 1 : 0));
    }
  }
  if (!Array.isArray(reserves) || reserves.length === 0) {
    return Array.from({ length: count }, () => 1 / count);
  }
  if (reserves.length === 2) {
    const basePrices = binaryPrices(reserves);
    return binaryPricesWithBookTrade(basePrices, {
      status: row.status,
      outcomeIndex: row.display_trade_outcome_index,
      price: row.display_trade_price,
      isBookTrade: row.display_trade_is_book,
    });
  }
  return multiPrices(reserves);
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function publicResolverInfo(row) {
  const cfg = parseJsonb(row.resolver_config, null);
  if (!cfg || typeof cfg !== 'object') {
    return row.resolver_type ? { type: row.resolver_type } : null;
  }
  return {
    type: row.resolver_type || null,
    source: typeof cfg.source === 'string' ? cfg.source : null,
    shape: typeof cfg.shape === 'string' ? cfg.shape : null,
    sport: row.sport || cfg.sport || null,
    league: row.league || cfg.league || null,
    symbol: cfg.symbol || cfg.asset || null,
    airport: cfg.airport || cfg.airportCode || null,
    metric: cfg.metric || null,
    threshold: cfg.threshold == null ? null : Number(cfg.threshold),
  };
}

export function serializePublicMarket(row) {
  const outcomes = parseJsonb(row.outcomes, ['Si', 'No']).map(String);
  const reserves = parseJsonb(row.reserves, []).map(Number);
  const prices = pricesFromReserves(reserves, outcomes.length, row).map(value => roundNumber(value, 6));
  return {
    id: Number(row.id),
    marketId: String(row.id),
    question: row.question,
    category: row.category || null,
    status: row.status,
    outcome: row.outcome == null ? null : Number(row.outcome),
    outcomes,
    prices,
    tradeVolume: roundNumber(row.trade_volume, 2),
    liquidity: roundNumber(reserves.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0), 2),
    startTime: dateOrNull(row.start_time),
    endTime: dateOrNull(row.end_time),
    createdAt: dateOrNull(row.created_at),
    resolvedAt: dateOrNull(row.resolved_at),
    finalScore: row.final_score || null,
    mode: row.mode || 'points',
    ammMode: row.amm_mode || 'unified',
    parentId: row.parent_id == null ? null : Number(row.parent_id),
    legLabel: row.leg_label || null,
    featured: Boolean(row.featured),
    tournamentFeatured: Boolean(row.tournament_featured),
    source: row.source || null,
    sourceEventId: row.source_event_id || null,
    resolver: publicResolverInfo(row),
  };
}

export function serializePublicPosition(row) {
  const outcomes = parseJsonb(row.outcomes, ['Si', 'No']).map(String);
  const reserves = parseJsonb(row.reserves, []).map(Number);
  const prices = pricesFromReserves(reserves, outcomes.length, row);
  const outcomeIndex = Number(row.outcome_index);
  const shares = Number(row.shares || 0);
  const costBasis = Number(row.cost_basis || 0);
  const realizedPnl = Number(row.realized_pnl || 0);
  const currentPrice = String(row.status || '') === 'resolved'
    ? (Number(row.outcome) === outcomeIndex ? 1 : 0)
    : Number(prices[outcomeIndex] ?? 0);
  const currentValue = shares * currentPrice;
  return {
    marketId: String(row.market_id),
    outcomeIndex,
    outcomeLabel: outcomes[outcomeIndex] || `Outcome ${outcomeIndex}`,
    shares: roundNumber(shares, 6),
    costBasis: roundNumber(costBasis, 2),
    currentPrice: roundNumber(currentPrice, 6),
    currentValue: roundNumber(currentValue, 2),
    realizedPnl: roundNumber(realizedPnl, 2),
    unrealizedPnl: roundNumber(currentValue - costBasis, 2),
    question: row.question,
    category: row.category || null,
    status: row.status,
    endTime: dateOrNull(row.end_time),
  };
}
