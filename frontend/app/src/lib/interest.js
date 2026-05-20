const ENDPOINT = '/api/interest';

function clean(value, max = 120) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : '';
}

function surfaceFor(value) {
  return value === 'points' ? 'points' : 'mvp';
}

export function trackInterest(payload) {
  if (typeof window === 'undefined') return;

  const body = JSON.stringify(payload || {});
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
  } catch {
    // Fall through to fetch; tracking should never interrupt navigation.
  }

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
