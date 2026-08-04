const CATEGORY_KEYS = new Set(['general', 'mexico', 'politica', 'deportes', 'finanzas', 'crypto', 'musica', 'world-cup']);
const GEO_KEYS = new Set(['mexico', 'latam', 'world']);
const TOPIC_KEYS = new Set([
  'general',
  'politica',
  'deportes',
  'finanzas',
  'crypto',
  'musica',
  'cine',
  'tv',
  'farandula',
  'weather',
  'world-cup',
]);
const ISOLATED_CATEGORY_KEYS = new Set(['crypto', 'world-cup']);

const MEXICO_LEAGUES = new Set(['liga-mx', 'lmb', 'lmp']);
const LATAM_LEAGUES = new Set(['copa-libertadores']);
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
  'conmebol',
  'copa libertadores',
  'libertadores',
];
const ENTERTAINMENT_TOPIC_KEYWORDS = {
  musica: [
    'musica',
    'cancion',
    'album',
    'sencillo',
    'artista',
    'cantante',
    'spotify',
    'billboard',
    'grammy',
    'latin grammy',
    'premios juventud',
    'premios lo nuestro',
    'concierto',
    'tour',
  ],
  cine: [
    'cine',
    'pelicula',
    'film',
    'taquilla',
    'estreno',
    'actor',
    'actriz',
    'director',
    'oscar',
    'oscars',
    'spider-man',
    'spiderman',
    'marvel',
    'dc studios',
    'hollywood',
    'the odyssey',
  ],
  tv: [
    'tv',
    'television',
    'serie',
    'emmy',
    'emmys',
    'reality',
    'streaming',
    'netflix',
    'hbo',
    'disney',
    'la casa de los famosos',
  ],
  farandula: [
    'farandula',
    'celebridad',
    'celebridades',
    'influencer',
    'tiktok',
    'instagram',
    'famosos',
    'famosa',
    'noviazgo',
    'boda',
    'divorcio',
    'escandalo',
    'romance',
    'pareja',
  ],
};

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

