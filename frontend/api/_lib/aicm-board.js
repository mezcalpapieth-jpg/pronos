import { createHash } from 'node:crypto';

import { formatMexicoDateYmd } from './market-gen/mexico-time.js';

export const AICM_SOURCE = 'aicm-official-flight-board';
export const AICM_DEFAULT_FLIGHTS_URL = 'https://www.aicm.com.mx/pasajeros/vuelos';
export const AICM_MAX_OBSERVATIONS_PER_POLL = 750;

export const AICM_DAILY_DELAY_BUCKETS = [
  { label: '0-5', minCount: 0, maxCount: 5 },
  { label: '6-15', minCount: 6, maxCount: 15 },
  { label: '16-30', minCount: 16, maxCount: 30 },
  { label: '31+', minCount: 31, maxCount: null },
];

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
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const alt = tag.match(/\balt=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const title = tag.match(/\btitle=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      return ` ${alt?.[1] || alt?.[2] || alt?.[3] || title?.[1] || title?.[2] || title?.[3] || ''} `;
    })
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

export function aicmDelayBucketIndexFor(count, buckets = AICM_DAILY_DELAY_BUCKETS) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0 || !Array.isArray(buckets)) return -1;
  return buckets.findIndex((bucket) => {
    const min = Number(bucket?.minCount ?? bucket?.min ?? 0);
    const rawMax = bucket?.maxCount ?? bucket?.max ?? null;
    const max = rawMax == null ? null : Number(rawMax);
    if (!Number.isFinite(min)) return false;
    if (max != null && !Number.isFinite(max)) return false;
    return n >= min && (max == null || n <= max);
  });
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
    cells.push({ tag: match[1].toLowerCase(), text });
  }
  return cells;
}

function looksLikeHeaderRow(cells) {
  if (!cells.length) return false;
  if (cells.some(cell => cell.tag === 'th')) return true;
  return cells.map(cell => fieldForHeader(cell.text)).filter(Boolean).length >= 2;
}

