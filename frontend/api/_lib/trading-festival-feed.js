import { FESTIVAL_CHART_LEAD_MS, FESTIVAL_MINUTE, isFestivalBitcoin } from '../../shared/trading-festival.js';

export function festivalFeedEnabled(slot) {
  return isFestivalBitcoin(slot);
}

export function festivalChartRange(slot, now) {
  const start = Date.parse(slot.startTime);
  return { from: Math.min(start, now) - FESTIVAL_CHART_LEAD_MS, to: Math.min(now, Date.parse(slot.endTime)) };
}

export async function readFestivalBars(slot, { from, to, fetchImpl = fetch }) {
  if (!festivalFeedEnabled(slot)) throw new Error('festival_feed_disabled');
  if (to <= from) return [];
  const floorStart = Math.floor(from / FESTIVAL_MINUTE) * FESTIVAL_MINUTE;
  const lastFullBoundary = Math.floor(to / FESTIVAL_MINUTE) * FESTIVAL_MINUTE;
  if (lastFullBoundary <= floorStart) return [];

  const url = new URL(`/products/${slot.ticker}/candles`, 'https://api.exchange.coinbase.com');
  url.search = new URLSearchParams({
    granularity: '60',
    start: new Date(floorStart).toISOString(),
    end: new Date(lastFullBoundary).toISOString(),
  });
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error(`festival_feed_http_${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('festival_feed_invalid_response');

  const bars = new Map();
  for (const row of rows) {
    const start = Number(row?.[0]) * 1000;
    const price = Number(row?.[4]);
    const t = start + FESTIVAL_MINUTE;
    if (start < floorStart || t > lastFullBoundary || start % FESTIVAL_MINUTE !== 0
      || !Number.isFinite(price) || price <= 0) continue;
    bars.set(t, { t, price });
  }
  return [...bars.values()].sort((left, right) => left.t - right.t);
}

export async function readFestivalBoundary(slot, { at, ...options }) {
  const bars = await readFestivalBars(slot, { from: at - FESTIVAL_MINUTE, to: at, ...options });
  // No stale fallback, partial bar, or observation after the boundary.
  return bars.find(bar => bar.t === at) ?? null;
}