function hasAnyKeyword(haystack, words) {
  return words.some(word => haystack.includes(word));
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
  const isolatedCategory = ISOLATED_CATEGORY_KEYS.has(category) || league === 'world-cup';

  const categoryTags = [];
  const geoTags = [];
  const topicTags = [];

  const explicitCategoryTags = [
    ...normalizeTagList(row.category_tags ?? row.categoryTags, CATEGORY_KEYS),
    ...readNestedTags(sourceData, 'categoryTags', CATEGORY_KEYS),
    ...readNestedTags(sourceData, 'category_tags', CATEGORY_KEYS),
  ];
  const explicitGeoTags = [
    ...normalizeTagList(row.geo_tags ?? row.geoTags, GEO_KEYS),
    ...readNestedTags(sourceData, 'geoTags', GEO_KEYS),
    ...readNestedTags(sourceData, 'geo_tags', GEO_KEYS),
  ];
  const explicitTopicTags = [
    ...normalizeTagList(row.topic_tags ?? row.topicTags, TOPIC_KEYS),
    ...readNestedTags(sourceData, 'topicTags', TOPIC_KEYS),
    ...readNestedTags(sourceData, 'topic_tags', TOPIC_KEYS),
  ];

  for (const tag of explicitCategoryTags) {
    if (!isolatedCategory || tag === category) addUnique(categoryTags, tag, CATEGORY_KEYS);
  }
  if (!isolatedCategory) {
    for (const tag of explicitGeoTags) {
      addUnique(geoTags, tag, GEO_KEYS);
      if (tag !== 'world') addUnique(categoryTags, 'mexico', CATEGORY_KEYS);
    }
  }
  for (const tag of explicitTopicTags) {
    if (!isolatedCategory || tag === category) addUnique(topicTags, tag, TOPIC_KEYS);
  }

  addUnique(categoryTags, category, CATEGORY_KEYS);

  const region = normalizeSlug(sourceData?.region ?? sourceData?.marketRegion ?? sourceData?.geo);
  const hasExplicitGeoSignal = !isolatedCategory && (explicitGeoTags.length > 0 || !!region);
  function addGeoMembership(value) {
    addUnique(geoTags, value, GEO_KEYS);
    if (value !== 'world') addUnique(categoryTags, 'mexico', CATEGORY_KEYS);
  }

  if (!isolatedCategory) {
    if (region === 'mexico' || region === 'mx') {
      addGeoMembership('mexico');
    } else if (region === 'latam' || region === 'latin-america' || region === 'america-latina') {
      addGeoMembership('latam');
    } else if (region === 'world' || region === 'global' || region === 'mundo' || region === 'us' || region === 'usa' || region === 'international' || region === 'internacional') {
      addUnique(geoTags, 'world', GEO_KEYS);
    }
  }

  const shouldInferRegionalTags = !isolatedCategory && !hasExplicitGeoSignal;

  if (shouldInferRegionalTags && MEXICO_LEAGUES.has(league)) {
    addGeoMembership('mexico');
  }
  if (shouldInferRegionalTags && LATAM_LEAGUES.has(league)) {
    addGeoMembership('latam');
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

  if (shouldInferRegionalTags && MEXICO_KEYWORDS.some(word => haystack.includes(word))) {
    addGeoMembership('mexico');
  }
  if (shouldInferRegionalTags && LATAM_KEYWORDS.some(word => haystack.includes(word))) {
    addGeoMembership('latam');
  }

  const isWeather = resolverType === 'weather-api'
    || source === 'weather'
    || source.includes('weather')
    || haystack.includes('weather')
    || haystack.includes('temperatura')
    || haystack.includes('lluvia');
  if (isWeather) {
    addUnique(topicTags, 'weather', TOPIC_KEYS);
    if (!isolatedCategory) {
      addUnique(categoryTags, 'mexico', CATEGORY_KEYS);
      if (geoTags.length === 0) addUnique(geoTags, 'mexico', GEO_KEYS);
    }
  }

  const entertainmentKind = normalizeSlug(sourceData?.kind);
  const entertainmentHaystack = normalizeText([
    haystack,
    sourceData?.awardLabel,
    sourceData?.awardKey,
    sourceData?.categoryLabel,
    sourceData?.categoryKey,
    sourceData?.showLabel,
  ].filter(Boolean).join(' '));
  const isEntertainment = !isolatedCategory && (
    category === 'musica'
    || source === 'entertainment'
    || entertainmentKind === 'award'
    || entertainmentKind === 'concert'
    || entertainmentKind.startsWith('reality')
    || hasAnyKeyword(entertainmentHaystack, [
      'premios',
      'oscar',
      'emmy',
      'grammy',
      'cine',
      'pelicula',
      'spotify',
      'la casa de los famosos',
      'famosos',
    ])
  );
  if (isEntertainment) {
    if (entertainmentKind === 'concert') addUnique(topicTags, 'musica', TOPIC_KEYS);
    if (entertainmentKind.startsWith('reality')) {
      addUnique(topicTags, 'tv', TOPIC_KEYS);
      addUnique(topicTags, 'farandula', TOPIC_KEYS);
    }

    for (const [topicKey, words] of Object.entries(ENTERTAINMENT_TOPIC_KEYWORDS)) {
      if (hasAnyKeyword(entertainmentHaystack, words)) addUnique(topicTags, topicKey, TOPIC_KEYS);
    }

    if (entertainmentKind === 'award' && topicTags.length === 0) {
      addUnique(topicTags, 'musica', TOPIC_KEYS);
    }
  }

  if (category === 'musica') {
    if (topicTags.length === 0) addUnique(topicTags, 'musica', TOPIC_KEYS);
  } else if (category !== 'mexico') {
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
