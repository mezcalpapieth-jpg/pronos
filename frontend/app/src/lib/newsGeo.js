import { findTeamByName } from './teamProfiles.js';
import { normalizeGeoLocationToSubdivision } from './newsGeoSubdivisions.js';

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
  { id: 'australia', name: 'Australia', aliases: ['australia'], region: 'asia', country: 'AU', lat: -25.3, lng: 133.8 },
  { id: 'francia', name: 'Francia', aliases: ['francia', 'france'], region: 'europe', country: 'FR', lat: 46.2, lng: 2.2 },
  { id: 'espana', name: 'España', aliases: ['espana', 'españa', 'spain'], region: 'europe', country: 'ES', lat: 40.4, lng: -3.7 },
  { id: 'reino-unido', name: 'Reino Unido', aliases: ['reino unido', 'inglaterra', 'uk', 'united kingdom'], region: 'europe', country: 'GB', lat: 55.4, lng: -3.4 },
  { id: 'alemania', name: 'Alemania', aliases: ['alemania', 'germany'], region: 'europe', country: 'DE', lat: 51.2, lng: 10.5 },
  { id: 'hungria', name: 'Hungría', aliases: ['hungria', 'hungría', 'hungary'], region: 'europe', country: 'HU', lat: 47.2, lng: 19.5 },
  { id: 'italia', name: 'Italia', aliases: ['italia', 'italy'], region: 'europe', country: 'IT', lat: 42.8, lng: 12.5 },
  { id: 'monaco', name: 'Mónaco', aliases: ['monaco', 'mónaco'], region: 'europe', country: 'MC', lat: 43.7, lng: 7.4 },
  { id: 'belgica', name: 'Bélgica', aliases: ['belgica', 'bélgica', 'belgium'], region: 'europe', country: 'BE', lat: 50.5, lng: 4.5 },
  { id: 'austria', name: 'Austria', aliases: ['austria'], region: 'europe', country: 'AT', lat: 47.6, lng: 14.1 },
  { id: 'suiza', name: 'Suiza', aliases: ['suiza', 'switzerland'], region: 'europe', country: 'CH', lat: 46.8, lng: 8.2 },
  { id: 'portugal', name: 'Portugal', aliases: ['portugal'], region: 'europe', country: 'PT', lat: 39.4, lng: -8.2 },
  { id: 'paises-bajos', name: 'Países Bajos', aliases: ['paises bajos', 'países bajos', 'netherlands', 'holanda'], region: 'europe', country: 'NL', lat: 52.1, lng: 5.3 },
  { id: 'ucrania', name: 'Ucrania', aliases: ['ucrania', 'ukraine'], region: 'europe', country: 'UA', lat: 48.4, lng: 31.2 },
  { id: 'azerbaiyan', name: 'Azerbaiyán', aliases: ['azerbaiyan', 'azerbaiyán', 'azerbaijan'], region: 'asia', country: 'AZ', lat: 40.1, lng: 47.6 },
  { id: 'arabia-saudita', name: 'Arabia Saudita', aliases: ['arabia saudita', 'saudi arabia'], region: 'asia', country: 'SA', lat: 23.9, lng: 45.1 },
  { id: 'barein', name: 'Baréin', aliases: ['barein', 'baréin', 'bahrain'], region: 'asia', country: 'BH', lat: 26.1, lng: 50.6 },
  { id: 'catar', name: 'Catar', aliases: ['catar', 'qatar'], region: 'asia', country: 'QA', lat: 25.4, lng: 51.2 },
  { id: 'emiratos-arabes-unidos', name: 'Emiratos Árabes Unidos', aliases: ['emiratos arabes unidos', 'emiratos árabes unidos', 'uae', 'united arab emirates'], region: 'asia', country: 'AE', lat: 24.4, lng: 54.3 },
  { id: 'singapur', name: 'Singapur', aliases: ['singapur', 'singapore'], region: 'asia', country: 'SG', lat: 1.35, lng: 103.8 },
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

