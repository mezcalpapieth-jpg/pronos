function normalizedTags(value) {
  return Array.isArray(value)
    ? value.map(t => String(t || '').toLowerCase()).filter(Boolean)
    : [];
}

export const PUBLIC_GEO_FILTERS = [
  { key: 'all',    tKey: 'points.geo.all' },
  { key: 'mexico', tKey: 'points.geo.mexico' },
  { key: 'latam',  tKey: 'points.geo.latam' },
];

const PUBLIC_GEO_KEYS = new Set(PUBLIC_GEO_FILTERS.map(g => g.key));

export function marketInCategory(m, category) {
  const target = String(category || '').toLowerCase();
  if (!target || target === 'all') return true;
  const primary = String(m?.category || '').toLowerCase();
  const tags = normalizedTags(m?.categoryTags);
  return primary === target || tags.includes(target);
}

export function marketInGeo(m, geo) {
  const target = String(geo || '').toLowerCase();
  if (!target || target === 'all') return true;
  if (!PUBLIC_GEO_KEYS.has(target)) return false;
  return normalizedTags(m?.geoTags).includes(target);
}

export function marketInTopic(m, topic) {
  const target = String(topic || '').toLowerCase();
  if (!target || target === 'all') return true;
  return normalizedTags(m?.topicTags).includes(target);
}
