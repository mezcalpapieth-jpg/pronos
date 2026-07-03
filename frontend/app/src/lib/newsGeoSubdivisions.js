import { ADMIN1_BOUNDARY_FEATURES } from './newsGeoAdmin1Boundaries.js';

const NORMALIZE_RE = /[\u0300-\u036f]/g;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(NORMALIZE_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function state(id, name, shortName, lat, lng, aliases = []) {
  const country = id.startsWith('mx-') ? 'MX' : 'US';
  return {
    id,
    name,
    shortName,
    country,
    region: country === 'MX' ? 'mexico' : 'us-canada',
    lat,
    lng,
    aliases: [name, shortName, ...aliases],
    subdivisionId: id,
    subdivisionName: name,
    granularity: 'state',
    render: 'state-marker',
  };
}

const MEXICO_STATES = [
  state('mx-aguascalientes', 'Aguascalientes', 'AGS', 21.88, -102.29),
  state('mx-baja-california', 'Baja California', 'BC', 30.84, -115.28),
  state('mx-baja-california-sur', 'Baja California Sur', 'BCS', 26.04, -111.67),
  state('mx-campeche', 'Campeche', 'CAMP', 19.83, -90.53),
  state('mx-chiapas', 'Chiapas', 'CHIS', 16.75, -93.12),
  state('mx-chihuahua', 'Chihuahua', 'CHIH', 28.63, -106.08),
  state('mx-ciudad-de-mexico', 'Ciudad de Mexico', 'CDMX', 19.43, -99.13, ['ciudad de mexico', 'mexico city', 'df', 'cdmx']),
  state('mx-coahuila', 'Coahuila', 'COAH', 27.06, -101.71, ['coahuila de zaragoza']),
  state('mx-colima', 'Colima', 'COL', 19.24, -103.72),
  state('mx-durango', 'Durango', 'DGO', 24.56, -104.66),
  state('mx-guanajuato', 'Guanajuato', 'GTO', 21.02, -101.26),
  state('mx-guerrero', 'Guerrero', 'GRO', 17.55, -99.50),
  state('mx-hidalgo', 'Hidalgo', 'HGO', 20.09, -98.76),
  { ...state('mx-jalisco', 'Jalisco', 'JAL', 20.66, -103.35, ['guadalajara']), name: 'Jalisco' },
  state('mx-estado-de-mexico', 'Estado de Mexico', 'MEX', 19.36, -99.66, ['edomex', 'estado de mexico']),
  state('mx-michoacan', 'Michoacan', 'MICH', 19.70, -101.19, ['michoacan de ocampo']),
  state('mx-morelos', 'Morelos', 'MOR', 18.68, -99.10),
  state('mx-nayarit', 'Nayarit', 'NAY', 21.75, -104.85),
  state('mx-nuevo-leon', 'Nuevo Leon', 'NL', 25.69, -100.32, ['nuevo leon', 'monterrey']),
  state('mx-oaxaca', 'Oaxaca', 'OAX', 17.07, -96.72),
  state('mx-puebla', 'Puebla', 'PUE', 19.04, -98.21),
  state('mx-queretaro', 'Queretaro', 'QRO', 20.59, -100.39, ['queretaro']),
  state('mx-quintana-roo', 'Quintana Roo', 'QROO', 19.18, -88.48, ['cancun']),
  state('mx-san-luis-potosi', 'San Luis Potosi', 'SLP', 22.16, -100.98),
  state('mx-sinaloa', 'Sinaloa', 'SIN', 24.81, -107.39),
  state('mx-sonora', 'Sonora', 'SON', 29.30, -110.33),
  state('mx-tabasco', 'Tabasco', 'TAB', 17.84, -92.62),
  state('mx-tamaulipas', 'Tamaulipas', 'TAMPS', 23.74, -99.15),
  state('mx-tlaxcala', 'Tlaxcala', 'TLAX', 19.32, -98.24),
  state('mx-veracruz', 'Veracruz', 'VER', 19.17, -96.13),
  state('mx-yucatan', 'Yucatan', 'YUC', 20.97, -89.59, ['merida']),
  state('mx-zacatecas', 'Zacatecas', 'ZAC', 22.77, -102.58),
];

const US_STATES = [
  state('us-alabama', 'Alabama', 'AL', 32.81, -86.79),
  state('us-alaska', 'Alaska', 'AK', 64.20, -149.49),
  state('us-arizona', 'Arizona', 'AZ', 34.05, -111.09),
  state('us-arkansas', 'Arkansas', 'AR', 35.20, -91.83),
  { ...state('us-california', 'California', 'CA', 36.78, -119.42, ['los angeles', 'san francisco']), name: 'California' },
  state('us-colorado', 'Colorado', 'CO', 39.55, -105.78),
  state('us-connecticut', 'Connecticut', 'CT', 41.60, -72.76),
  state('us-delaware', 'Delaware', 'DE', 39.16, -75.53),
  state('us-district-of-columbia', 'District of Columbia', 'DC', 38.91, -77.04, ['washington dc', 'washington']),
  state('us-florida', 'Florida', 'FL', 27.66, -81.52),
  state('us-georgia', 'Georgia', 'GA', 32.17, -82.90),
  state('us-hawaii', 'Hawaii', 'HI', 19.90, -155.58),
  state('us-idaho', 'Idaho', 'ID', 44.07, -114.74),
  state('us-illinois', 'Illinois', 'IL', 40.63, -89.40),
  state('us-indiana', 'Indiana', 'IN', 40.27, -86.13),
  state('us-iowa', 'Iowa', 'IA', 41.88, -93.10),
  state('us-kansas', 'Kansas', 'KS', 39.01, -98.48),
  state('us-kentucky', 'Kentucky', 'KY', 37.84, -84.27),
  state('us-louisiana', 'Louisiana', 'LA', 30.98, -91.96),
  state('us-maine', 'Maine', 'ME', 45.25, -69.45),
  state('us-maryland', 'Maryland', 'MD', 39.05, -76.64),
  state('us-massachusetts', 'Massachusetts', 'MA', 42.41, -71.38),
  state('us-michigan', 'Michigan', 'MI', 44.31, -85.60),
  state('us-minnesota', 'Minnesota', 'MN', 46.73, -94.69),
  state('us-mississippi', 'Mississippi', 'MS', 32.35, -89.40),
  state('us-missouri', 'Missouri', 'MO', 37.96, -91.83),
  state('us-montana', 'Montana', 'MT', 46.88, -110.36),
  state('us-nebraska', 'Nebraska', 'NE', 41.49, -99.90),
  state('us-nevada', 'Nevada', 'NV', 38.80, -116.42),
  state('us-new-hampshire', 'New Hampshire', 'NH', 43.19, -71.57),
  state('us-new-jersey', 'New Jersey', 'NJ', 40.06, -74.41),
  state('us-new-mexico', 'New Mexico', 'NM', 34.97, -105.03),
  state('us-new-york', 'New York', 'NY', 42.95, -75.53, ['nueva york', 'new york city']),
  state('us-north-carolina', 'North Carolina', 'NC', 35.76, -79.02),
  state('us-north-dakota', 'North Dakota', 'ND', 47.55, -101.00),
  state('us-ohio', 'Ohio', 'OH', 40.42, -82.91),
  state('us-oklahoma', 'Oklahoma', 'OK', 35.47, -97.52),
  state('us-oregon', 'Oregon', 'OR', 43.80, -120.55),
  state('us-pennsylvania', 'Pennsylvania', 'PA', 41.20, -77.19),
  state('us-rhode-island', 'Rhode Island', 'RI', 41.58, -71.48),
  state('us-south-carolina', 'South Carolina', 'SC', 33.84, -81.16),
  state('us-south-dakota', 'South Dakota', 'SD', 43.97, -99.90),
  state('us-tennessee', 'Tennessee', 'TN', 35.52, -86.58),
  state('us-texas', 'Texas', 'TX', 31.97, -99.90),
  state('us-utah', 'Utah', 'UT', 39.32, -111.09),
  state('us-vermont', 'Vermont', 'VT', 44.56, -72.58),
  state('us-virginia', 'Virginia', 'VA', 37.43, -78.66),
  state('us-washington', 'Washington', 'WA', 47.75, -120.74),
  state('us-west-virginia', 'West Virginia', 'WV', 38.60, -80.45),
  state('us-wisconsin', 'Wisconsin', 'WI', 43.78, -88.79),
  state('us-wyoming', 'Wyoming', 'WY', 43.08, -107.29),
];

export const SUBDIVISION_DRILL_COUNTRIES = {
  MX: {
    country: 'MX',
    countryLocationId: 'mexico',
    label: 'Estados de Mexico',
    center: { lat: 23.6, lng: -102.5 },
    globeAltitude: 0.78,
    states: MEXICO_STATES,
  },
  US: {
    country: 'US',
    countryLocationId: 'estados-unidos',
    label: 'Estados Unidos',
    center: { lat: 39.8, lng: -98.6 },
    globeAltitude: 1.02,
    states: US_STATES,
  },
};

const SUBDIVISION_BY_ID = new Map(
  Object.values(SUBDIVISION_DRILL_COUNTRIES)
    .flatMap(country => country.states)
    .map(subdivision => [subdivision.id, subdivision]),
);

const SUBDIVISION_BY_COUNTRY_AND_ALIAS = new Map();

for (const subdivision of SUBDIVISION_BY_ID.values()) {
  const aliases = [
    subdivision.id,
    subdivision.name,
    subdivision.shortName,
    ...(subdivision.aliases || []),
  ];
  for (const alias of aliases) {
    const normalized = normalizeText(alias);
    if (!normalized) continue;
    SUBDIVISION_BY_COUNTRY_AND_ALIAS.set(`${subdivision.country}:${normalized}`, subdivision);
  }
}

function toSubdivisionLocation(subdivision, extras = {}) {
  return {
    ...subdivision,
    count: extras.count ?? 0,
    newsCount: extras.newsCount ?? 0,
    marketCount: extras.marketCount ?? 0,
    signals: extras.signals ?? [],
  };
}

export function buildSubdivisionPolygonsForCountry(countryCode, subdivisionLocations = []) {
  const country = getSubdivisionCountry(countryCode);
  if (!country) return [];

  const enrichedById = new Map((subdivisionLocations || []).map(location => [location.id, location]));
  const statesById = new Map(country.states.map(subdivision => {
    const enriched = enrichedById.get(subdivision.id) || {};
    return [subdivision.id, {
      ...subdivision,
      ...enriched,
      lat: Number(enriched.lat ?? subdivision.lat),
      lng: Number(enriched.lng ?? subdivision.lng),
      count: Math.max(0, Number(enriched.count) || 0),
      newsCount: Math.max(0, Number(enriched.newsCount) || 0),
      marketCount: Math.max(0, Number(enriched.marketCount) || 0),
      signals: enriched.signals || [],
    }];
  }));

  return ADMIN1_BOUNDARY_FEATURES
    .filter(feature => feature?.properties?.country === country.country)
    .map(feature => {
      const site = statesById.get(feature.properties.locationId);
      if (!site) return null;
      return {
        ...feature,
        id: site.id,
        properties: {
          ...feature.properties,
          id: site.id,
          locationId: site.id,
          name: site.name,
          shortName: site.shortName,
          country: site.country,
          region: site.region,
          subdivisionId: site.id,
          subdivisionName: site.name,
          granularity: 'state',
          count: site.count,
          newsCount: site.newsCount,
          marketCount: site.marketCount,
          signals: site.signals,
        },
      };
    })
    .filter(Boolean);
}

export function getSubdivisionCountry(countryCode) {
  const code = String(countryCode || '').toUpperCase();
  return SUBDIVISION_DRILL_COUNTRIES[code] || null;
}

export function getSubdivisionsForCountry(countryCode) {
  return getSubdivisionCountry(countryCode)?.states || [];
}

export function findSubdivisionById(id) {
  return SUBDIVISION_BY_ID.get(String(id || '')) || null;
}

export function normalizeGeoLocationToSubdivision(location = {}) {
  if (!location) return null;
  const direct = findSubdivisionById(location.subdivisionId || location.id);
  if (direct) return toSubdivisionLocation(direct);

  const country = String(location.country || '').toUpperCase();
  if (!country || !SUBDIVISION_DRILL_COUNTRIES[country]) return null;

  const candidates = [
    location.subdivisionName,
    location.name,
    location.id,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (!normalized) continue;
    const subdivision = SUBDIVISION_BY_COUNTRY_AND_ALIAS.get(`${country}:${normalized}`);
    if (subdivision) return toSubdivisionLocation(subdivision);
  }

  return null;
}