function normalizeCountryCode(country) {
  const raw = String(country || '').trim();
  const upper = raw.toUpperCase();
  const normalized = normalizeText(raw);
  if (!normalized) return null;
  if (['US', 'USA'].includes(upper) || ['united states', 'estados unidos', 'eua', 'eeuu'].includes(normalized)) return 'US';
  if (['MX', 'MEX'].includes(upper) || ['mexico', 'méxico'].includes(normalized)) return 'MX';
  if (['CA', 'CAN'].includes(upper) || ['canada', 'canadá'].includes(normalized)) return 'CA';
  const countryEntity = findCountryEntity(raw);
  if (countryEntity?.country) return countryEntity.country;
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return upper || null;
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
  const cfg = marketResolverConfig(market);
  const sourceData = marketSourceData(market);
  return cfg.homeName
    || sourceData?.home?.name
    || sourceData?.homeName
    || market.homeName
    || market.home?.name
    || homeNameFromQuestion(market)
    || (Array.isArray(market.outcomes) ? market.outcomes[0] : null);
}

function cleanTeamNameFragment(value) {
  return String(value || '')
    .replace(/[¿?]/g, '')
    .replace(/^\s*(quien|quién)\s+gana\s+/i, '')
    .replace(/^\s*ganador\s*:\s*/i, '')
    .trim();
}

function homeNameFromQuestion(market = {}) {
  const text = String(market.question || market.title || market.name || '').trim();
  if (!text) return null;

  const atMatch = text.match(/(.+?)\s+@\s+(.+)$/);
  if (atMatch) return cleanTeamNameFragment(atMatch[2]);

  const vsMatch = text.match(/(.+?)\s+(?:vs\.?|v\.?|contra)\s+(.+)$/i);
  if (vsMatch) return cleanTeamNameFragment(vsMatch[1]);

  return null;
}

function findHomeTeamProfile(market = {}) {
  const homeName = firstTeamOutcome(market);
  if (!homeName) return null;
  const contexts = [market.league, market.sport].filter(Boolean);
  for (const context of contexts) {
    const team = findTeamByName(context, homeName);
    if (team) return team;
  }
  return null;
}

function cityLocationForText(text, countryCode = null) {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const code = normalizeCountryCode(countryCode);
  for (const entity of CITY_ENTITIES) {
    if (code && entity.country !== code) continue;
    if (matchesEntity(normalized, entity)) return toLocation(entity, 'city');
  }
  return null;
}

function homeLocationForTeam(team) {
  const homeLocation = team?.homeLocation;
  if (homeLocation) {
    const country = normalizeCountryCode(homeLocation.country);
    const subdivision = normalizeGeoLocationToSubdivision({
      country,
      subdivisionName: homeLocation.subdivisionName,
      name: homeLocation.subdivisionName || homeLocation.city,
    });
    if (subdivision) return subdivision;

    const city = cityLocationForText(homeLocation.city, country);
    if (city) return city;

    const countryEntity = findCountryEntityByCode(country) || findCountryEntity(homeLocation.country);
    if (countryEntity) return toLocation(countryEntity, 'country');
  }

  const countryEntity = findCountryEntity(team?.country);
  return countryEntity ? toLocation(countryEntity, 'country') : null;
}

function homeTeamLocationForMarket(market = {}) {
  const team = findHomeTeamProfile(market);
  if (team) return homeLocationForTeam(team);

  const homeName = firstTeamOutcome(market);
  const countryEntity = findCountryEntity(homeName);
  return countryEntity ? toLocation(countryEntity, 'country') : null;
}

function countryForMarketHomeTeam(market = {}) {
  const homeName = firstTeamOutcome(market);
  const sport = market.sport || market.league;
  const team = findTeamByName(sport, homeName) || findTeamByName(market.league, homeName);
  if (team?.country) return team.country;

  const countryEntity = findCountryEntity(homeName);
  if (countryEntity) return countryEntity.name;

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
    .map(value => {
      if (typeof value !== 'object') return String(value);
      const address = value.address && typeof value.address === 'object' ? value.address : {};
      return [
        value.fullName,
        value.name,
        value.city || address.city,
        value.state || address.state,
        value.country || address.country,
      ].filter(Boolean).join(' ');
    })
    .join(' ');
}

