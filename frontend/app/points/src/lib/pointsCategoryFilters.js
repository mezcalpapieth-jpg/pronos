function normalizedTags(value) {
  return Array.isArray(value)
    ? value.map(t => String(t || '').toLowerCase()).filter(Boolean)
    : [];
}

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
  return normalizedTags(m?.geoTags).includes(target);
}

export function marketInTopic(m, topic) {
  const target = String(topic || '').toLowerCase();
  if (!target || target === 'all') return true;
  return normalizedTags(m?.topicTags).includes(target);
}
