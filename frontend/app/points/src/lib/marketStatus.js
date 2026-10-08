export const CLOSING_SOON_MS = 8 * 60 * 60 * 1000;

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizedTags(value) {
  return Array.isArray(value)
    ? value.map(normalize).filter(Boolean)
    : [];
}

export function isSportsMarket(market = {}) {
  return normalize(market?.category) === 'deportes'
    || Boolean(normalize(market?.sport))
    || normalizedTags(market?.categoryTags).includes('deportes')
    || normalizedTags(market?.topicTags).includes('deportes');
}

export function isLiveSportsMarket(market = {}) {
  return Boolean(normalize(market?.sport));
}

export function isClosingSoonNonSportsMarket(market = {}, now = Date.now()) {
  if (!market || market.status !== 'active') return false;
  if (isLiveSportsMarket(market)) return false;
  const end = market.endTime ? new Date(market.endTime).getTime() : NaN;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(end) || !Number.isFinite(nowMs)) return false;
  const remaining = end - nowMs;
  return remaining > 0 && remaining <= CLOSING_SOON_MS;
}
