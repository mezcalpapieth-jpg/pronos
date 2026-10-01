export const SNIIM_FOOD_PRICE_SOURCE = 'sniim-food-price';

const SNIIM_ROOT = 'https://www.economia-sniim.gob.mx';

const MONTH_NAMES_ES = Object.freeze([
  null,
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]);

const MONTH_ABBR_ES = Object.freeze({
  ene: 1,
  enero: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  septiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
});

function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    apos: "'",
    aacute: 'á',
    eacute: 'é',
    iacute: 'í',
    oacute: 'ó',
    uacute: 'ú',
    ntilde: 'ñ',
    Aacute: 'Á',
    Eacute: 'É',
    Iacute: 'Í',
    Oacute: 'Ó',
    Uacute: 'Ú',
    Ntilde: 'Ñ',
  };
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const raw = entity[1]?.toLowerCase() === 'x' ? entity.slice(2) : entity.slice(1);
      const code = Number.parseInt(raw, entity[1]?.toLowerCase() === 'x' ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity] ?? match;
  });
}

function htmlCellText(html) {
  return decodeHtmlEntities(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseHtmlRows(html) {
  return [...String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(([, rowHtml]) => [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(([, cellHtml]) => htmlCellText(cellHtml)))
    .filter(row => row.some(Boolean));
}

function parseNumber(value) {
  const clean = String(value || '')
    .replace(/,/g, '')
    .replace(/[^\d.-]/g, '');
  if (!clean || clean === '-' || clean === '--') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function dmyToYmd(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function ymdToDmy(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function monthFromHeader(value) {
  const match = normalizeText(value).match(/^\d{1,2}-([a-z]+)/);
  if (!match) return null;
  return MONTH_ABBR_ES[match[1]] || null;
}

function tortillaHeaderToYmd(value, fallbackYear, fallbackMonth) {
  const match = normalizeText(value).match(/^(\d{1,2})-([a-z]+)/);
  if (!match) return null;
  const month = MONTH_ABBR_ES[match[2]] || Number(fallbackMonth);
  return `${fallbackYear}-${pad2(month)}-${pad2(match[1])}`;
}

function assertTargetMonth(result, cfg) {
  if (!result?.dateYmd || !cfg?.targetYear || !cfg?.targetMonth) return;
  const expectedPrefix = `${cfg.targetYear}-${pad2(cfg.targetMonth)}-`;
  if (!result.dateYmd.startsWith(expectedPrefix)) {
    const err = new Error(`sniim_food_price_not_published_for_${cfg.targetYear}_${pad2(cfg.targetMonth)}`);
    err.benign = true;
    err.info = {
      source: SNIIM_FOOD_PRICE_SOURCE,
      commodity: cfg.commodity,
      expectedYear: Number(cfg.targetYear),
      expectedMonth: Number(cfg.targetMonth),
      latestDateYmd: result.dateYmd,
    };
    throw err;
  }
}

async function fetchText(url, { encoding = 'utf-8' } = {}) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Pronos resolver (+https://pronos.io)',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`sniim_http_${res.status}`);
  if (encoding === 'utf-8' && typeof res.text === 'function') return res.text();
  if (typeof res.arrayBuffer === 'function') {
    const buffer = await res.arrayBuffer();
    return new TextDecoder(encoding).decode(buffer);
  }
  return res.text();
}

function buildUrl(path, params) {
  const url = new URL(path, SNIIM_ROOT);
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function readSniimTortillaNational(cfg = {}) {
  const targetYear = Number(cfg.targetYear);
  const targetMonth = Number(cfg.targetMonth);
  if (!Number.isFinite(targetYear) || !Number.isFinite(targetMonth)) {
    throw new Error('sniim tortilla: missing targetYear/targetMonth');
  }
  const sourceUrl = buildUrl('/TortillaMesPorDia.asp', {
    Cons: 'D',
    prod: 'T',
    dqMesMes: targetMonth,
    dqAnioMes: targetYear,
    preEdo: 'Cd',
    Formato: 'Nor',
    submit: 'Ver Resultados',
  });
  const html = await fetchText(sourceUrl, { encoding: 'iso-8859-1' });
  const result = parseSniimTortillaNational(html, { targetYear, targetMonth, sourceUrl });
  assertTargetMonth(result, { ...cfg, targetYear, targetMonth });
  return result;
}

export function parseSniimTortillaNational(html, { targetYear, targetMonth, sourceUrl = null } = {}) {
  const rows = parseHtmlRows(html);
  const sectionStart = rows.findIndex(row => row.some(cell =>
    normalizeText(cell).includes('precios de tortilla en tortillerias')));
  const sectionEnd = rows.findIndex((row, idx) => idx > sectionStart && row.some(cell =>
    normalizeText(cell).includes('precios de tortilla en autoservicios')));
  const searchEnd = sectionEnd >= 0 ? sectionEnd : rows.length;
  const headerIdx = rows.findIndex((row, idx) =>
    idx > sectionStart && idx < searchEnd && normalizeText(row[0]) === 'ciudad');
  const valueIdx = rows.findIndex((row, idx) =>
    idx > headerIdx && idx < searchEnd && normalizeText(row[0]).includes('nacional ponderado ppp'));
  if (sectionStart < 0 || headerIdx < 0 || valueIdx < 0) {
    const err = new Error('sniim_tortilla_national_row_not_found');
    err.benign = true;
    throw err;
  }

  const headers = rows[headerIdx].slice(1);
  const values = rows[valueIdx].slice(1)
    .map((cell, idx) => ({
      label: headers[idx] || null,
      value: parseNumber(cell),
      dateYmd: tortillaHeaderToYmd(headers[idx], targetYear, targetMonth),
      month: monthFromHeader(headers[idx]),
    }))
    .filter(item => Number.isFinite(item.value));
  const latest = values[values.length - 1];
  if (!latest) {
    const err = new Error('sniim_tortilla_no_prices');
    err.benign = true;
    throw err;
  }

  return {
    value: latest.value,
    unit: 'MXN/kg',
    commodity: 'tortilla',
    market: 'Nacional ponderado PPP',
    dateYmd: latest.dateYmd,
    fecha: latest.label,
    sourceUrl,
  };
}

export async function readSniimAvocadoHassCdmx(cfg = {}) {
  const dateEndYmd = cfg.dateEndYmd || cfg.latestThroughDateYmd;
  const dateStartYmd = cfg.dateStartYmd;
  if (!dateStartYmd || !dateEndYmd) {
    throw new Error('sniim avocado: missing dateStartYmd/dateEndYmd');
  }
  const sourceUrl = buildUrl('/nuevo/consultas/mercadosnacionales/preciosdemercado/agricicolas/ResultadosConsultaFechaFrutasYHortalizas.aspx', {
    Destino: cfg.destino || 'Todos',
    DestinoId: cfg.destinoId ?? -1,
    Origen: cfg.origen || 'Todos',
    OrigenId: cfg.origenId ?? -1,
    PreciosPorId: cfg.preciosPorId ?? 2,
    ProductoId: cfg.productoId ?? 133,
    RegistrosPorPagina: cfg.registrosPorPagina ?? 500,
    fechaInicio: ymdToDmy(dateStartYmd),
    fechaFinal: ymdToDmy(dateEndYmd),
  });
  const html = await fetchText(sourceUrl);
  return parseSniimAvocadoHassCdmx(html, {
    dateEndYmd,
    destinoIncludes: cfg.destinoIncludes || 'Central de Abasto de Iztapalapa',
    sourceUrl,
  });
}

export function parseSniimAvocadoHassCdmx(html, {
  dateEndYmd,
  destinoIncludes = 'Central de Abasto de Iztapalapa',
  sourceUrl = null,
} = {}) {
  const targetDestino = normalizeText(destinoIncludes);
  const rows = parseHtmlRows(html);
  const candidates = rows
    .filter(row => row.length >= 7)
    .map(row => ({
      fecha: row[0],
      dateYmd: dmyToYmd(row[0]),
      presentation: row[1],
      origin: row[2],
      destination: row[3],
      min: parseNumber(row[4]),
      max: parseNumber(row[5]),
      frequent: parseNumber(row[6]),
    }))
    .filter(row => row.dateYmd && (!dateEndYmd || row.dateYmd <= dateEndYmd))
    .filter(row => normalizeText(row.destination).includes(targetDestino))
    .filter(row => Number.isFinite(row.frequent) || (Number.isFinite(row.min) && Number.isFinite(row.max)))
    .sort((a, b) => a.dateYmd.localeCompare(b.dateYmd));

  const latest = candidates[candidates.length - 1];
  if (!latest) {
    const err = new Error('sniim_avocado_cdmx_row_not_found');
    err.benign = true;
    throw err;
  }
  const value = Number.isFinite(latest.frequent)
    ? latest.frequent
    : Number(((latest.min + latest.max) / 2).toFixed(4));

  return {
    value,
    unit: 'MXN/kg',
    commodity: 'aguacate_hass',
    market: latest.destination,
    presentation: latest.presentation,
    origin: latest.origin,
    dateYmd: latest.dateYmd,
    fecha: latest.fecha,
    sourceUrl,
  };
}

export async function readSniimWhiteCornCdmx(cfg = {}) {
  const targetYear = Number(cfg.targetYear);
  const targetMonth = Number(cfg.targetMonth);
  if (!Number.isFinite(targetYear) || !Number.isFinite(targetMonth)) {
    throw new Error('sniim white corn: missing targetYear/targetMonth');
  }
  const marketDestino = cfg.mercadoDestino || 'DF: Central de Abasto de Iztapalapa DF';
  const sourceUrl = buildUrl('/Nuevo/Consultas/MercadosNacionales/PreciosDeMercado/Agricolas/ResultadoConsultaMensualGranos.aspx', {
    Anio: targetYear,
    DestinoId: cfg.destinoId ?? 100,
    MercadoDestino: marketDestino,
    Mes: targetMonth,
    NombreMes: MONTH_NAMES_ES[targetMonth],
  });
  const html = await fetchText(sourceUrl);
  return parseSniimWhiteCornCdmx(html, {
    targetYear,
    targetMonth,
    market: marketDestino,
    sourceUrl,
  });
}

export function parseSniimWhiteCornCdmx(html, {
  targetYear,
  targetMonth,
  market = 'DF: Central de Abasto de Iztapalapa DF',
  sourceUrl = null,
} = {}) {
  const rows = parseHtmlRows(html);
  const row = rows.find(cells => normalizeText(cells[0]) === 'maiz blanco');
  if (!row) {
    const err = new Error('sniim_white_corn_row_not_found');
    err.benign = true;
    throw err;
  }

  const weekly = row.slice(2, 7).map(parseNumber);
  let latestWeek = -1;
  for (let i = weekly.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(weekly[i])) {
      latestWeek = i + 1;
      break;
    }
  }
  if (latestWeek < 0) {
    const err = new Error('sniim_white_corn_no_weekly_prices');
    err.benign = true;
    throw err;
  }

  const valuePerKg = weekly[latestWeek - 1];
  return {
    value: Number((valuePerKg * 1000).toFixed(2)),
    rawValuePerKg: valuePerKg,
    unit: 'MXN/t',
    rawUnit: 'MXN/kg',
    commodity: 'maiz_blanco',
    market,
    origin: row[1] || null,
    targetYear: Number(targetYear),
    targetMonth: Number(targetMonth),
    week: latestWeek,
    sourceUrl,
  };
}

export async function readSniimFoodPrice(cfg = {}) {
  if (cfg.source && cfg.source !== SNIIM_FOOD_PRICE_SOURCE) {
    throw new Error(`unsupported sniim food source: ${cfg.source}`);
  }
  if (cfg.commodity === 'tortilla') return readSniimTortillaNational(cfg);
  if (cfg.commodity === 'aguacate_hass') return readSniimAvocadoHassCdmx(cfg);
  if (cfg.commodity === 'maiz_blanco') return readSniimWhiteCornCdmx(cfg);
  throw new Error(`unsupported sniim food commodity: ${cfg.commodity}`);
}
