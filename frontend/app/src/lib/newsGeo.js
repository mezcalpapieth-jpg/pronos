import { findTeamByName } from './teamProfiles.js';

export const NEWS_GEO_REGIONS = [
  { key: 'all', label: 'Todos', center: { lat: 18, lng: -35 }, zoom: 1.0 },
  { key: 'mexico', label: 'México', center: { lat: 23.6, lng: -102.5 }, zoom: 2.2 },
  { key: 'latam', label: 'Latam', center: { lat: -15, lng: -58 }, zoom: 1.0, globeAltitude: 2.15 },
  { key: 'us-canada', label: 'US / Canadá', center: { lat: 46, lng: -101 }, zoom: 1.55 },
  { key: 'europe', label: 'Europa', center: { lat: 51, lng: 12 }, zoom: 1.8 },
  { key: 'asia', label: 'Asia', center: { lat: 22, lng: 78 }, zoom: 1.0, globeAltitude: 2.15 },
];

const CITY_ENTITIES = [
  { id: 'guadalajara', name: 'Guadalajara', aliases: ['guadalajara', 'jalisco'], region: 'mexico', country: 'MX', subdivisionId: 'mx-jalisco', subdivisionName: 'Jalisco', lat: 20.6597, lng: -103.3496 },
  { id: 'cdmx', name: 'Ciudad de México', aliases: ['ciudad de mexico', 'cdmx', 'capital mexicana'], region: 'mexico', country: 'MX', subdivisionId: 'mx-ciudad-de-mexico', subdivisionName: 'Ciudad de Mexico', lat: 19.4326, lng: -99.1332 },
  { id: 'monterrey', name: 'Monterrey', aliases: ['monterrey', 'nuevo leon', 'nuevo león'], region: 'mexico', country: 'MX', subdivisionId: 'mx-nuevo-leon', subdivisionName: 'Nuevo Leon', lat: 25.6866, lng: -100.3161 },
  { id: 'puebla', name: 'Puebla', aliases: ['puebla'], region: 'mexico', country: 'MX', subdivisionId: 'mx-puebla', subdivisionName: 'Puebla', lat: 19.0414, lng: -98.2063 },
  { id: 'queretaro', name: 'Querétaro', aliases: ['queretaro', 'querétaro'], region: 'mexico', country: 'MX', subdivisionId: 'mx-queretaro', subdivisionName: 'Queretaro', lat: 20.5888, lng: -100.3899 },
  { id: 'tijuana', name: 'Tijuana', aliases: ['tijuana'], region: 'mexico', country: 'MX', subdivisionId: 'mx-baja-california', subdivisionName: 'Baja California', lat: 32.5149, lng: -117.0382 },
  { id: 'cancun', name: 'Cancún', aliases: ['cancun', 'cancún', 'quintana roo'], region: 'mexico', country: 'MX', subdivisionId: 'mx-quintana-roo', subdivisionName: 'Quintana Roo', lat: 21.1619, lng: -86.8515 },
  { id: 'merida', name: 'Mérida', aliases: ['merida', 'mérida', 'yucatan', 'yucatán'], region: 'mexico', country: 'MX', subdivisionId: 'mx-yucatan', subdivisionName: 'Yucatan', lat: 20.9674, lng: -89.5926 },
  { id: 'los-angeles', name: 'Los Ángeles', aliases: ['los angeles', 'los ángeles'], region: 'us-canada', country: 'US', subdivisionId: 'us-california', subdivisionName: 'California', lat: 34.0522, lng: -118.2437 },
  { id: 'new-york', name: 'Nueva York', aliases: ['nueva york', 'new york'], region: 'us-canada', country: 'US', subdivisionId: 'us-new-york', subdivisionName: 'New York', lat: 40.7128, lng: -74.0060 },
  { id: 'washington', name: 'Washington', aliases: ['washington', 'washington dc'], region: 'us-canada', country: 'US', subdivisionId: 'us-district-of-columbia', subdivisionName: 'District of Columbia', lat: 38.9072, lng: -77.0369 },
  { id: 'toronto', name: 'Toronto', aliases: ['toronto'], region: 'us-canada', country: 'CA', lat: 43.6532, lng: -79.3832 },
  { id: 'buenos-aires', name: 'Buenos Aires', aliases: ['buenos aires'], region: 'latam', country: 'AR', lat: -34.6037, lng: -58.3816 },
  { id: 'bogota', name: 'Bogotá', aliases: ['bogota', 'bogotá'], region: 'latam', country: 'CO', lat: 4.7110, lng: -74.0721 },
  { id: 'sao-paulo', name: 'São Paulo', aliases: ['sao paulo', 'são paulo'], region: 'latam', country: 'BR', lat: -23.5558, lng: -46.6396 },
  { id: 'santiago', name: 'Santiago', aliases: ['santiago de chile', 'santiago'], region: 'latam', country: 'CL', lat: -33.4489, lng: -70.6693 },
  { id: 'lima', name: 'Lima', aliases: ['lima'], region: 'latam', country: 'PE', lat: -12.0464, lng: -77.0428 },
  { id: 'budapest', name: 'Budapest', aliases: ['budapest', 'puskas arena', 'puskás arena', 'puskas aréna', 'puskás aréna'], region: 'europe', country: 'HU', lat: 47.4979, lng: 19.0402 },
  { id: 'madrid', name: 'Madrid', aliases: ['madrid'], region: 'europe', country: 'ES', lat: 40.4168, lng: -3.7038 },
  { id: 'paris', name: 'París', aliases: ['paris', 'parís'], region: 'europe', country: 'FR', lat: 48.8566, lng: 2.3522 },
  { id: 'london', name: 'Londres', aliases: ['londres', 'london'], region: 'europe', country: 'GB', lat: 51.5072, lng: -0.1276 },
];

