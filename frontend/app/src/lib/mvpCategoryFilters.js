function normalizedTags(value) {
  return Array.isArray(value)
    ? value.map(t => String(t || '').toLowerCase()).filter(Boolean)
    : [];
}

function normalizedSlug(value) {
  return String(value || '').toLowerCase();
}

function isLatamSportsFallback(market) {
  return normalizedSlug(market?.category) === 'deportes'
    && normalizedSlug(market?.sport) === 'soccer'
    && normalizedSlug(market?.league) === 'copa-libertadores';
}

export const MVP_PUBLIC_GEO_FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'mexico', label: 'México' },
  { key: 'latam', label: 'Latam' },
];

const MVP_PUBLIC_GEO_KEYS = new Set(MVP_PUBLIC_GEO_FILTERS.map(g => g.key));

export function marketInCategory(market, category) {
  const target = normalizedSlug(category);
  if (!target || target === 'all') return true;
  const primary = normalizedSlug(market?.category);
  const tags = normalizedTags(market?.categoryTags);
  if (target === 'mexico' && isLatamSportsFallback(market)) return true;
  return primary === target || tags.includes(target);
}

export function marketInGeo(market, geo) {
  const target = normalizedSlug(geo);
  if (!target || target === 'all') return true;
  if (!MVP_PUBLIC_GEO_KEYS.has(target)) return false;
  if (target === 'latam' && isLatamSportsFallback(market)) return true;
  return normalizedTags(market?.geoTags).includes(target);
}

export function marketInTopic(market, topic) {
  const target = normalizedSlug(topic);
  if (!target || target === 'all') return true;
  if (target === 'deportes' && isLatamSportsFallback(market)) return true;
  return normalizedTags(market?.topicTags).includes(target);
}
