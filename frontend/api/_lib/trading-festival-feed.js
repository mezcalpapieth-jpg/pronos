import { FESTIVAL_CHART_LEAD_MS, FESTIVAL_MINUTE } from '../../shared/trading-festival.js';

export function festivalFeedEnabled(slot, env = process.env) {
  if (slot.replay) return false;
  return slot.provider === 'Coinbase' || (
    slot.provider === 'Massive' && Boolean(massiveApiKey(env))
    && (env.TRADING_FESTIVAL_MASSIVE_SYMBOLS || '').split(',').map(value => value.trim()).includes(slot.key)
  );
}

function massiveApiKey(env) {
  return env.MASSIVE_API_KEY?.trim() || env.TRADING_FESTIVAL_MASSIVE_API_KEY?.trim();
}

export function festivalDataDelayMinutes(slot, env = process.env) {
  return !slot.replay && slot.provider === 'Massive'
    && (env.TRADING_FESTIVAL_MASSIVE_DELAYED_SYMBOLS || '').split(',').map(value => value.trim()).includes(slot.key)
    ? 15 : 0;
}

export function festivalChartRange(slot, now) {
  const start = Date.parse(slot.startTime);
  return { from: Math.min(start, now) - FESTIVAL_CHART_LEAD_MS, to: Math.min(now, Date.parse(slot.endTime)) };
}

export async function readFestivalBars(slot, {
  from, to, fetchImpl = fetch, env = process.env, allowDelayed = festivalDataDelayMinutes(slot, env) > 0,
}) {
  if (!festivalFeedEnabled(slot, env)) throw new Error('festival_feed_disabled');
  if (to <= from) return [];
  const floorStart = Math.floor(from / FESTIVAL_MINUTE) * FESTIVAL_MINUTE;
  const lastFullBoundary = Math.floor(to / FESTIVAL_MINUTE) * FESTIVAL_MINUTE;
  if (lastFullBoundary <= floorStart) return [];

  const headers = { Accept: 'application/json' };
  let url;
  if (slot.provider === 'Coinbase') {
    url = new URL(`/products/${slot.ticker}/candles`, 'https://api.exchange.coinbase.com');
    url.search = new URLSearchParams({
      granularity: '60',
      start: new Date(floorStart).toISOString(),
      end: new Date(lastFullBoundary).toISOString(),
    });
  } else {
    url = new URL(
      `/v2/aggs/ticker/${slot.ticker}/range/1/minute/${floorStart}/${lastFullBoundary - 1}`,
      'https://api.massive.com',
    );
    url.searchParams.set('sort', 'asc');
    headers.Authorization = `Bearer ${massiveApiKey(env)}`;
  }

  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error(`festival_feed_http_${response.status}`);
  const payload = await response.json();
  if (slot.provider === 'Massive' && payload.status === 'DELAYED' && !allowDelayed) {
    throw new Error('festival_feed_delayed');
  }
  const rows = slot.provider === 'Coinbase' ? payload : payload.results ?? [];
  if (!Array.isArray(rows) || (slot.provider === 'Massive' && !['OK', 'DELAYED'].includes(payload.status))) {
    throw new Error('festival_feed_invalid_response');
  }

  const bars = new Map();
  for (const row of rows) {
    const start = slot.provider === 'Coinbase' ? Number(row?.[0]) * 1000 : Number(row?.t);
    const price = Number(slot.provider === 'Coinbase' ? row?.[4] : row?.c);
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
