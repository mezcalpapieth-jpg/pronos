const CATEGORY_LABEL = {
  general: 'General',
  mexico: 'Mexico & Latam',
  politica: 'Política',
  deportes: 'Deportes',
  finanzas: 'Finanzas',
  crypto: 'Crypto',
  musica: 'Música',
  'world-cup': 'Copa del Mundo',
};

export function pricesFromReserves(reserves) {
  if (!Array.isArray(reserves) || reserves.length < 2) return [];
  const invs = reserves.map(r => (Number(r) > 0 ? 1 / Number(r) : 0));
  const total = invs.reduce((sum, value) => sum + value, 0) || 1;
  return invs.map(value => value / total);
}

export function priceForOutcome(market, outcomeIndex) {
  if (market?.status === 'resolved') {
    return Number(market.outcome) === outcomeIndex ? 1 : 0;
  }

  const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
  const prices = Array.isArray(market?.prices) && market.prices.length > 0
    ? market.prices
    : pricesFromReserves(market?.reserves || []);
  const fallback = outcomes.length > 0 ? 1 / outcomes.length : 0.5;
  const price = Number(prices[outcomeIndex]);
  return Number.isFinite(price) ? Math.max(0, Math.min(1, price)) : fallback;
}

export function previewGain(price, stake = 100) {
  const p = Math.max(0.01, Math.min(0.99, Number(price) || 0.5));
  return Math.round((stake / p) - stake);
}

export function formatCompactVolume(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export function formatCardDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

export function accentForOutcome(index, total = 2) {
  const accents = [
    { bg: 'var(--yes-dim, rgba(22,163,74,0.1))', border: 'rgba(22,163,74,0.25)', fg: 'var(--yes)' },
    { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', fg: 'var(--gold, #f59e0b)' },
    { bg: 'rgba(255,59,59,0.08)', border: 'rgba(255,59,59,0.3)', fg: '#ff3b3b' },
    { bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.3)', fg: '#4ade80' },
    { bg: 'rgba(253,224,71,0.1)', border: 'rgba(253,224,71,0.35)', fg: '#fde047' },
    { bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.3)', fg: '#f87171' },
    { bg: 'rgba(21,128,61,0.12)', border: 'rgba(21,128,61,0.4)', fg: '#16a34a' },
    { bg: 'rgba(161,98,7,0.12)', border: 'rgba(161,98,7,0.4)', fg: '#b45309' },
    { bg: 'rgba(185,28,28,0.12)', border: 'rgba(185,28,28,0.4)', fg: '#dc2626' },
  ];

  if (total === 2) return index === 0 ? accents[0] : accents[2];
  if (total === 3) return accents[index] || accents[0];
  return accents[index % accents.length];
}

export function mapProtocolMarketToCard(row) {
  const outcomes = Array.isArray(row?.outcomes) && row.outcomes.length > 0
    ? row.outcomes
    : ['Sí', 'No'];
  const prices = Array.isArray(row?.prices) && row.prices.length === outcomes.length
    ? row.prices.map(Number)
    : pricesFromReserves(row?.reserves || []);
  const normalizedPrices = prices.length === outcomes.length
    ? prices
    : outcomes.map(() => 1 / outcomes.length);
  const category = String(row?.category || 'general').toLowerCase();

  return {
    ...row,
    id: row?.id,
    mode: 'onchain',
    source: row?.source || 'protocol',
    _source: 'protocol',
    marketId: row?.marketId,
    poolAddress: row?.poolAddress,
    factoryAddress: row?.factoryAddress,
    chainId: row?.chainId,
    question: row?.question || '',
    category,
    categoryLabel: CATEGORY_LABEL[category] || category,
    icon: null,
    outcomes,
    prices: normalizedPrices,
    status: row?.status || 'active',
    outcome: row?.outcome != null ? Number(row.outcome) : null,
    live: !!row?.live,
    featured: !!row?.featured,
    trending: !!row?.live || !!row?.featured || !!row?.trending,
    _live: !!row?.live,
    _resolved: row?.status === 'resolved',
    _winner: row?.status === 'resolved' && row?.outcome != null ? outcomes[Number(row.outcome)] : null,
    volume: Number(row?.liquidity ?? row?.volume ?? 0),
    tradeVolume: Number(row?.volume24h ?? row?.tradeVolume ?? 0),
    endTime: row?.endTime || null,
    resolvedAt: row?.resolvedAt || null,
    finalScore: row?.finalScore || null,
    outcomeImages: Array.isArray(row?.outcomeImages) ? row.outcomeImages : null,
    outcomeCountryLabels: Array.isArray(row?.outcomeCountryLabels) ? row.outcomeCountryLabels : null,
    categoryTags: Array.isArray(row?.categoryTags) ? row.categoryTags : [],
    geoTags: Array.isArray(row?.geoTags) ? row.geoTags : [],
    topicTags: Array.isArray(row?.topicTags) ? row.topicTags : [],
    sport: row?.sport || null,
    league: row?.league || null,
    crypto5min: !!row?.crypto5min,
    sourceEventId: row?.sourceEventId || null,
    resolverType: row?.resolverType || null,
    resolverSource: row?.resolverSource || null,
  };
}