const COUNTRY_ENTITIES = [
  { id: 'mexico', name: 'México', aliases: ['mexico', 'méxico'], region: 'mexico', country: 'MX', lat: 23.6, lng: -102.5 },
  { id: 'argentina', name: 'Argentina', aliases: ['argentina'], region: 'latam', country: 'AR', lat: -38.4, lng: -63.6 },
  { id: 'brasil', name: 'Brasil', aliases: ['brasil', 'brazil'], region: 'latam', country: 'BR', lat: -14.2, lng: -51.9 },
  { id: 'colombia', name: 'Colombia', aliases: ['colombia'], region: 'latam', country: 'CO', lat: 4.6, lng: -74.1 },
  { id: 'chile', name: 'Chile', aliases: ['chile'], region: 'latam', country: 'CL', lat: -35.7, lng: -71.5 },
  { id: 'peru', name: 'Perú', aliases: ['peru', 'perú'], region: 'latam', country: 'PE', lat: -9.2, lng: -75 },
  { id: 'paraguay', name: 'Paraguay', aliases: ['paraguay'], region: 'latam', country: 'PY', lat: -23.4, lng: -58.4 },
  { id: 'ecuador', name: 'Ecuador', aliases: ['ecuador'], region: 'latam', country: 'EC', lat: -1.8, lng: -78.2 },
  { id: 'bolivia', name: 'Bolivia', aliases: ['bolivia'], region: 'latam', country: 'BO', lat: -16.3, lng: -63.6 },
  { id: 'uruguay', name: 'Uruguay', aliases: ['uruguay'], region: 'latam', country: 'UY', lat: -32.5, lng: -55.8 },
  { id: 'venezuela', name: 'Venezuela', aliases: ['venezuela'], region: 'latam', country: 'VE', lat: 6.4, lng: -66.6 },
  { id: 'guatemala', name: 'Guatemala', aliases: ['guatemala'], region: 'latam', country: 'GT', lat: 15.8, lng: -90.2 },
  { id: 'belice', name: 'Belice', aliases: ['belice', 'belize'], region: 'latam', country: 'BZ', lat: 17.2, lng: -88.5 },
  { id: 'honduras', name: 'Honduras', aliases: ['honduras'], region: 'latam', country: 'HN', lat: 15.2, lng: -86.2 },
  { id: 'el-salvador', name: 'El Salvador', aliases: ['el salvador', 'salvador'], region: 'latam', country: 'SV', lat: 13.8, lng: -88.9 },
  { id: 'nicaragua', name: 'Nicaragua', aliases: ['nicaragua'], region: 'latam', country: 'NI', lat: 12.9, lng: -85.2 },
  { id: 'costa-rica', name: 'Costa Rica', aliases: ['costa rica'], region: 'latam', country: 'CR', lat: 9.7, lng: -84.2 },
  { id: 'panama', name: 'Panamá', aliases: ['panama', 'panamá'], region: 'latam', country: 'PA', lat: 8.5, lng: -80.8 },
  { id: 'estados-unidos', name: 'Estados Unidos', aliases: ['estados unidos', 'eeuu', 'eua', 'usa', 'united states'], region: 'us-canada', country: 'US', lat: 39.8, lng: -98.6 },
  { id: 'canada', name: 'Canadá', aliases: ['canada', 'canadá'], region: 'us-canada', country: 'CA', lat: 56.1, lng: -106.3 },
  { id: 'francia', name: 'Francia', aliases: ['francia', 'france'], region: 'europe', country: 'FR', lat: 46.2, lng: 2.2 },
  { id: 'espana', name: 'España', aliases: ['espana', 'españa', 'spain'], region: 'europe', country: 'ES', lat: 40.4, lng: -3.7 },
  { id: 'reino-unido', name: 'Reino Unido', aliases: ['reino unido', 'inglaterra', 'uk', 'united kingdom'], region: 'europe', country: 'GB', lat: 55.4, lng: -3.4 },
  { id: 'alemania', name: 'Alemania', aliases: ['alemania', 'germany'], region: 'europe', country: 'DE', lat: 51.2, lng: 10.5 },
  { id: 'hungria', name: 'Hungría', aliases: ['hungria', 'hungría', 'hungary'], region: 'europe', country: 'HU', lat: 47.2, lng: 19.5 },
  { id: 'italia', name: 'Italia', aliases: ['italia', 'italy'], region: 'europe', country: 'IT', lat: 42.8, lng: 12.5 },
  { id: 'portugal', name: 'Portugal', aliases: ['portugal'], region: 'europe', country: 'PT', lat: 39.4, lng: -8.2 },
  { id: 'paises-bajos', name: 'Países Bajos', aliases: ['paises bajos', 'países bajos', 'netherlands', 'holanda'], region: 'europe', country: 'NL', lat: 52.1, lng: 5.3 },
  { id: 'ucrania', name: 'Ucrania', aliases: ['ucrania', 'ukraine'], region: 'europe', country: 'UA', lat: 48.4, lng: 31.2 },
  { id: 'iran', name: 'Irán', aliases: ['iran', 'irán'], region: 'asia', country: 'IR', lat: 32.4, lng: 53.7 },
  { id: 'china', name: 'China', aliases: ['china'], region: 'asia', country: 'CN', lat: 35.9, lng: 104.2 },
  { id: 'japon', name: 'Japón', aliases: ['japon', 'japón', 'japan'], region: 'asia', country: 'JP', lat: 36.2, lng: 138.3 },
  { id: 'india', name: 'India', aliases: ['india'], region: 'asia', country: 'IN', lat: 20.6, lng: 78.9 },
  { id: 'israel', name: 'Israel', aliases: ['israel'], region: 'asia', country: 'IL', lat: 31, lng: 35 },
];

