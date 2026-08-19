import { createHash } from 'node:crypto';

import { formatMexicoDateYmd } from './market-gen/mexico-time.js';

export const AICM_SOURCE = 'aicm-official-flight-board';
export const AICM_DEFAULT_FLIGHTS_URL = 'https://www.aicm.com.mx/pasajeros/vuelos';
export const AICM_MAX_OBSERVATIONS_PER_POLL = 750;

const DIRECTION_CONFIG = {
  departure: { key: 'departure', da: 'd', label: 'salidas' },
  departures: { key: 'departure', da: 'd', label: 'salidas' },
  salida: { key: 'departure', da: 'd', label: 'salidas' },
  salidas: { key: 'departure', da: 'd', label: 'salidas' },
  d: { key: 'departure', da: 'd', label: 'salidas' },
  arrival: { key: 'arrival', da: 'a', label: 'llegadas' },
  arrivals: { key: 'arrival', da: 'a', label: 'llegadas' },
  llegada: { key: 'arrival', da: 'a', label: 'llegadas' },
  llegadas: { key: 'arrival', da: 'a', label: 'llegadas' },
  a: { key: 'arrival', da: 'a', label: 'llegadas' },
};

const BLOCK_TAG_RE = /<(br|p|div|li|h[1-6]|section|article|tr|td|th)\b[^>]*>/gi;
const TABLE_RE = /<table\b[\s\S]*?<\/table>/gi;
const ROW_RE = /<tr\b[\s\S]*?<\/tr>/gi;
const CELL_RE = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (raw, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : raw;
    })
    .replace(/&#x([0-9a-f]+);/gi, (raw, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : raw;
    });
}

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function cleanHtmlText(value) {
  return decodeHtmlEntities(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(BLOCK_TAG_RE, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKeyText(value) {
  return stripAccents(cleanHtmlText(value))
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashText(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

export function normalizeAicmDirection(value = 'departure') {
  const key = stripAccents(String(value || '')).toLowerCase().trim();
  return DIRECTION_CONFIG[key] || DIRECTION_CONFIG.departure;
}

export function buildAicmFlightBoardUrl(direction = 'departure', {
  baseUrl = process.env.AICM_FLIGHTS_URL || AICM_DEFAULT_FLIGHTS_URL,
} = {}) {
  const cfg = normalizeAicmDirection(direction);
  const url = new URL(baseUrl || AICM_DEFAULT_FLIGHTS_URL);
  url.searchParams.set('da', cfg.da);
  url.searchParams.set('busca', '');
  url.searchParams.set('ciudad', '');
  url.searchParams.set('air', '');
  url.searchParams.set('in0', 'n');
  return url.toString();
}

export function normalizeAicmFlightStatus(value) {
  const text = normalizeKeyText(value);
  if (!text) return 'unknown';
  if (/\b(cancelado|cancelada|cancelled|canceled)\b/.test(text)) return 'cancelled';
  if (/\b(demorado|demorada|retrasado|retrasada|retraso|delay|delayed)\b/.test(text)) return 'delayed';
  if (/\b(a tiempo|en tiempo|on time|programado|programada|scheduled)\b/.test(text)) return 'scheduled';
  if (/\b(cerrado|cerrada|closed)\b/.test(text)) return 'closed';
  if (/\b(abordando|abordaje|embarque|boarding)\b/.test(text)) return 'boarding';
  if (/\b(despego|despega|despegado|departed|salio|salida confirmada)\b/.test(text)) return 'departed';
  if (/\b(arribo|arribado|aterrizo|aterrizado|llego|arrived)\b/.test(text)) return 'arrived';
  return 'unknown';
}

function fieldForHeader(header) {
  const text = normalizeKeyText(header);
  if (!text) return null;
  if (/\b(estatus|estado|status|situacion)\b/.test(text)) return 'statusRaw';
  if (/\b(vuelo|flight|numero de vuelo|num vuelo)\b/.test(text)) return 'flightCode';
  if (/\b(aerolinea|airline|linea aerea)\b/.test(text)) return 'airline';
  if (/\b(ciudad|destino|origen|procedencia|destination|origin)\b/.test(text)) return 'city';
  if (/\b(terminal)\b/.test(text)) return 'terminal';
  if (/\b(sala|puerta|gate)\b/.test(text)) return 'gate';
  if (/\b(estimad|real|actual|eta|etd)\b/.test(text)) return 'estimatedTimeLocal';
  if (/\b(hora|programad|itinerario|scheduled)\b/.test(text)) return 'scheduledTimeLocal';
  return null;
}

function extractCells(rowHtml) {
  const cells = [];
  let match;
  CELL_RE.lastIndex = 0;
  while ((match = CELL_RE.exec(rowHtml))) {
    const text = cleanHtmlText(match[2]);
    if (text) cells.push({ tag: match[1].toLowerCase(), text });
  }
  return cells;
}

function looksLikeHeaderRow(cells) {
  if (!cells.length) return false;
  if (cells.some(cell => cell.tag === 'th')) return true;
  return cells.map(cell => fieldForHeader(cell.text)).filter(Boolean).length >= 2;
}

function normalizeFlightCode(value) {
  const cleaned = stripAccents(String(value || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const match = cleaned.match(/\b[A-Z]{2,4}\s?\d{1,5}[A-Z]?\b/) || cleaned.match(/\b\d{2,5}\b/);
  return match ? match[0].replace(/\s+/g, '') : cleaned.slice(0, 32);
}

function looksLikeFlightCode(value) {
  return !!normalizeFlightCode(value) && /\d/.test(normalizeFlightCode(value));
}

function extractTime(value) {
  const match = String(value || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}

function inferFlightFields(cells) {
  const texts = cells.map(cell => cell.text).filter(Boolean);
  const out = {};

  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const statusNorm = normalizeAicmFlightStatus(texts[i]);
    if (statusNorm !== 'unknown') {
      out.statusRaw = texts[i];
      out.statusNorm = statusNorm;
      break;
    }
  }

  out.flightCode = texts.find(looksLikeFlightCode) || null;
  const timeCells = texts.map(extractTime).filter(Boolean);
  out.scheduledTimeLocal = timeCells[0] || null;
  out.estimatedTimeLocal = timeCells[1] || null;

  const statusText = out.statusRaw || '';
  const flightText = out.flightCode || '';
  const remaining = texts.filter(text => (
    text !== statusText
    && text !== flightText
    && !extractTime(text)
    && normalizeAicmFlightStatus(text) === 'unknown'
  ));

  out.airline = remaining[0] || null;
  out.city = remaining[1] || null;
  out.terminal = remaining.find(text => /\bT[12]\b|terminal/i.test(text)) || null;
  out.gate = remaining.find(text => /\b(?:sala|puerta|gate)\b/i.test(text)) || null;
  return out;
}

function mapCellsWithHeaders(cells, headers) {
  const out = {};
  for (let i = 0; i < cells.length; i += 1) {
    const field = fieldForHeader(headers[i] || '');
    if (!field || out[field]) continue;
    out[field] = cells[i].text;
  }
  return out;
}

function buildFlightKey(row) {
  const pieces = [
    row.flightDate,
    row.direction,
    row.flightCode || '',
    row.scheduledTimeLocal || '',
    row.city || '',
    row.airline || '',
  ].map(normalizeKeyText);
  return pieces.join('|');
}

function normalizeAicmRow(cells, headers, context) {
  const mapped = headers?.length ? mapCellsWithHeaders(cells, headers) : {};
  const inferred = inferFlightFields(cells);
  const rawCells = cells.map(cell => cell.text);
  const row = {
    direction: context.direction,
    flightDate: context.flightDate,
    observedAt: context.observedAt,
    sourceUrl: context.sourceUrl,
    flightCode: normalizeFlightCode(mapped.flightCode || inferred.flightCode),
    airline: cleanHtmlText(mapped.airline || inferred.airline).slice(0, 120) || null,
    city: cleanHtmlText(mapped.city || inferred.city).slice(0, 120) || null,
    scheduledTimeLocal: extractTime(mapped.scheduledTimeLocal || inferred.scheduledTimeLocal) || null,
    estimatedTimeLocal: extractTime(mapped.estimatedTimeLocal || inferred.estimatedTimeLocal) || null,
    terminal: cleanHtmlText(mapped.terminal || inferred.terminal).slice(0, 32) || null,
    gate: cleanHtmlText(mapped.gate || inferred.gate).slice(0, 32) || null,
    statusRaw: cleanHtmlText(mapped.statusRaw || inferred.statusRaw).slice(0, 80) || 'unknown',
    rawCells,
  };
  row.statusNorm = normalizeAicmFlightStatus(row.statusRaw);
  row.flightKey = buildFlightKey(row);

  const hasIdentity = row.flightCode || row.scheduledTimeLocal || row.city || row.airline;
  if (!hasIdentity) return null;
  if (row.rawCells.length < 2) return null;
  return row;
}

function extractTableObservations(html, context) {
  const observations = [];
  const tables = [...String(html || '').matchAll(TABLE_RE)].map(match => match[0]);
  for (const tableHtml of tables) {
    let headers = [];
    const rows = [...tableHtml.matchAll(ROW_RE)].map(match => match[0]);
    for (const rowHtml of rows) {
      const cells = extractCells(rowHtml);
      if (!cells.length) continue;
      if (looksLikeHeaderRow(cells)) {
        headers = cells.map(cell => cell.text);
        continue;
      }
      const row = normalizeAicmRow(cells, headers, context);
      if (row) observations.push(row);
    }
  }
  return { observations, tableCount: tables.length };
}

export function parseAicmFlightBoard(html, {
  direction = 'departure',
  sourceUrl = buildAicmFlightBoardUrl(direction),
  observedAt = new Date().toISOString(),
} = {}) {
  const dir = normalizeAicmDirection(direction);
  const observedDate = new Date(observedAt);
  const flightDate = formatMexicoDateYmd(Number.isNaN(observedDate.getTime()) ? new Date() : observedDate);
  const text = normalizeKeyText(html);
  const maintenance = /por el momento se encuentra en mantenimiento|en mantenimiento/.test(text);
  const context = {
    direction: dir.key,
    flightDate,
    observedAt,
    sourceUrl,
  };
  const { observations, tableCount } = extractTableObservations(html, context);
  const rows = observations.slice(0, AICM_MAX_OBSERVATIONS_PER_POLL);
  const delayedCount = rows.filter(row => row.statusNorm === 'delayed').length;
  const cancelledCount = rows.filter(row => row.statusNorm === 'cancelled').length;
  const status = rows.length
    ? 'ok'
    : maintenance
      ? 'maintenance'
      : tableCount > 0
        ? 'empty'
        : 'no_table';

  return {
    ok: status === 'ok' || status === 'empty',
    source: AICM_SOURCE,
    direction: dir.key,
    directionLabel: dir.label,
    status,
    observedAt,
    flightDate,
    sourceUrl,
    rowCount: rows.length,
    delayedCount,
    cancelledCount,
    tableCount,
    rowsCapped: observations.length > rows.length,
    rows,
  };
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller ? controller.signal : options?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readAicmFlightBoard({
  direction = 'departure',
  fetchImpl = globalThis.fetch,
  now = new Date(),
  baseUrl = process.env.AICM_FLIGHTS_URL || AICM_DEFAULT_FLIGHTS_URL,
  timeoutMs = Number(process.env.AICM_FETCH_TIMEOUT_MS || 12_000),
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_not_available');
  }
  const sourceUrl = buildAicmFlightBoardUrl(direction, { baseUrl });
  const observedAt = now.toISOString();
  try {
    const response = await fetchWithTimeout(fetchImpl, sourceUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'PronosAICMDelayOracle/1.0 (+https://pronos.io)',
      },
    }, timeoutMs);
    const html = await response.text();
    const parsed = parseAicmFlightBoard(html, { direction, sourceUrl, observedAt });
    return {
      ...parsed,
      httpStatus: response.status || null,
      rawHtmlSha256: hashText(html),
      rawHtmlBytes: byteLength(html),
      ok: Boolean(response.ok) && parsed.ok,
      status: response.ok ? parsed.status : 'http_error',
      error: response.ok ? null : `http_${response.status}`,
    };
  } catch (err) {
    const dir = normalizeAicmDirection(direction);
    return {
      ok: false,
      source: AICM_SOURCE,
      direction: dir.key,
      directionLabel: dir.label,
      status: 'fetch_error',
      observedAt,
      flightDate: formatMexicoDateYmd(now),
      sourceUrl,
      httpStatus: null,
      rawHtmlSha256: null,
      rawHtmlBytes: 0,
      rowCount: 0,
      delayedCount: 0,
      cancelledCount: 0,
      tableCount: 0,
      rowsCapped: false,
      rows: [],
      error: err?.message?.slice(0, 240) || 'fetch_failed',
    };
  }
}

function rowsFromResult(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

async function insertAicmObservations(sql, snapshot, pollRunId) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  if (!rows.length) return 0;

  const columns = [
    'poll_run_id',
    'source',
    'flight_key',
    'direction',
    'flight_date',
    'flight_code',
    'airline',
    'city',
    'scheduled_time_local',
    'estimated_time_local',
    'terminal',
    'gate',
    'status_raw',
    'status_norm',
    'raw_cells',
    'source_url',
    'observed_at',
  ];
  const params = [];
  const values = rows.map((row) => {
    const offset = params.length;
    params.push(
      pollRunId,
      snapshot.source || AICM_SOURCE,
      row.flightKey,
      row.direction,
      row.flightDate,
      row.flightCode || null,
      row.airline || null,
      row.city || null,
      row.scheduledTimeLocal || null,
      row.estimatedTimeLocal || null,
      row.terminal || null,
      row.gate || null,
      row.statusRaw,
      row.statusNorm,
      JSON.stringify(row.rawCells || []),
      row.sourceUrl || snapshot.sourceUrl,
      row.observedAt || snapshot.observedAt,
    );
    return `(${columns.map((_, i) => `$${offset + i + 1}`).join(', ')})`;
  });

  const result = await sql.query(`
    INSERT INTO points_aicm_flight_observations (${columns.join(', ')})
    VALUES ${values.join(', ')}
    ON CONFLICT (flight_key, status_norm) DO NOTHING
    RETURNING id
  `, params);
  return rowsFromResult(result).length;
}

export async function persistAicmOracleSnapshot(sql, snapshot) {
  const runRows = await sql.query(`
    INSERT INTO points_aicm_poll_runs (
      source,
      direction,
      status,
      observed_at,
      flight_date,
      source_url,
      http_status,
      raw_html_sha256,
      raw_html_bytes,
      row_count,
      delayed_count,
      cancelled_count,
      rows_capped,
      error
    )
    VALUES (
      $1, $2, $3, $4::timestamptz, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14
    )
    RETURNING id
  `, [
    snapshot.source || AICM_SOURCE,
    snapshot.direction,
    snapshot.status,
    snapshot.observedAt,
    snapshot.flightDate,
    snapshot.sourceUrl,
    snapshot.httpStatus || null,
    snapshot.rawHtmlSha256 || null,
    Number(snapshot.rawHtmlBytes || 0),
    Number(snapshot.rowCount || 0),
    Number(snapshot.delayedCount || 0),
    Number(snapshot.cancelledCount || 0),
    Boolean(snapshot.rowsCapped),
    snapshot.error || null,
  ]);
  const pollRunId = Number(rowsFromResult(runRows)[0]?.id || 0);
  const insertedObservations = pollRunId
    ? await insertAicmObservations(sql, snapshot, pollRunId)
    : 0;
  return {
    pollRunId,
    insertedObservations,
  };
}

export async function runAicmOraclePoll({
  sql,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  direction = 'both',
  dryRun = false,
} = {}) {
  const directions = String(direction || 'both').toLowerCase() === 'both'
    ? ['departure', 'arrival']
    : [normalizeAicmDirection(direction).key];

  const snapshots = [];
  for (const dir of directions) {
    const snapshot = await readAicmFlightBoard({ direction: dir, fetchImpl, now });
    let persisted = { pollRunId: null, insertedObservations: 0 };
    if (!dryRun && sql) {
      persisted = await persistAicmOracleSnapshot(sql, snapshot);
    }
    snapshots.push({
      source: snapshot.source,
      direction: snapshot.direction,
      status: snapshot.status,
      ok: snapshot.ok,
      observedAt: snapshot.observedAt,
      flightDate: snapshot.flightDate,
      sourceUrl: snapshot.sourceUrl,
      httpStatus: snapshot.httpStatus,
      rawHtmlSha256: snapshot.rawHtmlSha256,
      rawHtmlBytes: snapshot.rawHtmlBytes,
      rowCount: snapshot.rowCount,
      delayedCount: snapshot.delayedCount,
      cancelledCount: snapshot.cancelledCount,
      rowsCapped: snapshot.rowsCapped,
      error: snapshot.error || null,
      ...persisted,
    });
  }

  return {
    dryRun,
    observedAt: now.toISOString(),
    status: snapshots.some(s => s.status === 'ok')
      ? 'ok'
      : snapshots.some(s => s.status === 'maintenance')
        ? 'maintenance'
        : snapshots[0]?.status || 'unknown',
    snapshots,
  };
}

export async function readAicmDelayCount(sql, {
  fromDateYmd,
  toDateYmd,
  direction = 'departure',
  statusNorm = 'delayed',
} = {}) {
  if (!fromDateYmd || !toDateYmd) {
    throw new Error('aicm_delay_count_requires_date_range');
  }
  const dir = normalizeAicmDirection(direction).key;
  const rows = await sql.query(`
    SELECT
      COUNT(DISTINCT flight_key)::int AS count,
      MIN(observed_at) AS first_observed_at,
      MAX(observed_at) AS last_observed_at
    FROM points_aicm_flight_observations
    WHERE flight_date >= $1::date
      AND flight_date <= $2::date
      AND direction = $3
      AND status_norm = $4
  `, [fromDateYmd, toDateYmd, dir, statusNorm]);
  const row = rowsFromResult(rows)[0] || {};
  return {
    source: AICM_SOURCE,
    direction: dir,
    statusNorm,
    fromDateYmd,
    toDateYmd,
    count: Number(row.count || 0),
    firstObservedAt: row.first_observed_at || null,
    lastObservedAt: row.last_observed_at || null,
  };
}
