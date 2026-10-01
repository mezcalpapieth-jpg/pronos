import { deferUntilResolveAt } from './price-buckets.js';

export const IBTRACS_LAST3YEARS_SOURCE = 'https://erddap.aoml.noaa.gov/hdb/erddap/tabledap/IBTRACS_last3years.csv';
export const IBTRACS_PRODUCT_PAGE = 'https://www.ncei.noaa.gov/products/international-best-track-archive';

const IBTRACS_COLUMNS = Object.freeze([
  'sid',
  'season',
  'basin',
  'name',
  'iso_time',
  'latitude',
  'longitude',
  'usa_wind',
  'usa_sshs',
  'dist2land',
  'landfall',
  'usa_record',
]);

const NORTH_AMERICA_BASINS = new Set(['NA', 'EP', 'CP']);

const MAINLAND_MEXICO_POLYGON = Object.freeze([
  [-117.2, 32.6],
  [-114.7, 32.7],
  [-112.7, 31.4],
  [-111.0, 29.8],
  [-109.2, 28.8],
  [-106.5, 31.8],
  [-103.2, 29.9],
  [-100.0, 29.3],
  [-97.1, 25.9],
  [-97.0, 22.4],
  [-94.7, 18.7],
  [-91.9, 18.7],
  [-87.0, 21.7],
  [-86.7, 20.0],
  [-90.4, 18.3],
  [-92.3, 14.5],
  [-94.0, 15.0],
  [-96.2, 15.7],
  [-99.0, 16.0],
  [-103.4, 17.7],
  [-106.6, 21.6],
  [-110.0, 23.9],
  [-112.8, 27.0],
  [-114.9, 30.0],
  [-117.2, 32.6],
]);

const BAJA_CALIFORNIA_POLYGON = Object.freeze([
  [-117.2, 32.6],
  [-114.6, 32.7],
  [-112.7, 31.0],
  [-110.8, 28.0],
  [-109.6, 24.0],
  [-110.4, 22.8],
  [-112.4, 24.6],
  [-114.2, 27.8],
  [-115.7, 30.5],
  [-117.2, 32.6],
]);

const MEXICO_POLYGONS = Object.freeze([
  MAINLAND_MEXICO_POLYGON,
  BAJA_CALIFORNIA_POLYGON,
]);

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLon(value) {
  const n = numeric(value);
  if (n == null) return null;
  return n > 180 ? n - 360 : n;
}

function compactStormLabel(row) {
  return [row.name, row.sid].filter(Boolean).join(' ').trim() || 'IBTrACS storm';
}

function normalizeIbtracsTime(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return `${raw.replace(' ', 'T')}Z`;
  }
  return raw;
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export function parseIbtracsCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(header => header.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  }).filter(row => {
    const iso = String(row.iso_time || '').trim();
    return iso && iso !== 'UTC' && iso !== 'seconds since 1970-01-01T00:00:00Z';
  });
}

function queryConstraint(name, op, value) {
  const encodedOp = op === '=' ? '=' : encodeURIComponent(op).replace('%3D', '=');
  return `${encodeURIComponent(name)}${encodedOp}${encodeURIComponent(value)}`;
}

export function ibtracsQueryUrl({
  sourceUrl = IBTRACS_LAST3YEARS_SOURCE,
  startIso,
  endIso,
  season,
} = {}) {
  const projection = IBTRACS_COLUMNS.join(',');
  const constraints = [];
  if (season) constraints.push(queryConstraint('season', '=', String(season)));
  if (startIso) constraints.push(queryConstraint('time', '>=', new Date(startIso).toISOString()));
  if (endIso) constraints.push(queryConstraint('time', '<=', new Date(endIso).toISOString()));
  return `${sourceUrl}?${projection}${constraints.length ? `&${constraints.join('&')}` : ''}`;
}

