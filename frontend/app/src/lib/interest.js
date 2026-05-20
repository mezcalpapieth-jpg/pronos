const ENDPOINT = '/api/interest';
const CLIENT_ID_KEY = 'pronos_interest_client_id';
const DAILY_PREFIX = 'pronos_interest_daily:';
export const INTEREST_DAILY_SIGNAL_CAP = 5;

function clean(value, max = 120) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : '';
}

function surfaceFor(value) {
  return value === 'points' ? 'points' : 'mvp';
}

function isoDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function storageGet(key) {
  try {
    return window.localStorage?.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Interest tracking should never break browsing.
  }
}

function getClientId() {
  if (typeof window === 'undefined') return null;
  const existing = storageGet(CLIENT_ID_KEY);
  if (existing) return existing;
  const generated = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  storageSet(CLIENT_ID_KEY, generated);
  return generated;
}

export function interestDailyStorageKey(payload = {}, date = new Date()) {
  const surface = surfaceFor(payload.surface);
  const objectType = clean(payload.objectType, 40).toLowerCase();
  const objectId = clean(payload.objectId, 120);
  if (!objectType || !objectId) return null;
  return `${DAILY_PREFIX}${isoDay(date)}:${surface}:${objectType}:${objectId}`;
}

export function trackInterest(payload) {
  if (typeof window === 'undefined') return;

  const storageKey = interestDailyStorageKey(payload);
  const existingSignals = Math.max(0, Number(storageKey ? storageGet(storageKey) : 0) || 0);
  if (existingSignals >= INTEREST_DAILY_SIGNAL_CAP) return;

  const body = JSON.stringify({
    ...(payload || {}),
    clientId: getClientId(),
  });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) {
        if (storageKey) storageSet(storageKey, String(existingSignals + 1));
        return;
      }
    }
  } catch {
    // Fall through to fetch; tracking should never interrupt navigation.
  }

  if (storageKey) storageSet(storageKey, String(existingSignals + 1));
  fetch(ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function teamInterestPayload(surface, team, action = 'click') {
  const safeSurface = surfaceFor(surface);
  return {
    surface: safeSurface,
    objectType: 'team',
    objectId: `${clean(team?.sport, 32) || 'team'}:${clean(team?.slug, 80) || clean(team?.name, 80)}`,
    action,
    metadata: {
      label: clean(team?.name),
      sport: clean(team?.sport, 40),
      league: clean(team?.league, 80),
      country: clean(team?.country, 80),
    },
  };
}

export function marketInterestPayload(surface, market, action = 'click') {
  const safeSurface = surfaceFor(surface);
  const objectType = safeSurface === 'points' ? 'points_market' : 'protocol_market';
  return {
    surface: safeSurface,
    objectType,
    objectId: clean(market?.id, 120),
    action,
    metadata: {
      label: clean(market?.question || market?.title, 180),
      question: clean(market?.question || market?.title, 180),
      sport: clean(market?.sport, 40),
      league: clean(market?.league, 80),
      category: clean(market?.category || market?.categoryLabel, 80),
      status: clean(market?.status, 40),
      source: clean(market?.source || market?.resolverSource, 80),
    },
  };
}