const TOURNAMENT_ENTITIES = [
  {
    id: 'copa-libertadores',
    name: 'Copa Libertadores',
    aliases: ['copa libertadores', 'conmebol libertadores', 'libertadores'],
    region: 'latam',
    country: null,
    lat: -15,
    lng: -60,
    granularity: 'competition',
    render: 'country-fill',
    confidence: 0.9,
    allowedRegions: ['latam'],
  },
  {
    id: 'roland-garros',
    name: 'Roland Garros',
    aliases: ['roland garros', 'french open', 'abierto de francia'],
    region: 'europe',
    country: 'FR',
    lat: 48.847,
    lng: 2.249,
    granularity: 'competition',
    render: 'country-fill',
    confidence: 0.9,
    allowedRegions: ['europe'],
  },
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesEntity(text, entity) {
  const haystack = ` ${text} `;
  return entity.aliases.some(alias => {
    const needle = normalizeText(alias);
    return needle && haystack.includes(` ${needle} `);
  });
}

function toLocation(entity, granularity) {
  const resolvedGranularity = granularity || entity.granularity;
  return {
    id: entity.id,
    name: entity.name,
    region: entity.region,
    country: entity.country,
    subdivisionId: entity.subdivisionId || null,
    subdivisionName: entity.subdivisionName || null,
    granularity: resolvedGranularity,
    render: entity.render || (resolvedGranularity === 'city' ? 'point' : 'country-fill'),
    lat: entity.lat,
    lng: entity.lng,
    confidence: entity.confidence || (resolvedGranularity === 'city' ? 0.92 : 0.82),
  };
}

function findCountryEntity(countryName) {
  const normalized = normalizeText(countryName);
  if (!normalized) return null;
  return COUNTRY_ENTITIES.find(entity => (
    normalizeText(entity.name) === normalized
    || (entity.aliases || []).some(alias => normalizeText(alias) === normalized)
  )) || null;
}

function findCountryEntityByCode(countryCode) {
  const code = String(countryCode || '').toUpperCase();
  if (!code) return null;
  return COUNTRY_ENTITIES.find(entity => String(entity.country || '').toUpperCase() === code) || null;
}

export function normalizeGeoLocationToCountry(location = {}) {
  const countryEntity = findCountryEntityByCode(location.country);
  return countryEntity ? toLocation(countryEntity, 'country') : location;
}

export function extractNewsLocations(item = {}) {
  const text = normalizeText(`${item.title || ''} ${item.summary || ''}`);
  const seen = new Set();
  const locations = [];
  const tournamentRegions = new Set();

  for (const entity of TOURNAMENT_ENTITIES) {
    if (!matchesEntity(text, entity)) continue;
    seen.add(entity.id);
    locations.push(toLocation(entity));
    for (const region of entity.allowedRegions || [entity.region]) {
      tournamentRegions.add(region);
    }
  }

  const shouldKeepGenericLocation = location => (
    tournamentRegions.size === 0 || tournamentRegions.has(location.region)
  );

  for (const entity of CITY_ENTITIES) {
    if (!matchesEntity(text, entity)) continue;
    if (!shouldKeepGenericLocation(entity)) continue;
    seen.add(entity.id);
    locations.push(toLocation(entity, 'city'));
  }

  for (const entity of COUNTRY_ENTITIES) {
    if (!matchesEntity(text, entity) || seen.has(entity.id)) continue;
    if (!shouldKeepGenericLocation(entity)) continue;
    locations.push(toLocation(entity, 'country'));
  }

  return locations.slice(0, 4);
}

export function enrichNewsItemsWithGeo(items = []) {
  return (items || []).map(item => ({
    ...item,
    geoLocations: Array.isArray(item.geoLocations) ? item.geoLocations : extractNewsLocations(item),
  }));
}

export function getNewsGeoRegions() {
  return NEWS_GEO_REGIONS;
}

export function filterGeoItems(items = [], region = 'all') {
  const key = String(region || 'all');
  if (key === 'all') return items || [];
  return (items || []).filter(item =>
    (item.geoLocations || []).some(loc => loc.region === key)
  );
}

export function summarizeGeoLocations(items = [], markets = []) {
  const counts = Object.fromEntries(NEWS_GEO_REGIONS.map(region => [region.key, 0]));
  for (const item of items || []) {
    counts.all += 1;
    const itemRegions = itemRegionsFromLocations(item.geoLocations || []);
    for (const region of itemRegions) counts[region] = (counts[region] || 0) + 1;
  }
  for (const market of markets || []) {
    const marketRegions = itemRegionsFromLocations(extractMarketLocations(market));
    if (marketRegions.size === 0) continue;
    counts.all += 1;
    for (const region of marketRegions) counts[region] = (counts[region] || 0) + 1;
  }
  return NEWS_GEO_REGIONS.map(region => ({ ...region, count: counts[region.key] || 0 }));
}

function normalizedTags(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map(v => normalizeText(v).replace(/\s+/g, '-'));
}

function marketTagSet(market = {}) {
  return new Set([
    ...normalizedTags(market.geoTags ?? market.geo_tags),
    ...normalizedTags(market.categoryTags ?? market.category_tags),
    normalizeText(market.category).replace(/\s+/g, '-'),
    normalizeText(market.league).replace(/\s+/g, '-'),
    normalizeText(market.sport).replace(/\s+/g, '-'),
  ].filter(Boolean));
}

function parseMaybeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function marketTournamentRegion(tags) {
  if (['copa-libertadores', 'conmebol-libertadores', 'libertadores'].some(t => tags.has(t))) return 'latam';
  if (['roland-garros', 'french-open', 'abierto-de-francia'].some(t => tags.has(t))) return 'europe';
  return null;
}

const MARKET_HOME_COUNTRY = new Map(Object.entries({
  'alianza-lima': 'Perú',
  libertad: 'Paraguay',
  'club-libertad': 'Paraguay',
  'cerro-porteno': 'Paraguay',
  olimpia: 'Paraguay',
  'universidad-central': 'Venezuela',
  'universidad-central-de-venezuela': 'Venezuela',
  'deportivo-tachira': 'Venezuela',
  caracas: 'Venezuela',
  monagas: 'Venezuela',
  independiente: 'Ecuador',
  'independiente-del-valle': 'Ecuador',
  rosario: 'Argentina',
  'rosario-central': 'Argentina',
  'boca-juniors': 'Argentina',
  boca: 'Argentina',
  'river-plate': 'Argentina',
  'racing-club': 'Argentina',
  estudiantes: 'Argentina',
  'estudiantes-de-la-plata': 'Argentina',
  'san-lorenzo': 'Argentina',
  velez: 'Argentina',
  'velez-sarsfield': 'Argentina',
  talleres: 'Argentina',
  lanus: 'Argentina',
  huracan: 'Argentina',
  'argentinos-juniors': 'Argentina',
  bolivar: 'Bolivia',
  'club-bolivar': 'Bolivia',
  'the-strongest': 'Bolivia',
  rivadavia: 'Argentina',
  'independiente-rivadavia': 'Argentina',
  cruzeiro: 'Brasil',
  flamengo: 'Brasil',
  palmeiras: 'Brasil',
  'sao-paulo': 'Brasil',
  corinthians: 'Brasil',
  fluminense: 'Brasil',
  botafogo: 'Brasil',
  'atletico-mineiro': 'Brasil',
  internacional: 'Brasil',
  gremio: 'Brasil',
  santos: 'Brasil',
  fortaleza: 'Brasil',
  bahia: 'Brasil',
  'barcelona-sc': 'Ecuador',
  'ldu-quito': 'Ecuador',
  emelec: 'Ecuador',
  'atletico-nacional': 'Colombia',
  millonarios: 'Colombia',
  'america-de-cali': 'Colombia',
  'independiente-santa-fe': 'Colombia',
  'deportivo-cali': 'Colombia',
  junior: 'Colombia',
  'junior-fc': 'Colombia',
  'once-caldas': 'Colombia',
  'deportes-tolima': 'Colombia',
  'colo-colo': 'Chile',
  'universidad-de-chile': 'Chile',
  'universidad-catolica': 'Chile',
  palestino: 'Chile',
  penarol: 'Uruguay',
  'club-nacional': 'Uruguay',
  nacional: 'Uruguay',
  universitario: 'Perú',
  'sporting-cristal': 'Perú',
  melgar: 'Perú',
}));

function firstTeamOutcome(market = {}) {
  const cfg = market.resolverConfig || market.resolver_config || {};
  const sourceData = market.sourceData || market.source_data || {};
  return cfg.homeName
    || sourceData?.home?.name
    || sourceData?.homeName
    || market.homeName
    || market.home?.name
    || (Array.isArray(market.outcomes) ? market.outcomes[0] : null);
}

function countryForMarketHomeTeam(market = {}) {
  const homeName = firstTeamOutcome(market);
  const sport = market.sport || market.league;
  const team = findTeamByName(sport, homeName) || findTeamByName(market.league, homeName);
  if (team?.country) return team.country;

  const normalized = normalizeText(homeName).replace(/\s+/g, '-');
  return MARKET_HOME_COUNTRY.get(normalized) || null;
}

function marketSourceData(market = {}) {
  return parseMaybeJson(
    market.sourceData ?? market.source_data ?? market.pending_source_data ?? market.protocol_source_data,
    {},
  );
}

function marketResolverConfig(market = {}) {
  return parseMaybeJson(market.resolverConfig ?? market.resolver_config, {});
}

function venueTextForMarket(market = {}) {
  const sourceData = marketSourceData(market);
  const resolverConfig = marketResolverConfig(market);
  const candidates = [
    market.venue,
    sourceData.venue,
    sourceData.venue?.fullName,
    sourceData.stadium,
    sourceData.location,
    resolverConfig.venue,
    resolverConfig.venueName,
  ];
  return candidates
    .filter(Boolean)
    .map(value => typeof value === 'object' ? value.fullName || value.name || '' : String(value))
    .join(' ');
}

function isKnownChampionsBudapestFinal(market = {}, tags = marketTagSet(market)) {
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  const text = normalizeText([
    market.question,
    market.title,
    market.name,
    market.league,
    marketResolverConfig(market).leaguePath,
    ...outcomes,
  ].filter(Boolean).join(' '));
  const hasPsg = text.includes('psg') || text.includes('paris saint germain');
  const hasArsenal = text.includes('arsenal');
  const isChampions = tags.has('uefa-cl') || text.includes('uefa cl') || text.includes('champions league');
  return hasPsg && hasArsenal && isChampions;
}

function venueLocationForMarket(market = {}, tags = marketTagSet(market)) {
  const venueText = normalizeText(venueTextForMarket(market));
  if (venueText) {
    for (const entity of CITY_ENTITIES) {
      if (matchesEntity(venueText, entity)) return toLocation(entity, 'city');
    }
    for (const entity of COUNTRY_ENTITIES) {
      if (matchesEntity(venueText, entity)) return toLocation(entity, 'country');
    }
  }
  if (isKnownChampionsBudapestFinal(market, tags)) {
    return toLocation(CITY_ENTITIES.find(entity => entity.id === 'budapest'), 'city');
  }
  return null;
}

function tournamentLocationForMarket(market = {}, tags = marketTagSet(market)) {
  const text = normalizeText(`${market.question || ''} ${market.title || ''} ${market.name || ''} ${market.league || ''}`);
  for (const entity of TOURNAMENT_ENTITIES) {
    const tagMatches = normalizedTags(entity.aliases).some(tag => tags.has(tag));
    if (tagMatches || matchesEntity(text, entity)) return toLocation(entity);
  }
  return null;
}

export function extractMarketLocations(market = {}) {
  if (Array.isArray(market.geoLocations) && market.geoLocations.length > 0) {
    return market.geoLocations;
  }

  const tags = marketTagSet(market);
  const venueLocation = venueLocationForMarket(market, tags);
  if (venueLocation) return [venueLocation];

  const countryName = countryForMarketHomeTeam(market);
  const countryEntity = findCountryEntity(countryName);
  if (countryEntity) return [toLocation(countryEntity, 'country')];

  const tournament = tournamentLocationForMarket(market, tags);
  if (tournament) return [tournament];

  if (tags.has('mexico') || tags.has('liga-mx') || tags.has('lmb') || tags.has('lmp')) {
    return [toLocation(findCountryEntity('México'), 'country')];
  }
  if (['nba', 'nfl', 'mlb', 'mls'].some(tag => tags.has(tag))) {
    return [toLocation(findCountryEntity('Estados Unidos'), 'country')];
  }
  if (tags.has('asia')) {
    return [toLocation({ id: 'asia-region', name: 'Asia', region: 'asia', country: null, lat: 35, lng: 76, granularity: 'region', render: 'country-fill', confidence: 0.65 })];
  }

  const tournamentRegion = marketTournamentRegion(tags);
  if (tournamentRegion === 'latam') return [toLocation(TOURNAMENT_ENTITIES[0])];
  if (tournamentRegion === 'europe') return [toLocation(findCountryEntity('Francia'), 'country')];

  return [];
}

function itemRegionsFromLocations(locations = []) {
  return new Set((locations || []).map(loc => loc.region).filter(Boolean));
}

function marketMatchesSelectedLocation(market, locationId) {
  if (!locationId) return true;
  return extractMarketLocations(market).some(location => {
    const countryLocation = normalizeGeoLocationToCountry(location);
    return location.id === locationId || countryLocation.id === locationId;
  });
}

export function marketMatchesGeoRegion(market = {}, region = 'all') {
  const key = String(region || 'all');
  if (key === 'all') return true;

  const locations = extractMarketLocations(market);
  if (locations.length > 0) return locations.some(location => location.region === key);

  const tags = marketTagSet(market);

  const tournamentRegion = marketTournamentRegion(tags);
  if (tournamentRegion) return key === tournamentRegion;

  if (key === 'mexico') return tags.has('mexico') || ['liga-mx', 'lmb', 'lmp'].some(t => tags.has(t));
  if (key === 'latam') return tags.has('latam') || tags.has('copa-libertadores');
  if (key === 'us-canada') return ['nba', 'nfl', 'mlb', 'mls'].some(t => tags.has(t));
  if (key === 'europe') return ['uefa-cl', 'uefa-europa-league', 'uefa-conference-league', 'premier-league', 'la-liga', 'serie-a', 'bundesliga'].some(t => tags.has(t));
  if (key === 'asia') return tags.has('asia');
  return false;
}

export function filterGeoMarkets(markets = [], region = 'all', locationId = null) {
  return (markets || []).filter(market => (
    marketMatchesGeoRegion(market, region)
    && marketMatchesSelectedLocation(market, locationId)
  ));
}
