function normalizedTags(value) {
  return Array.isArray(value)
    ? value.map(t => String(t || '').toLowerCase()).filter(Boolean)
    : [];
}

export const MVP_PUBLIC_GEO_FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'mexico', label: 'México' },
  { key: 'latam', label: 'Latam' },
];

const MVP_PUBLIC_GEO_KEYS = new Set(MVP_PUBLIC_GEO_FILTERS.map(g => g.key));

export function marketInCategory(market, category) {
  const target = String(category || '').toLowerCase();
  if (!target || target === 'all') return true;
  const primary = String(market?.category || '').toLowerCase();
  const tags = normalizedTags(market?.categoryTags);
  return primary === target || tags.includes(target);
}

export function marketInGeo(market, geo) {
  const target = String(geo || '').toLowerCase();
  if (!target || target === 'all') return true;
  if (!MVP_PUBLIC_GEO_KEYS.has(target)) return false;
  return normalizedTags(market?.geoTags).includes(target);
}

export function marketInTopic(market, topic) {
  const target = String(topic || '').toLowerCase();
  if (!target || target === 'all') return true;
  return normalizedTags(market?.topicTags).includes(target);
}
