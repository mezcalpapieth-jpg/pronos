export const MARKET_CATEGORY_IMAGE_PLACEHOLDERS = Object.freeze({
  general: '/market-placeholders/general.svg',
  mexico: '/market-placeholders/mexico.svg',
  politica: '/market-placeholders/politica.svg',
  deportes: '/market-placeholders/deportes.svg',
  finanzas: '/market-placeholders/finanzas.svg',
  crypto: '/market-placeholders/crypto.svg',
  musica: '/market-placeholders/musica.svg',
  'world-cup': '/market-placeholders/world-cup.svg',
  weather: '/market-placeholders/weather.svg',
  aicm: '/market-placeholders/aicm.svg',
});

export function cleanMarketImageRef(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^\/[a-z0-9][a-z0-9/_\-.%]*$/i.test(text) && !text.includes('..')) return text;
  return null;
}

export function marketPlaceholderKey(market = {}) {
  const source = String(market?.resolverSource || market?.resolverConfig?.source || market?.source || '').toLowerCase();
  const question = String(market?.question || '').toLowerCase();
  const topicTags = Array.isArray(market?.topicTags) ? market.topicTags.map(tag => String(tag).toLowerCase()) : [];
  if (source.includes('aicm') || question.includes('aicm')) return 'aicm';
  if (topicTags.includes('weather') || source.includes('weather') || question.includes('temperatura')) return 'weather';
  const category = String(market?.category || 'general').trim().toLowerCase();
  return MARKET_CATEGORY_IMAGE_PLACEHOLDERS[category] ? category : 'general';
}

export function marketPlaceholderImageSrc(market = {}) {
  return MARKET_CATEGORY_IMAGE_PLACEHOLDERS[marketPlaceholderKey(market)]
    || MARKET_CATEGORY_IMAGE_PLACEHOLDERS.general;
}

export function marketImageSrc(market = {}) {
  return cleanMarketImageRef(market?.imageUrl || market?.image_url || market?.image)
    || marketPlaceholderImageSrc(market);
}