function pointInPolygon([lon, lat], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = ((yi > lat) !== (yj > lat))
      && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointIsInMexicoLand({ latitude, longitude } = {}) {
  const lat = numeric(latitude);
  const lon = normalizeLon(longitude);
  if (lat == null || lon == null) return false;
  if (lat < 14 || lat > 33.5 || lon < -118.5 || lon > -86) return false;
  return MEXICO_POLYGONS.some(polygon => pointInPolygon([lon, lat], polygon));
}

function rowTimeMs(row) {
  const ms = new Date(normalizeIbtracsTime(row.iso_time)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function rowInRange(row, startMs, endMs) {
  const ms = rowTimeMs(row);
  if (ms == null) return false;
  return ms >= startMs && ms <= endMs;
}

function isMajorHurricane(row, minCategory) {
  const category = numeric(row.usa_sshs);
  const wind = numeric(row.usa_wind);
  return (category != null && category >= minCategory)
    || (wind != null && wind >= 113);
}

function isNearLandfall(row) {
  const dist2land = numeric(row.dist2land);
  const landfall = numeric(row.landfall);
  const record = String(row.usa_record || '').toUpperCase();
  return dist2land === 0 || landfall === 0 || record.includes('L');
}

function publicStormRow(row) {
  return {
    sid: row.sid || null,
    name: row.name || null,
    basin: row.basin || null,
    isoTime: normalizeIbtracsTime(row.iso_time) || null,
    latitude: numeric(row.latitude),
    longitude: normalizeLon(row.longitude),
    usaWindKt: numeric(row.usa_wind),
    usaSshs: numeric(row.usa_sshs),
    dist2landKm: numeric(row.dist2land),
    landfallKm: numeric(row.landfall),
    usaRecord: row.usa_record || null,
  };
}

export async function readIbtracsRows({
  startIso,
  endIso,
  season,
  sourceUrl,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
  const url = ibtracsQueryUrl({ sourceUrl, startIso, endIso, season });
  const response = await fetchImpl(url);
  if (!response?.ok) {
    throw new Error(`ibtracs_fetch_failed_${response?.status || 'unknown'}`);
  }
  const text = await response.text();
  return {
    rows: parseIbtracsCsv(text),
    sourceUrl: url,
  };
}

export async function resolveMexicoMajorHurricaneLandfall({
  startIso,
  endIso,
  resolveAt,
  minCategory = 4,
  sourceUrl = IBTRACS_LAST3YEARS_SOURCE,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!startIso || !endIso) throw new Error('invalid_hurricane_config');
  deferUntilResolveAt(resolveAt);

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error('invalid_hurricane_window');
  }

  const season = new Date(startIso).getUTCFullYear();
  const { rows, sourceUrl: resolvedSourceUrl } = await readIbtracsRows({
    startIso,
    endIso,
    season,
    sourceUrl,
    fetchImpl,
  });

  const relevantRows = rows.filter(row => (
    rowInRange(row, startMs, endMs)
    && NORTH_AMERICA_BASINS.has(String(row.basin || '').toUpperCase())
  ));
  const qualifying = relevantRows.filter(row => isMajorHurricane(row, Number(minCategory) || 4));
  const landfallRows = qualifying.filter(isNearLandfall);
  const mexicoMatches = landfallRows.filter(row => pointIsInMexicoLand({
    latitude: row.latitude,
    longitude: row.longitude,
  }));

  if (mexicoMatches.length > 0) {
    const matchedStorms = mexicoMatches.map(publicStormRow);
    return {
      winningIdx: 0,
      resolverInfo: {
        source: 'NOAA IBTrACS',
        sourceUrl: resolvedSourceUrl,
        count: matchedStorms.length,
        minCategory: Number(minCategory) || 4,
        matchedStorms,
        finalScore: compactStormLabel(mexicoMatches[0]),
      },
      resolverConfigPatch: {
        resolvedAt: new Date().toISOString(),
        resolvedSourceUrl,
        matchedStorms,
      },
    };
  }

  const edgeRows = landfallRows.filter(row => {
    const lat = numeric(row.latitude);
    const lon = normalizeLon(row.longitude);
    return lat != null && lon != null && lat >= 10 && lat <= 35 && lon >= -120 && lon <= -84;
  });
  if (edgeRows.length > 0) {
    const err = new Error('hurricane_mexico_landfall_manual_review_required');
    err.benign = true;
    err.manualReview = true;
    err.info = {
      source: 'NOAA IBTrACS',
      sourceUrl: resolvedSourceUrl,
      minCategory: Number(minCategory) || 4,
      candidateStorms: edgeRows.map(publicStormRow),
    };
    throw err;
  }

  return {
    winningIdx: 1,
    resolverInfo: {
      source: 'NOAA IBTrACS',
      sourceUrl: resolvedSourceUrl,
      count: 0,
      checkedRows: relevantRows.length,
      minCategory: Number(minCategory) || 4,
      finalScore: '0 huracanes Cat 4+ tocaron tierra en Mexico',
    },
    resolverConfigPatch: {
      resolvedAt: new Date().toISOString(),
      resolvedSourceUrl,
      matchedStorms: [],
    },
  };
}