function structuredVenueCandidates(market = {}) {
  const sourceData = marketSourceData(market);
  const resolverConfig = marketResolverConfig(market);
  return [
    sourceData.venue,
    resolverConfig.venue,
    market.venue,
  ].filter(value => value && typeof value === 'object');
}

function locationFromStructuredVenue(venue) {
  const address = venue.address && typeof venue.address === 'object' ? venue.address : {};
  const country = normalizeCountryCode(
    venue.country || address.country || venue.countryCode || address.countryCode,
  );
  const subdivisionName = venue.subdivisionName
    || venue.state
    || address.state
    || venue.region
    || address.region;
  const city = venue.city || address.city || null;
  const venueName = venue.fullName || venue.name || null;

  const subdivision = normalizeGeoLocationToSubdivision({
    country,
    subdivisionName,
    name: subdivisionName || city,
  });
  if (subdivision) return subdivision;

  const cityLocation = cityLocationForText([venueName, city, subdivisionName].filter(Boolean).join(' '), country);
  if (cityLocation) return cityLocation;

  const lat = venue.latitude ?? venue.lat ?? venue.geoCoordinates?.latitude ?? venue.geoCoordinates?.lat ?? null;
  const lng = venue.longitude ?? venue.lng ?? venue.geoCoordinates?.longitude ?? venue.geoCoordinates?.lng ?? null;
  const countryEntity = findCountryEntityByCode(country) || findCountryEntity(venue.country || address.country);
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && countryEntity) {
    return {
      id: `venue-${normalizeText(venueName || city || countryEntity.name).replace(/\s+/g, '-')}`,
      name: venueName || city || countryEntity.name,
      region: countryEntity.region,
      country: countryEntity.country,
      subdivisionId: null,
      subdivisionName: subdivisionName || null,
      granularity: 'city',
      render: 'point',
      lat: Number(lat),
      lng: Number(lng),
      confidence: 0.95,
    };
  }

  return countryEntity ? toLocation(countryEntity, 'country') : null;
}

function venue(name, { city = null, state = null, country, lat = null, lng = null } = {}) {
  return {
    name,
    fullName: name,
    city,
    state,
    country,
    latitude: lat,
    longitude: lng,
  };
}

