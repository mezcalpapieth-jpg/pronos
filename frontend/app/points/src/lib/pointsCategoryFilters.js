function normalizedTags(value) {
  return Array.isArray(value)
    ? value.map(t => String(t || '').toLowerCase()).filter(Boolean)
    : [];
}

function normalizedSlug(value) {
  return String(value || '').toLowerCase();
}

function normalizedCategorySlug(value) {
  return normalizedSlug(value);
}

function isLatamSportsFallback(market) {
  return normalizedSlug(market?.category) === 'deportes'
    && normalizedSlug(market?.sport) === 'soccer'
    && normalizedSlug(market?.league) === 'copa-libertadores';
}

export const PUBLIC_GEO_FILTERS = [
  { key: 'all',    tKey: 'points.geo.all' },
  { key: 'mexico', tKey: 'points.geo.mexico' },
  { key: 'latam',  tKey: 'points.geo.latam' },
];

const PUBLIC_GEO_KEYS = new Set(PUBLIC_GEO_FILTERS.map(g => g.key));

export function marketInCategory(m, category) {
  const target = normalizedCategorySlug(category);
  if (!target || target === 'all') return true;
  const primary = normalizedCategorySlug(m?.category);
  const tags = normalizedTags(m?.categoryTags).map(normalizedCategorySlug);
  if (target === 'mexico' && isLatamSportsFallback(m)) return true;
  return primary === target || tags.includes(target);
}

export function marketInGeo(m, geo) {
  const target = normalizedSlug(geo);
  if (!target || target === 'all') return true;
  if (!PUBLIC_GEO_KEYS.has(target)) return false;
  if (target === 'latam' && isLatamSportsFallback(m)) return true;
  return normalizedTags(m?.geoTags).includes(target);
}

export function marketInTopic(m, topic) {
  const target = normalizedSlug(topic);
  if (!target || target === 'all') return true;
  if (target === 'deportes' && isLatamSportsFallback(m)) return true;
  return normalizedTags(m?.topicTags).includes(target);
}
