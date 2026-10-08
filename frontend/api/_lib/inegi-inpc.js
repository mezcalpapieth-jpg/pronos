export const INEGI_INPC_SOURCE = 'inegi-inpc';
export const INEGI_INPC_BIWEEKLY_ANNUAL_INDICATOR_ID = '910438';
export const INEGI_API_DOCS_URL = 'https://www.inegi.org.mx/servicios/api_indicadores.html';
export const INEGI_FEEDS_URL = 'https://www.inegi.org.mx/servicios/feeds.html';

const INEGI_API_ROOT = 'https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml';

const MONTHS = Object.freeze({
  ene: 1,
  enero: 1,
  jan: 1,
  january: 1,
  feb: 2,
  febrero: 2,
  february: 2,
  mar: 3,
  marzo: 3,
  march: 3,
  abr: 4,
  abril: 4,
  apr: 4,
  april: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  june: 6,
  jul: 7,
  julio: 7,
  july: 7,
  ago: 8,
  agosto: 8,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  septiembre: 9,
  september: 9,
  oct: 10,
  octubre: 10,
  october: 10,
  nov: 11,
  noviembre: 11,
  november: 11,
  dic: 12,
  diciembre: 12,
  dec: 12,
  december: 12,
});

function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(value) {
  let clean = String(value ?? '').trim();
  if (!clean || clean === 'N/E') return null;
  clean = clean.replace(/%/g, '').replace(/\s+/g, '');
  if (/^[+-]?\d+,\d+$/.test(clean)) clean = clean.replace(',', '.');
  else clean = clean.replace(/,/g, '');
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function fortnightFromToken(value) {
  const s = normalizeText(value);
  if (/^(1|01|1q|q1|1a|1ra|primera|first)$/.test(s)) return 1;
  if (/^(2|02|2q|q2|2a|2da|segunda|second)$/.test(s)) return 2;
  const n = Number.parseInt(s, 10);
  if (Number.isFinite(n)) {
    if (n <= 2) return n;
    if (n <= 15) return 1;
    return 2;
  }
  return null;
}

function monthFromWord(value) {
  const s = normalizeText(value).replace(/\./g, '');
  return MONTHS[s] || null;
}

export function normalizeInegiBiweeklyPeriod(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = normalizeText(raw);

  let match = normalized.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}|[12]q|q[12]|[12]))?$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const half = fortnightFromToken(match[3] || '1');
    if (Number.isInteger(year) && Number.isInteger(month) && half) {
      return `${year}-${pad2(month)}-${half}Q`;
    }
  }

  match = normalized.match(/^(1|2)q\s+([a-z.]+)\s+(\d{4})$/);
  if (match) {
    const month = monthFromWord(match[2]);
    if (month) return `${match[3]}-${pad2(month)}-${match[1]}Q`;
  }

  match = normalized.match(/\b(primera|segunda|first|second|1a|1ra|2a|2da)\s+quincena\b(?:\s+de)?\s+([a-z.]+).*?\b(\d{4})\b/);
  if (match) {
    const half = fortnightFromToken(match[1]);
    const month = monthFromWord(match[2]);
    if (half && month) return `${match[3]}-${pad2(month)}-${half}Q`;
  }

  match = normalized.match(/\b(\d{4})\b.*?\b([a-z.]+)\b.*?\b(primera|segunda|first|second|1a|1ra|2a|2da)\b/);
  if (match) {
    const month = monthFromWord(match[2]);
    const half = fortnightFromToken(match[3]);
    if (half && month) return `${match[1]}-${pad2(month)}-${half}Q`;
  }

  return null;
}

function periodSortKey(period) {
  const match = String(period || '').match(/^(\d{4})-(\d{2})-([12])Q$/);
  if (!match) return -Infinity;
  return Number(match[1]) * 1000 + Number(match[2]) * 10 + Number(match[3]);
}

function indicatorUrl({
  indicatorId,
  language = 'es',
  geoArea = '00',
  recent = false,
  database = 'BISE',
  version = '2.0',
  token = process.env.INEGI_API_TOKEN || 'null',
} = {}) {
  const parts = [
    INEGI_API_ROOT,
    'INDICATOR',
    encodeURIComponent(indicatorId),
    encodeURIComponent(language),
    encodeURIComponent(geoArea),
    recent ? 'true' : 'false',
    encodeURIComponent(database),
    encodeURIComponent(version),
    encodeURIComponent(token || 'null'),
  ];
  return parts.join('/').replace('https:/', 'https://') + '?type=json';
}

function observationRowsFromPayload(payload) {
  const series = Array.isArray(payload?.Series)
    ? payload.Series
    : (Array.isArray(payload?.series) ? payload.series : []);
  const first = series[0] || {};
  const rows = Array.isArray(first.OBSERVATIONS)
    ? first.OBSERVATIONS
    : (Array.isArray(first.observations) ? first.observations : []);

  return rows
    .map(row => {
      const periodRaw = row?.TIME_PERIOD ?? row?.time_period ?? row?.period;
      const period = normalizeInegiBiweeklyPeriod(periodRaw);
      const value = parseNumber(row?.OBS_VALUE ?? row?.obs_value ?? row?.value);
      return {
        period,
        periodRaw,
        value,
        status: row?.OBS_STATUS ?? row?.obs_status ?? null,
      };
    })
    .filter(row => row.period && Number.isFinite(row.value));
}

function latestObservation(rows) {
  return [...rows].sort((a, b) => periodSortKey(b.period) - periodSortKey(a.period))[0] || null;
}

export async function readInegiInpcAnnualInflation(cfg = {}) {
  const indicatorId = String(
    cfg.indicatorId || cfg.seriesId || INEGI_INPC_BIWEEKLY_ANNUAL_INDICATOR_ID,
  );
  const targetPeriod = normalizeInegiBiweeklyPeriod(cfg.targetPeriod || cfg.period);
  if ((cfg.targetPeriod || cfg.period) && !targetPeriod) {
    throw new Error(`inegi_inpc_invalid_target_period_${cfg.targetPeriod || cfg.period}`);
  }

  const url = indicatorUrl({
    indicatorId,
    language: cfg.language || 'es',
    geoArea: cfg.geoArea || '00',
    recent: cfg.recent === true,
    database: cfg.database || 'BISE',
    version: cfg.version || '2.0',
    token: cfg.token || process.env[cfg.tokenEnv || 'INEGI_API_TOKEN'] || 'null',
  });
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Pronos resolver (+https://pronos.io)',
    },
  });
  if (!res.ok) throw new Error(`inegi_inpc_http_${res.status}`);
  const payload = await res.json();
  const rows = observationRowsFromPayload(payload);
  const latest = latestObservation(rows);
  const selected = targetPeriod
    ? rows.find(row => row.period === targetPeriod)
    : latest;

  if (!selected) {
    const err = new Error(`inegi_inpc_not_published_for_${targetPeriod || 'latest'}`);
    err.benign = true;
    err.info = {
      source: INEGI_INPC_SOURCE,
      indicatorId,
      expectedPeriod: targetPeriod,
      latestPeriod: latest?.period || null,
      latestPeriodRaw: latest?.periodRaw || null,
      sourceUrl: INEGI_API_DOCS_URL,
    };
    throw err;
  }

  return {
    value: selected.value,
    period: selected.period,
    periodRaw: selected.periodRaw,
    indicatorId,
    source: INEGI_INPC_SOURCE,
    sourceUrl: INEGI_API_DOCS_URL,
  };
}
