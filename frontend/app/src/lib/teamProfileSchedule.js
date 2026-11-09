import { marketOnlyState } from './teamProfileRows.js';

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

function fixtureState(row) {
  const specific = [row.statusCode, row.statusDetail, row.status]
    .filter(Boolean)
    .map(value => String(value).trim().toLowerCase().replace(/^status_/, '').replace(/[^a-z0-9]+/g, '_'));
  for (const status of specific) {
    if (/^postponed(?:_|$)/.test(status)) return 'postponed';
    if (/^delayed(?:_|$)/.test(status)) return 'delayed';
    if (/^(suspended|interrupted)(?:_|$)/.test(status)) return 'suspended';
    if (/^(canceled|cancelled|abandoned)(?:_|$)/.test(status)) return 'cancelado';
    if (/^(forfeit|forfeited|awarded)(?:_|$)/.test(status)) return 'awarded';
  }
  for (const status of specific) {
    if (/^(in|live|in_progress|halftime|half_time|paused|end_period|end_of_period)$/.test(status)) return 'live';
    if (/^(closed|complete|completed|final(?:_.*)?|finished|full_time|ft|aet)$/.test(status)) return 'closed';
    if (status === 'post' && row.statusCompleted !== false) return 'closed';
    if (/^(pre|scheduled|timed|not_started)$/.test(status)) return 'pending';
  }
  if (specific.length > 0) return 'pending';
  const startMs = Date.parse(row.startsAt);
  return startMs + 3 * 60 * 60 * 1000 < Date.now() ? 'closed' : 'pending';
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
      const fixture = fixtureState(item);
      return {
        ...item,
        market,
        fixtureState: fixture,
        state: market ? marketOnlyState(market) : fixture,
      };
    })
    .sort((a, b) => {
      const aMs = a.startsAt ? new Date(a.startsAt).getTime() : 0;
      const bMs = b.startsAt ? new Date(b.startsAt).getTime() : 0;
      return aMs - bMs;
    });
}