const KNOWN_EVENT_LOCATION_RULES = [
  // Formula 1 race-name fallbacks.
  { sports: ['f1'], patterns: [/bahrain/i], venue: venue('Bahrain International Circuit', { city: 'Sakhir', country: 'Bahrain', lat: 26.0325, lng: 50.5106 }) },
  { sports: ['f1'], patterns: [/saudi|jeddah/i], venue: venue('Jeddah Corniche Circuit', { city: 'Jeddah', country: 'Saudi Arabia', lat: 21.6319, lng: 39.1044 }) },
  { sports: ['f1'], patterns: [/australian|melbourne/i], venue: venue('Albert Park Circuit', { city: 'Melbourne', country: 'Australia', lat: -37.8497, lng: 144.968 }) },
  { sports: ['f1'], patterns: [/chinese|shanghai/i], venue: venue('Shanghai International Circuit', { city: 'Shanghai', country: 'China', lat: 31.3389, lng: 121.22 }) },
  { sports: ['f1'], patterns: [/miami/i], venue: venue('Miami International Autodrome', { city: 'Miami Gardens', state: 'Florida', country: 'US', lat: 25.958, lng: -80.2389 }) },
  { sports: ['f1'], patterns: [/emilia romagna|imola/i], venue: venue('Autodromo Enzo e Dino Ferrari', { city: 'Imola', country: 'Italy', lat: 44.3439, lng: 11.7167 }) },
  { sports: ['f1'], patterns: [/monaco|monte carlo/i], venue: venue('Circuit de Monaco', { city: 'Monte Carlo', country: 'Monaco', lat: 43.7347, lng: 7.4206 }) },
  { sports: ['f1'], patterns: [/spanish|barcelona/i], venue: venue('Circuit de Barcelona-Catalunya', { city: 'Barcelona', country: 'Spain', lat: 41.57, lng: 2.261 }) },
  { sports: ['f1'], patterns: [/canadian|montreal|montr[eé]al/i], venue: venue('Circuit Gilles Villeneuve', { city: 'Montreal', country: 'Canada', lat: 45.5001, lng: -73.5228 }) },
  { sports: ['f1'], patterns: [/austrian|spielberg/i], venue: venue('Red Bull Ring', { city: 'Spielberg', country: 'Austria', lat: 47.2197, lng: 14.7647 }) },
  { sports: ['f1'], patterns: [/british|silverstone/i], venue: venue('Silverstone Circuit', { city: 'Silverstone', country: 'United Kingdom', lat: 52.0786, lng: -1.0169 }) },
  { sports: ['f1'], patterns: [/belgian|spa[- ]francorchamps/i], venue: venue('Circuit de Spa-Francorchamps', { city: 'Spa', country: 'Belgium', lat: 50.4372, lng: 5.9714 }) },
  { sports: ['f1'], patterns: [/hungarian|hungaroring/i], venue: venue('Hungaroring', { city: 'Mogyorod', country: 'Hungary', lat: 47.5789, lng: 19.2486 }) },
  { sports: ['f1'], patterns: [/dutch|zandvoort|netherlands/i], venue: venue('Circuit Zandvoort', { city: 'Zandvoort', country: 'Netherlands', lat: 52.3888, lng: 4.5409 }) },
  { sports: ['f1'], patterns: [/italian|monza/i], venue: venue('Autodromo Nazionale Monza', { city: 'Monza', country: 'Italy', lat: 45.6156, lng: 9.2811 }) },
  { sports: ['f1'], patterns: [/azerbaijan|baku/i], venue: venue('Baku City Circuit', { city: 'Baku', country: 'Azerbaijan', lat: 40.3725, lng: 49.8533 }) },
  { sports: ['f1'], patterns: [/singapore/i], venue: venue('Marina Bay Street Circuit', { city: 'Singapore', country: 'Singapore', lat: 1.2914, lng: 103.864 }) },
  { sports: ['f1'], patterns: [/united states|austin|circuit of the americas/i], venue: venue('Circuit of the Americas', { city: 'Austin', state: 'Texas', country: 'US', lat: 30.1328, lng: -97.6411 }) },
  { sports: ['f1'], patterns: [/mexican|mexico city|ciudad de mexico/i], venue: venue('Autodromo Hermanos Rodriguez', { city: 'Ciudad de Mexico', state: 'Ciudad de Mexico', country: 'MX', lat: 19.4042, lng: -99.0907 }) },
  { sports: ['f1'], patterns: [/s[aã]o paulo|brazilian|interlagos/i], venue: venue('Interlagos', { city: 'Sao Paulo', country: 'Brazil', lat: -23.7036, lng: -46.6997 }) },
  { sports: ['f1'], patterns: [/las vegas/i], venue: venue('Las Vegas Strip Circuit', { city: 'Las Vegas', state: 'Nevada', country: 'US', lat: 36.1147, lng: -115.1728 }) },
  { sports: ['f1'], patterns: [/qatar|lusail/i], venue: venue('Lusail International Circuit', { city: 'Lusail', country: 'Qatar', lat: 25.49, lng: 51.4542 }) },
  { sports: ['f1'], patterns: [/abu dhabi|yas marina/i], venue: venue('Yas Marina Circuit', { city: 'Abu Dhabi', country: 'United Arab Emirates', lat: 24.4672, lng: 54.6031 }) },

  // Tennis tournament-name fallbacks.
  { sports: ['tennis'], patterns: [/australian open/i], venue: venue('Melbourne Park', { city: 'Melbourne', country: 'Australia', lat: -37.8216, lng: 144.9785 }) },
  { sports: ['tennis'], patterns: [/roland garros|french open/i], venue: venue('Roland Garros', { city: 'Paris', country: 'France', lat: 48.847, lng: 2.249 }) },
  { sports: ['tennis'], patterns: [/wimbledon/i], venue: venue('All England Club', { city: 'London', country: 'United Kingdom', lat: 51.4337, lng: -0.214 }) },
  { sports: ['tennis'], patterns: [/\bus open\b|u\.s\. open/i], venue: venue('USTA Billie Jean King National Tennis Center', { city: 'New York', state: 'New York', country: 'US', lat: 40.7499, lng: -73.847 }) },
  { sports: ['tennis'], patterns: [/bnp paribas|indian wells/i], venue: venue('Indian Wells Tennis Garden', { city: 'Indian Wells', state: 'California', country: 'US', lat: 33.723, lng: -116.305 }) },
  { sports: ['tennis'], patterns: [/miami open/i], venue: venue('Miami Open', { city: 'Miami Gardens', state: 'Florida', country: 'US', lat: 25.958, lng: -80.2389 }) },
  { sports: ['tennis'], patterns: [/monte[- ]?carlo/i], venue: venue('Monte-Carlo Masters', { city: 'Monte Carlo', country: 'Monaco', lat: 43.751, lng: 7.439 }) },
  { sports: ['tennis'], patterns: [/madrid open|mutua madrid/i], venue: venue('Madrid Open', { city: 'Madrid', country: 'Spain', lat: 40.3688, lng: -3.6844 }) },
  { sports: ['tennis'], patterns: [/internazionali|italian open|rome/i], venue: venue('Italian Open', { city: 'Rome', country: 'Italy', lat: 41.928, lng: 12.456 }) },
  { sports: ['tennis'], patterns: [/national bank open|canadian open|rogers cup/i], venue: venue('National Bank Open', { city: 'Toronto', country: 'Canada', lat: 43.7719, lng: -79.5124 }) },
  { sports: ['tennis'], patterns: [/cincinnati|western & southern/i], venue: venue('Cincinnati Open', { city: 'Cincinnati', state: 'Ohio', country: 'US', lat: 39.3538, lng: -84.312 }) },
  { sports: ['tennis'], patterns: [/shanghai/i], venue: venue('Shanghai Masters', { city: 'Shanghai', country: 'China', lat: 31.0422, lng: 121.355 }) },
  { sports: ['tennis'], patterns: [/paris masters|rolex paris/i], venue: venue('Paris Masters', { city: 'Paris', country: 'France', lat: 48.8386, lng: 2.3786 }) },
  { sports: ['tennis'], patterns: [/abn amro|rotterdam/i], venue: venue('Rotterdam Open', { city: 'Rotterdam', country: 'Netherlands', lat: 51.8827, lng: 4.4882 }) },
  { sports: ['tennis'], patterns: [/abierto mexicano|acapulco/i], venue: venue('Abierto Mexicano', { city: 'Acapulco', state: 'Guerrero', country: 'MX', lat: 16.789, lng: -99.823 }) },
  { sports: ['tennis'], patterns: [/dubai duty free|dubai/i], venue: venue('Dubai Tennis Championships', { city: 'Dubai', country: 'United Arab Emirates', lat: 25.242, lng: 55.342 }) },
  { sports: ['tennis'], patterns: [/qatar|doha/i], venue: venue('Qatar Open', { city: 'Doha', country: 'Qatar', lat: 25.313, lng: 51.514 }) },
  { sports: ['tennis'], patterns: [/rio open/i], venue: venue('Rio Open', { city: 'Rio de Janeiro', country: 'Brazil', lat: -22.973, lng: -43.218 }) },
  { sports: ['tennis'], patterns: [/barcelona open/i], venue: venue('Barcelona Open', { city: 'Barcelona', country: 'Spain', lat: 41.392, lng: 2.117 }) },
  { sports: ['tennis'], patterns: [/boss open|stuttgart/i], venue: venue('Boss Open', { city: 'Stuttgart', country: 'Germany', lat: 48.797, lng: 9.168 }) },
  { sports: ['tennis'], patterns: [/cinch championships|queen'?s club/i], venue: venue("Queen's Club", { city: 'London', country: 'United Kingdom', lat: 51.487, lng: -0.212 }) },
  { sports: ['tennis'], patterns: [/hamburg/i], venue: venue('Hamburg Open', { city: 'Hamburg', country: 'Germany', lat: 53.573, lng: 9.991 }) },
  { sports: ['tennis'], patterns: [/mubadala citi|citi open|washington/i], venue: venue('Citi Open', { city: 'Washington', state: 'District of Columbia', country: 'US', lat: 38.954, lng: -77.038 }) },
  { sports: ['tennis'], patterns: [/china open|beijing/i], venue: venue('China Open', { city: 'Beijing', country: 'China', lat: 40.02, lng: 116.373 }) },
  { sports: ['tennis'], patterns: [/japan open|tokyo|rakuten/i], venue: venue('Japan Open', { city: 'Tokyo', country: 'Japan', lat: 35.636, lng: 139.79 }) },
  { sports: ['tennis'], patterns: [/erste bank|vienna/i], venue: venue('Erste Bank Open', { city: 'Vienna', country: 'Austria', lat: 48.202, lng: 16.333 }) },
  { sports: ['tennis'], patterns: [/swiss indoors|basel/i], venue: venue('Swiss Indoors', { city: 'Basel', country: 'Switzerland', lat: 47.568, lng: 7.589 }) },
  { sports: ['tennis'], patterns: [/atp finals|nitto atp finals/i], venue: venue('ATP Finals', { city: 'Turin', country: 'Italy', lat: 45.041, lng: 7.65 }) },

  // Golf fallbacks when ESPN does not ship a tournament venue.
  { sports: ['golf'], patterns: [/masters/i], venue: venue('Augusta National Golf Club', { city: 'Augusta', state: 'Georgia', country: 'US', lat: 33.503, lng: -82.02 }) },
  { sports: ['golf'], patterns: [/\bthe open\b|open championship/i], venue: venue('The Open Championship', { country: 'United Kingdom' }) },
  { sports: ['golf'], patterns: [/\bu\.?s\.? open\b|us open/i], venue: venue('U.S. Open', { country: 'US' }) },
  { sports: ['golf'], patterns: [/pga championship/i], venue: venue('PGA Championship', { country: 'US' }) },
];

function knownEventLocationForMarket(market = {}, tags = marketTagSet(market)) {
  const sourceData = marketSourceData(market);
  const text = [
    market.question,
    market.title,
    market.name,
    market.league,
    sourceData.raceName,
    sourceData.circuitName,
    sourceData.tournamentName,
    sourceData.eventName,
  ].filter(Boolean).join(' ');
  if (!text) return null;
  for (const rule of KNOWN_EVENT_LOCATION_RULES) {
    if (Array.isArray(rule.sports) && !rule.sports.some(sport => tags.has(sport))) continue;
    if (rule.patterns.some(pattern => pattern.test(text))) {
      const location = locationFromStructuredVenue(rule.venue);
      if (location) return location;
    }
  }
  return null;
}

function countryFromFlagAlt(flag) {
  const cleaned = String(flag || '')
    .replace(/\bflag\b/ig, '')
    .replace(/\bbandera\b/ig, '')
    .replace(/\bde\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  return findCountryEntity(cleaned);
}

function combatNationalityLocations(market = {}) {
  const tags = marketTagSet(market);
  if (!tags.has('combate') && !tags.has('ufc') && !tags.has('boxing')) return [];
  const sourceData = marketSourceData(market);
  const fighters = Array.isArray(sourceData.fighters) ? sourceData.fighters : [];
  const seen = new Set();
  const locations = [];
  for (const fighter of fighters) {
    const countryEntity = countryFromFlagAlt(fighter?.flag || fighter?.country || fighter?.nationality);
    if (!countryEntity || seen.has(countryEntity.id)) continue;
    seen.add(countryEntity.id);
    locations.push(toLocation(countryEntity, 'country'));
  }
  return locations.slice(0, 2);
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
  for (const venue of structuredVenueCandidates(market)) {
    const location = locationFromStructuredVenue(venue);
    if (location) return location;
  }

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

  const knownEventLocation = knownEventLocationForMarket(market, tags);
  if (knownEventLocation) return [knownEventLocation];

  const nationalityLocations = combatNationalityLocations(market);
  if (nationalityLocations.length > 0) return nationalityLocations;

  const homeLocation = homeTeamLocationForMarket(market);
  if (homeLocation) return [homeLocation];

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
