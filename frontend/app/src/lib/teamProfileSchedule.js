function eventKey(source, sourceEventId) {
  const src = String(source || '').toLowerCase();
  const id = String(sourceEventId || '').toLowerCase();
  if (!src || !id) return null;
  return `${src}:${id}`;
}

function marketEventKeys(market) {
  const keys = new Set();
  const direct = eventKey(market?.source, market?.sourceEventId || market?.source_event_id);
  if (direct) keys.add(direct);

  const cfg = market?.resolverConfig || market?.resolver_config || {};
  const resolverSource = cfg?.source === 'football-data' ? 'football-data.org' : cfg?.source;
  const resolverId = cfg?.eventId || cfg?.matchId || cfg?.sourceEventId;
  const resolver = eventKey(resolverSource, resolverId);
  if (resolver) keys.add(resolver);

  return keys;
}

function rowState(scheduleRow, market) {
  if (!market) return 'pending';
  if (market.status === 'resolved') return 'resolved';
  if (market.status === 'canceled' || market.status === 'cancelled') return 'cancelado';
  if (market.status === 'disputed') return 'disputa';

  const endMs = market.endTime ? new Date(market.endTime).getTime() : 0;
  if (market.status === 'active' && endMs > 0 && endMs < Date.now()) return 'por-resolver';
  if (market.status === 'active') return 'open';

  return market.status || scheduleRow?.status || 'pending';
}

export function mergeScheduleWithMarkets(schedule = [], markets = []) {
  const byKey = new Map();
  for (const market of markets || []) {
    for (const key of marketEventKeys(market)) {
      if (!byKey.has(key)) byKey.set(key, market);
    }
  }

  return (schedule || [])
    .map(item => {
      const key = eventKey(item?.source, item?.sourceEventId);
      const market = key ? byKey.get(key) || null : null;
      return {
        ...item,
        market,
        state: rowState(item, market),
      };
    })
    .sort((a, b) => {
      const aMs = a.startsAt ? new Date(a.startsAt).getTime() : 0;
      const bMs = b.startsAt ? new Date(b.startsAt).getTime() : 0;
      return aMs - bMs;
    });
}