function normalizeFlightCode(value, { allowNumeric = true } = {}) {
  const cleaned = stripAccents(String(value || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (/^T\s?[12]$/.test(cleaned) || /^TERMINAL\s?[12]$/.test(cleaned)) return null;
  const alphaMatch = cleaned.match(/\b[A-Z]{1,4}\s?\d{1,5}[A-Z]?\b/);
  if (alphaMatch) return alphaMatch[0].replace(/\s+/g, '');
  if (allowNumeric) {
    const numericMatch = cleaned.match(/\b\d{2,5}\b/);
    if (numericMatch) return numericMatch[0];
  }
  return null;
}

function looksLikeFlightCode(value) {
  if (looksLikeTerminal(value)) return false;
  const code = normalizeFlightCode(value, { allowNumeric: false });
  return !!code && /[A-Z]/.test(code) && /\d/.test(code);
}

function extractTime(value) {
  const match = String(value || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}

function sameText(a, b) {
  return Boolean(a && b && normalizeKeyText(a) === normalizeKeyText(b));
}

function looksLikeTerminal(value) {
  const text = normalizeKeyText(value);
  return /^t\s*[12]$/.test(text) || /^terminal\s*[12]$/.test(text);
}

function looksLikeGateValue(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (looksLikeTerminal(text) || extractTime(text) || looksLikeFlightCode(text)) return false;
  if (normalizeAicmFlightStatus(text) !== 'unknown') return false;
  const key = normalizeKeyText(text);
  if (/^(sala|puerta|gate)\s+[a-z0-9-]{1,6}$/.test(key)) return true;
  return /^[A-Z]$/i.test(text) || /^\d{1,3}[A-Z]?$/i.test(text);
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

  const timeCells = texts.map(extractTime).filter(Boolean);
  out.scheduledTimeLocal = timeCells[0] || null;
  out.estimatedTimeLocal = timeCells[1] || null;
  out.flightCode = texts.find(text => !extractTime(text) && looksLikeFlightCode(text)) || null;

  const statusText = out.statusRaw || '';
  const flightText = out.flightCode || '';
  const remaining = texts.filter(text => (
    text !== statusText
    && text !== flightText
    && !extractTime(text)
    && normalizeAicmFlightStatus(text) === 'unknown'
  ));

  out.terminal = remaining.find(looksLikeTerminal) || null;
  out.gate = remaining.find(text => !sameText(text, out.terminal) && looksLikeGateValue(text)) || null;

  const entityCandidates = remaining.filter(text => (
    !sameText(text, out.terminal)
    && !sameText(text, out.gate)
    && !looksLikeTerminal(text)
    && !looksLikeGateValue(text)
  ));

  if (entityCandidates.length >= 2) {
    out.airline = entityCandidates[0] || null;
    out.city = entityCandidates[1] || null;
  } else {
    out.airline = null;
    out.city = entityCandidates[0] || null;
  }
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
  const mappedFlightCode = normalizeFlightCode(mapped.flightCode);
  const inferredFlightCode = normalizeFlightCode(inferred.flightCode, { allowNumeric: false })
    || normalizeFlightCode(inferred.flightCode);
  const flightCode = mappedFlightCode && (/[A-Z]/.test(mappedFlightCode) || !inferredFlightCode)
    ? mappedFlightCode
    : inferredFlightCode;
  const mappedCity = cleanHtmlText(mapped.city);
  const inferredCity = cleanHtmlText(inferred.city);
  const city = looksLikeTerminal(mappedCity) && inferredCity ? inferredCity : (mappedCity || inferredCity);
  const mappedGate = cleanHtmlText(mapped.gate);
  const inferredGate = cleanHtmlText(inferred.gate);
  const gate = normalizeAicmFlightStatus(mappedGate) !== 'unknown' && inferredGate
    ? inferredGate
    : (mappedGate || inferredGate);
  const row = {
    direction: context.direction,
    flightDate: context.flightDate,
    observedAt: context.observedAt,
    sourceUrl: context.sourceUrl,
    flightCode,
    airline: cleanHtmlText(mapped.airline || inferred.airline).slice(0, 120) || null,
    city: city.slice(0, 120) || null,
    scheduledTimeLocal: extractTime(mapped.scheduledTimeLocal || inferred.scheduledTimeLocal) || null,
    estimatedTimeLocal: extractTime(mapped.estimatedTimeLocal || inferred.estimatedTimeLocal) || null,
    terminal: cleanHtmlText(mapped.terminal || inferred.terminal).slice(0, 32) || null,
    gate: gate.slice(0, 32) || null,
    statusRaw: cleanHtmlText(mapped.statusRaw || inferred.statusRaw).slice(0, 80) || 'unknown',
    rawCells,
  };
  row.statusNorm = normalizeAicmFlightStatus(row.statusRaw);
  row.flightKey = buildFlightKey(row);

  const hasIdentity = row.flightCode || row.scheduledTimeLocal || row.city || row.airline;
  if (!hasIdentity) return null;
  if (row.rawCells.filter(Boolean).length < 2) return null;
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
      if (!cells.some(cell => cell.text)) continue;
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
    WITH poll_summary AS (
      SELECT
        COUNT(*)::int AS poll_count,
        COUNT(*) FILTER (WHERE status = 'ok')::int AS ok_poll_count,
        MAX(observed_at) AS last_poll_observed_at
      FROM points_aicm_poll_runs
      WHERE flight_date >= $1::date
        AND flight_date <= $2::date
        AND direction = $3
    ),
    observation_summary AS (
      SELECT
        COUNT(DISTINCT flight_key) FILTER (WHERE status_norm = $4)::int AS count,
        COUNT(DISTINCT flight_key)::int AS flights_with_any_status,
        MIN(observed_at) AS first_observed_at,
        MAX(observed_at) AS last_observed_at
      FROM points_aicm_flight_observations
      WHERE flight_date >= $1::date
        AND flight_date <= $2::date
        AND direction = $3
    )
    SELECT
      COALESCE(o.count, 0)::int AS count,
      COALESCE(o.flights_with_any_status, 0)::int AS flights_with_any_status,
      o.first_observed_at,
      o.last_observed_at,
      COALESCE(p.poll_count, 0)::int AS poll_count,
      COALESCE(p.ok_poll_count, 0)::int AS ok_poll_count,
      p.last_poll_observed_at
    FROM observation_summary o
    CROSS JOIN poll_summary p
  `, [fromDateYmd, toDateYmd, dir, statusNorm]);
  const row = rowsFromResult(rows)[0] || {};
  return {
    source: AICM_SOURCE,
    direction: dir,
    statusNorm,
    fromDateYmd,
    toDateYmd,
    count: Number(row.count || 0),
    flightsWithAnyStatus: Number(row.flights_with_any_status || 0),
    pollCount: Number(row.poll_count || 0),
    okPollCount: Number(row.ok_poll_count || 0),
    firstObservedAt: row.first_observed_at || null,
    lastObservedAt: row.last_observed_at || null,
    lastPollObservedAt: row.last_poll_observed_at || null,
  };
}
