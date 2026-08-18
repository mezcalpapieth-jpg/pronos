const ABSOLUTE_OR_SPECIAL_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function normalizedBaseUrl() {
  const base = import.meta.env.BASE_URL || '/points/';
  return base.endsWith('/') ? base : `${base}/`;
}

export function pointsPublicAssetSrc(src) {
  const raw = String(src || '').trim();
  if (!raw) return '';
  if (ABSOLUTE_OR_SPECIAL_URL.test(raw)) return raw;
  if (!raw.startsWith('/')) return raw;

  const base = normalizedBaseUrl();
  if (raw === base.slice(0, -1) || raw.startsWith(base)) return raw;
  if (raw.startsWith('/api/') || raw.startsWith('/css/') || raw.startsWith('/mvp/')) return raw;

  return `${base}${raw.replace(/^\/+/, '')}`;
}
