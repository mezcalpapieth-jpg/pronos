const CATEGORY_KEYS = new Set(['general', 'mexico', 'politica', 'deportes', 'finanzas', 'crypto', 'musica']);
const GEO_KEYS = new Set(['mexico', 'latam']);
const TOPIC_KEYS = new Set(['general', 'politica', 'deportes', 'finanzas', 'crypto', 'musica', 'weather']);

const MEXICO_LEAGUES = new Set(['liga-mx', 'lmb']);
const MEXICO_SPORT_KEYWORDS = [
  'cruz azul',
  'chivas',
  'guadalajara',
  'america',
  'club america',
  'pumas',
  'tigres',
  'rayados',
  'monterrey',
  'toluca',
  'santos laguna',
  'atlas',
  'leon',
  'pachuca',
  'diablos rojos',
  'liga mx',
  'lmb',
];
const MEXICO_KEYWORDS = [
  'mexico',
  'mexico city',
  'cdmx',
  'guadalajara',
  'monterrey',
  'jalisco',
  'nuevo leon',
  'peso mexicano',
  'mxn',
  'aeromexico',
  'volaris',
  'pemex',
  ...MEXICO_SPORT_KEYWORDS,
];
const LATAM_KEYWORDS = [
  'latam',
  'latin america',
  'latinoamerica',
  'america latina',
  'argentina',
  'brasil',
  'brazil',
  'colombia',
  'chile',
  'peru',
  'uruguay',
  'paraguay',
  'bolivia',
  'ecuador',
  'venezuela',
  'costa rica',
  'panama',
  'guatemala',
  'dominican republic',
  'republica dominicana',
];

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeSlug(value) {
  return stripAccents(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeText(value) {
  return stripAccents(value).toLowerCase();
}

function safeJson(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function parseMaybeJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function addUnique(list, value, allowed = null) {
  const normalized = normalizeSlug(value);
  if (!normalized) return;
  if (allowed && !allowed.has(normalized)) return;
  if (!list.includes(normalized)) list.push(normalized);
}

export function normalizeTagList(value, allowed = null) {
  const raw = parseMaybeJson(value, value);
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,\s]+/)
      : [];
  const out = [];
  for (const item of arr) addUnique(out, item, allowed);
  return out;
}

function readNestedTags(sourceData, key, allowed) {
  const out = [];
  if (!sourceData || typeof sourceData !== 'object') return out;
  for (const holder of [sourceData, sourceData.tags, sourceData.categorization]) {
    if (!holder || typeof holder !== 'object') continue;
    for (const item of normalizeTagList(holder[key], allowed)) addUnique(out, item, allowed);
  }
  return out;
}

export function deriveMarketTags(row = {}) {
  const sourceData = parseMaybeJson(row.source_data ?? row.sourceData ?? row.pending_source_data, {});
  const resolverConfig = parseMaybeJson(row.resolver_config ?? row.resolverConfig, {});
  const category = normalizeSlug(row.category) || 'general';
  const sport = normalizeSlug(row.sport);
  const league = normalizeSlug(row.league);
  const source = normalizeSlug(row.source ?? sourceData?.source ?? resolverConfig?.source);
  const resolverType = normalizeSlug(row.resolver_type ?? row.resolverType);

  const categoryTags = [];
  const geoTags = [];
  const topicTags = [];

  for (const tag of normalizeTagList(row.category_tags ?? row.categoryTags, CATEGORY_KEYS)) addUnique(categoryTags, tag, CATEGORY_KEYS);
  for (const tag of normalizeTagList(row.geo_tags ?? row.geoTags, GEO_KEYS)) addUnique(geoTags, tag, GEO_KEYS);
  for (const tag of normalizeTagList(row.topic_tags ?? row.topicTags, TOPIC_KEYS)) addUnique(topicTags, tag, TOPIC_KEYS);
  for (const tag of readNestedTags(sourceData, 'categoryTags', CATEGORY_KEYS)) addUnique(categoryTags, tag, CATEGORY_KEYS);
  for (const tag of readNestedTags(sourceData, 'category_tags', CATEGORY_KEYS)) addUnique(categoryTags, tag, CATEGORY_KEYS);
  for (const tag of readNestedTags(sourceData, 'geoTags', GEO_KEYS)) addUnique(geoTags, tag, GEO_KEYS);
  for (const tag of readNestedTags(sourceData, 'geo_tags', GEO_KEYS)) addUnique(geoTags, tag, GEO_KEYS);
  for (const tag of readNestedTags(sourceData, 'topicTags', TOPIC_KEYS)) addUnique(topicTags, tag, TOPIC_KEYS);
  for (const tag of readNestedTags(sourceData, 'topic_tags', TOPIC_KEYS)) addUnique(topicTags, tag, TOPIC_KEYS);

  addUnique(categoryTags, category, CATEGORY_KEYS);

  const region = normalizeSlug(sourceData?.region ?? sourceData?.marketRegion ?? sourceData?.geo);
  if (region === 'mexico' || region === 'mx') {
    addUnique(geoTags, 'mexico', GEO_KEYS);
    addUnique(categoryTags, 'mexico', CATEGORY_KEYS);
  } else if (region === 'latam' || region === 'latin-america' || region === 'america-latina') {
    addUnique(geoTags, 'latam', GEO_KEYS);
    addUnique(categoryTags, 'mexico', CATEGORY_KEYS);
  }

  if (MEXICO_LEAGUES.has(league)) {
    addUnique(geoTags, 'mexico', GEO_KEYS);
    addUnique(categoryTags, 'mexico', CATEGORY_KEYS);
  }

  const haystack = normalizeText([
    row.question,
    row.icon,
    row.source_event_id,
    row.sourceEventId,
    source,
    sport,
    league,
    safeJson(sourceData),
    safeJson(resolverConfig),
  ].filter(Boolean).join(' '));

  if (MEXICO_KEYWORDS.some(word => haystack.includes(word))) {
    addUnique(geoTags, 'mexico', GEO_KEYS);
    addUnique(categoryTags, 'mexico', CATEGORY_KEYS);
  }
  if (LATAM_KEYWORDS.some(word => haystack.includes(word))) {
    addUnique(geoTags, 'latam', GEO_KEYS);
    addUnique(categoryTags, 'mexico', CATEGORY_KEYS);
  }

  const isWeather = resolverType === 'weather-api'
    || source === 'weather'
    || source.includes('weather')
    || haystack.includes('weather')
    || haystack.includes('temperatura')
    || haystack.includes('lluvia');
  if (isWeather) {
    addUnique(topicTags, 'weather', TOPIC_KEYS);
    addUnique(categoryTags, 'mexico', CATEGORY_KEYS);
    if (geoTags.length === 0) addUnique(geoTags, 'mexico', GEO_KEYS);
  }

  if (category !== 'mexico') {
    addUnique(topicTags, category, TOPIC_KEYS);
  } else if (topicTags.length === 0) {
    addUnique(topicTags, 'general', TOPIC_KEYS);
  }

  return { categoryTags, geoTags, topicTags };
}

export function isCryptoFiveMinute(row = {}) {
  if (row.crypto5min === true) return true;
  const cfg = parseMaybeJson(row.resolver_config ?? row.resolverConfig, null);
  return cfg?.shape === 'binary-direction';
}

export function matchesMarketTaxonomy(row = {}, filters = {}) {
  const category = normalizeSlug(filters.category);
  const sport = normalizeSlug(filters.sport);
  const league = normalizeSlug(filters.league);
  const geo = normalizeSlug(filters.geo);
  const topic = normalizeSlug(filters.topic);
  const cryptoType = normalizeSlug(filters.cryptoType ?? filters.crypto_type);
  const tags = deriveMarketTags(row);

  if (category && category !== 'all') {
    const primary = normalizeSlug(row.category);
    if (primary !== category && !tags.categoryTags.includes(category)) return false;
  }
  if (sport && sport !== 'all' && normalizeSlug(row.sport) !== sport) return false;
  if (league && league !== 'all' && normalizeSlug(row.league) !== league) return false;
  if (geo && geo !== 'all' && !tags.geoTags.includes(geo)) return false;
  if (topic && topic !== 'all' && !tags.topicTags.includes(topic)) return false;
  if (cryptoType && cryptoType !== 'all') {
    const is5Min = isCryptoFiveMinute(row);
    if (cryptoType === '5min' && !is5Min) return false;
    if (cryptoType === 'general' && is5Min) return false;
  }
  return true;
}
