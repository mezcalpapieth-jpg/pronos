const DEFAULT_GRAPH_WINDOW_MS = 10 * 60_000;

function toMs(value) {
  if (!value) return NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function coerceId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : id;
}

function marketSummaryFromCurrent(market) {
  if (!market) return null;
  return {
    id: market.id,
    question: market.question,
    outcomes: Array.isArray(market.outcomes) ? market.outcomes : ['SUBE', 'BAJA'],
    prices: Array.isArray(market.prices) ? market.prices : [0.5, 0.5],
    status: market.status,
    outcome: market.outcome ?? null,
    finalScore: market.finalScore || null,
    resolvedAt: market.resolvedAt || null,
    startTime: market.startTime || null,
    endTime: market.endTime || null,
    cryptoMeta: market.cryptoMeta || null,
  };
}

export function buildCryptoMarketSequence(market) {
  const byId = new Map();
  const source = Array.isArray(market?.cryptoMeta?.marketSequence)
    ? market.cryptoMeta.marketSequence
    : [];
  const base = marketSummaryFromCurrent(market);

  for (const item of [...source, base]) {
    if (!item?.id) continue;
    byId.set(String(item.id), {
      ...item,
      id: coerceId(item.id),
      outcomes: Array.isArray(item.outcomes) ? item.outcomes : (base?.outcomes || ['SUBE', 'BAJA']),
      prices: Array.isArray(item.prices) ? item.prices : (base?.prices || [0.5, 0.5]),
      cryptoMeta: {
        ...(base?.cryptoMeta || {}),
        ...(item.cryptoMeta || {}),
      },
    });
  }

  return Array.from(byId.values()).sort((a, b) => {
    const aStart = toMs(a.startTime);
    const bStart = toMs(b.startTime);
    if (Number.isFinite(aStart) && Number.isFinite(bStart) && aStart !== bStart) {
      return aStart - bStart;
    }
    return Number(a.id) - Number(b.id);
  });
}

export function getSelectedCryptoMarket(baseMarket, selectedMarketId) {
  const sequence = buildCryptoMarketSequence(baseMarket);
  const fallback = marketSummaryFromCurrent(baseMarket);
  const selected = sequence.find((item) => String(item.id) === String(selectedMarketId))
    || sequence.find((item) => String(item.id) === String(baseMarket?.id))
    || fallback;

  if (!baseMarket || !selected) return baseMarket;

  return {
    ...baseMarket,
    id: selected.id,
    question: selected.question || baseMarket.question,
    outcomes: Array.isArray(selected.outcomes) ? selected.outcomes : baseMarket.outcomes,
    prices: Array.isArray(selected.prices) ? selected.prices : baseMarket.prices,
    status: selected.status || baseMarket.status,
    outcome: selected.outcome ?? null,
    finalScore: selected.finalScore || null,
    resolvedAt: selected.resolvedAt || null,
    startTime: selected.startTime || baseMarket.startTime,
    endTime: selected.endTime || baseMarket.endTime,
    cryptoMeta: {
      ...(baseMarket.cryptoMeta || {}),
      ...(selected.cryptoMeta || {}),
      marketSequence: baseMarket.cryptoMeta?.marketSequence || [],
      alternateAssetMarket: baseMarket.cryptoMeta?.alternateAssetMarket || null,
    },
  };
}

export function computeCryptoGraphFrame(sequence, {
  nowMs = Date.now(),
  history = [],
  fallbackWindowMs = DEFAULT_GRAPH_WINDOW_MS,
} = {}) {
  const latestHistoryMs = Array.isArray(history) && history.length > 0
    ? Number(history[history.length - 1]?.t)
    : NaN;
  const anchorNow = Number.isFinite(nowMs)
    ? nowMs
    : (Number.isFinite(latestHistoryMs) ? latestHistoryMs : Date.now());

  const windows = Array.isArray(sequence)
    ? sequence
        .map((market) => ({
          start: toMs(market?.startTime || market?.cryptoMeta?.openedAt),
          end: toMs(market?.endTime || market?.cryptoMeta?.closesAt),
        }))
        .filter((window) => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start)
    : [];

  const started = windows.filter((window) => window.start <= anchorNow);
  if (started.length === 0) {
    const end = Number.isFinite(latestHistoryMs) ? latestHistoryMs : anchorNow;
    return { xStart: end - fallbackWindowMs, xEnd: end };
  }

  const earliestStart = Math.min(...started.map((window) => window.start));
  const active = started.find((window) => window.end >= anchorNow);
  const latestStartedEnd = Math.max(...started.map((window) => window.end));
  const xEnd = Math.max(
    Number.isFinite(latestHistoryMs) ? latestHistoryMs : anchorNow,
    active?.end || latestStartedEnd,
    anchorNow,
  );

  if (xEnd <= earliestStart) {
    return { xStart: xEnd - fallbackWindowMs, xEnd };
  }

  return { xStart: earliestStart, xEnd };
}

export function cryptoMarketSequenceSignature(sequence) {
  if (!Array.isArray(sequence) || sequence.length === 0) return '';
  return sequence.map((market) => {
    const meta = market.cryptoMeta || {};
    return [
      market.id,
      market.status || '',
      market.outcome ?? '',
      market.startTime || '',
      market.endTime || '',
      Array.isArray(market.prices) ? market.prices.map((p) => Number(p).toFixed(6)).join(',') : '',
      meta.threshold ?? '',
      meta.openPrice ?? '',
      meta.closePrice ?? '',
      meta.openedAt || '',
      meta.closesAt || '',
    ].join(':');
  }).join('|');
}
