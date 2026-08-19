import { binaryPrices } from './amm-math.js';

export const PRICE_HISTORY_EXECUTION_BUCKET_MS = 2_000;
const SNAPSHOT_COALESCE_SECONDS = 2.5;
const EPSILON = 0.000001;

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function roundPct(price) {
  return Math.round(Number(price) * 10000) / 100;
}

export function priceHistoryExecutionBucket(value) {
  const ms = timestampMs(value);
  return ms > 0 ? Math.floor(ms / PRICE_HISTORY_EXECUTION_BUCKET_MS) : 0;
}

export function reservePriceForOutcome(value, outcomeIdx) {
  const reserves = parseJsonb(value, []);
  if (!Array.isArray(reserves) || reserves.length !== 2) return null;
  const oi = Number(outcomeIdx);
  if (!Number.isInteger(oi) || oi < 0 || oi > 1) return null;
  const cleaned = reserves.map(Number);
  if (!cleaned.every(n => Number.isFinite(n) && n > 0)) return null;
  try {
    const prices = binaryPrices(cleaned);
    const price = Number(prices[oi]);
    return Number.isFinite(price) && price > 0 && price < 1 ? price : null;
  } catch {
    return null;
  }
}

function projectedTradePrice(row, outcomeIdx) {
  const price = Number(row?.price_at_trade);
  const tradeOutcome = Number(row?.outcome_index);
  const requestedOutcome = Number(outcomeIdx);
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return null;
  if (!Number.isInteger(tradeOutcome) || tradeOutcome < 0 || tradeOutcome > 1) return null;
  if (!Number.isInteger(requestedOutcome) || requestedOutcome < 0 || requestedOutcome > 1) return null;
  return tradeOutcome === requestedOutcome ? price : 1 - price;
}

function tradeGroupKey(row) {
  return [
    Number(row?.market_id || 0),
    String(row?.username || ''),
    String(row?.side || ''),
    Number(row?.outcome_index || 0),
    priceHistoryExecutionBucket(row?.created_at),
  ].join(':');
}

export function displayTradePointsFromRows(rows, outcomeIdx) {
  const byGroup = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = tradeGroupKey(row);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(row);
  }

  const points = [];
  for (const groupRows of byGroup.values()) {
    const sorted = [...groupRows].sort((a, b) =>
      (timestampMs(a.created_at) - timestampMs(b.created_at)) ||
      (Number(a.id || 0) - Number(b.id || 0)),
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const tMs = timestampMs(last?.created_at);
    if (!first || !last || tMs <= 0) continue;

    const before = reservePriceForOutcome(first.reserves_before, outcomeIdx);
    let lastReserveAfter = null;
    let lastMovedReserveAfter = null;

    for (const row of sorted) {
      const rowBefore = reservePriceForOutcome(row.reserves_before, outcomeIdx);
      const rowAfter = reservePriceForOutcome(row.reserves_after, outcomeIdx);
      if (rowAfter == null) continue;
      lastReserveAfter = rowAfter;
      if (rowBefore != null && Math.abs(rowAfter - rowBefore) > EPSILON) {
        lastMovedReserveAfter = rowAfter;
      }
    }

    const tradeAfter = projectedTradePrice(last, outcomeIdx);
    let displayAfter = lastMovedReserveAfter ?? lastReserveAfter;
    if (
      tradeAfter != null &&
      (displayAfter == null || (before != null && Math.abs(displayAfter - before) <= EPSILON))
    ) {
      displayAfter = tradeAfter;
    }
    if (displayAfter == null) continue;

    points.push({
      market_id: Number(last.market_id),
      t: tMs / 1000,
      p: roundPct(displayAfter),
      _id: Number(last.id) || 0,
      _source: 'display_trade',
      _bucket: priceHistoryExecutionBucket(last.created_at),
    });
  }

  return points.sort((a, b) =>
    (Number(a.market_id || 0) - Number(b.market_id || 0)) ||
    (a.t - b.t) ||
    (a._id - b._id),
  );
}

export function mergeDisplayPricePoints(points, displayTradePoints) {
  const trades = (Array.isArray(displayTradePoints) ? displayTradePoints : [])
    .filter(pt => Number.isFinite(Number(pt?.t)) && Number.isFinite(Number(pt?.p)));
  if (trades.length === 0) return Array.isArray(points) ? points : [];

  const source = Array.isArray(points) ? points : [];
  const filtered = source.filter((pt) => {
    if (pt?._source !== 'snapshot') return true;
    const t = Number(pt.t);
    if (!Number.isFinite(t)) return true;
    return !trades.some(trade =>
      trade._bucket === pt._bucket ||
      Math.abs(Number(trade.t) - t) <= SNAPSHOT_COALESCE_SECONDS,
    );
  });

  return [...filtered, ...trades].sort((a, b) =>
    (a.t - b.t) ||
    ((a._source === 'display_trade' ? 1 : 0) - (b._source === 'display_trade' ? 1 : 0)) ||
    (Number(a._id || 0) - Number(b._id || 0)),
  );
}
