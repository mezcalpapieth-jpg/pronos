import {
  dateAtMexicoCityTime,
  formatMexicoDateYmd,
  MEXICO_CITY_TZ,
} from './market-gen/mexico-time.js';

export const GRANJA_VIP_SOURCE = 'granja-vip-official';
export const GRANJA_VIP_DEFAULT_BASE_URL = 'https://www.tvazteca.com/aztecauno/la-granja-vip/';
export const GRANJA_VIP_DEFAULT_SEASON_LABEL = 'Segunda Temporada';

const DEFAULT_CLOSE_HOUR = 19;
const DEFAULT_CLOSE_MINUTE = 55;
const DEFAULT_PARTICIPANTS = [
  'Carlos Trejo',
  'Ivonne Montero',
  'Kenny Avilés',
  'Kevyn Contreras "Bicolor"',
  'Kunno',
  'Rafa Mercadante',
  'Fernando Lozada',
  'María Karunna',
  'Niurka Marcos',
  'Mónica Escobedo',
  'Daniela Alexis "Bebeshita"',
  'Abigail Pak "La Coreañera"',
  'Natalia Alcocer',
  'Manelyk González',
  'Mono Osuna',
  "Azalia 'La Negra'",
  'Julio Camejo',
  'Pascal Nadaud',
  'Pimpinela Escarlata',
];

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(value) {
  return decodeHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeGranjaVipName(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugifyGranjaVipName(value) {
  return normalizeGranjaVipName(value).replace(/\s+/g, '-');
}

function titleFromSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function cleanUrl(url) {
  return String(url || '').split('#')[0].split('?')[0];
}

function getBaseUrl(baseUrl = process.env.GRANJA_VIP_BASE_URL || GRANJA_VIP_DEFAULT_BASE_URL) {
  try {
    const parsed = new URL(baseUrl);
    return parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`;
  } catch {
    return GRANJA_VIP_DEFAULT_BASE_URL;
  }
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(href, getBaseUrl(baseUrl)).toString();
  } catch {
    return null;
  }
}

export function normalizeGranjaVipStatus(value) {
  const text = stripAccents(stripHtml(value)).toUpperCase();
  if (/\bELIMINAD[OA]S?\b/.test(text) || /\bABANDON[OA]\b/.test(text)) {
    return { key: 'eliminado', label: 'Eliminado/a', raw: 'ELIMINADO' };
  }
  if (/\bNOMINAD[OA]S?\b/.test(text)) {
    return { key: 'nominado', label: 'Nominado/a', raw: 'NOMINADO' };
  }
  if (/\bSALVAD[OA]S?\b/.test(text)) {
    return { key: 'salvado', label: 'Salvado/a', raw: 'SALVADO' };
  }
  if (/\bCAPATAZ\b/.test(text)) return { key: 'capataz', label: 'Capataz', raw: 'CAPATAZ' };
  if (/\bPEONES?\b/.test(text)) return { key: 'peon', label: 'Peón', raw: 'PEON' };
  return null;
}

function cleanParticipantName(label, slug = '') {
  const cleaned = stripHtml(label)
    .replace(/\b(?:Granjeros?|La\s+Granja\s+VIP|Segunda\s+Temporada|Ver\s+m[aá]s|Conoce\s+a)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return titleFromSlug(slug);
  if (cleaned.length > 56) return titleFromSlug(slug);
  return cleaned;
}

function sectionBetween(source, startRe, endRe) {
  const startMatch = startRe.exec(source);
  if (!startMatch) return '';
  const start = startMatch.index;
  const rest = source.slice(start + startMatch[0].length);
  const endMatch = endRe.exec(rest);
  const end = endMatch ? start + startMatch[0].length + endMatch.index : source.length;
  return source.slice(start, end);
}

function uniqueParticipants(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const name = typeof row === 'string' ? row : row?.name || row?.label;
    const slug = typeof row === 'object' ? row?.slug : null;
    const normalizedName = String(name || '').trim();
    const normalizedSlug = String(slug || '').trim() || slugifyGranjaVipName(normalizedName);
    if (!normalizedName && !normalizedSlug) continue;
    const key = normalizedSlug.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: normalizedName || titleFromSlug(normalizedSlug),
      slug: normalizedSlug,
      url: typeof row === 'object' ? row?.url || null : null,
      statusKey: typeof row === 'object' ? row?.statusKey || null : null,
      statusLabel: typeof row === 'object' ? row?.statusLabel || null : null,
      rawStatus: typeof row === 'object' ? row?.rawStatus || null : null,
    });
  }
  return out;
}

export function loadGranjaVipParticipants() {
  const json = process.env.GRANJA_VIP_PARTICIPANTS_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      const rows = Array.isArray(parsed) ? uniqueParticipants(parsed) : [];
      if (rows.length) return rows;
    } catch (e) {
      console.warn('[granja-vip] invalid GRANJA_VIP_PARTICIPANTS_JSON', { message: e?.message });
    }
  }

  const csv = process.env.GRANJA_VIP_PARTICIPANTS;
  if (csv) {
    const rows = uniqueParticipants(csv.split(','));
    if (rows.length) return rows;
  }

  return uniqueParticipants(DEFAULT_PARTICIPANTS);
}

function candidateParticipantLinks(html, { baseUrl = GRANJA_VIP_DEFAULT_BASE_URL } = {}) {
  const source = String(html || '');
  const section = sectionBetween(
    source,
    /Granjeros:\s*La\s+Granja\s+VIP\s+Segunda\s+Temporada/i,
    /Conductores|Contenido\s+Exclusivo|En\s+vivo\s+con/i,
  ) || source;
  const rows = [];
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(section))) {
    const href = cleanUrl(match[1]);
    const label = cleanParticipantName(match[2]);
    if (!label || label.length < 2) continue;
    if (/\b(?:en vivo|vota|noticias|conductores|criticos|azteca|google news)\b/i.test(label)) continue;
    rows.push({
      name: label,
      slug: slugifyGranjaVipName(label),
      url: absoluteUrl(href, baseUrl),
      ...statusFields(normalizeGranjaVipStatus(match[0])),
    });
  }

  if (rows.length) return rows;
  const lineRe = /(?:<li[^>]*>|^)\s*(?:<[^>]+>)*([^<\n]{2,64})(?:<\/li>|<br\s*\/?>|\n)/gi;
  while ((match = lineRe.exec(section))) {
    const label = cleanParticipantName(match[1]);
    if (!label || /Granjeros|Conductores|Contenido/i.test(label)) continue;
    rows.push({
      name: label,
      slug: slugifyGranjaVipName(label),
      url: null,
      statusKey: null,
      statusLabel: null,
      rawStatus: null,
    });
  }
  return rows;
}

function statusFields(status) {
  return {
    statusKey: status?.key || null,
    statusLabel: status?.label || null,
    rawStatus: status?.raw || null,
  };
}

function statusPriority(key) {
  if (key === 'eliminado') return 5;
  if (key === 'nominado') return 4;
  if (key === 'salvado') return 3;
  if (key === 'capataz') return 2;
  if (key === 'peon') return 1;
  return 0;
}

function mergeStatus(row, status) {
  if (!status) return row;
  if (statusPriority(row.statusKey) > statusPriority(status.key)) return row;
  return {
    ...row,
    ...statusFields(status),
  };
}

function applyStatusMentions(rows, html) {
  const source = String(html || '');
  const cards = [];
  const anchorRe = /<a\b[^>]*href=["'][^"']+["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(source))) {
    const text = stripHtml(match[1]);
    const status = normalizeGranjaVipStatus(text);
    if (status) cards.push({ text, status });
  }
  return rows.map(row => {
    const name = normalizeGranjaVipName(row.name);
    const hit = cards.find(card => normalizeGranjaVipName(card.text).includes(name));
    return hit ? mergeStatus(row, hit.status) : row;
  });
}

async function fetchFreshText(url, {
  fetchImpl = fetch,
  timeoutMs = 8000,
  cacheBust = true,
} = {}) {
  const target = new URL(url);
  if (cacheBust) target.searchParams.set('_pronos', String(Date.now()));
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  if (timer?.unref) timer.unref();
  try {
    const response = await fetchImpl(target.toString(), {
      redirect: 'follow',
      signal: controller?.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'Pronos La Granja VIP scraper (+https://pronos.io)',
      },
    });
    return {
      ok: Boolean(response?.ok),
      status: Number(response?.status || 0),
      url: target.toString(),
      text: await response.text(),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function extractParticipantsFromOfficialHtml(html, {
  baseUrl = process.env.GRANJA_VIP_BASE_URL || GRANJA_VIP_DEFAULT_BASE_URL,
} = {}) {
  const linked = candidateParticipantLinks(html, { baseUrl });
  const rows = uniqueParticipants(linked);
  return applyStatusMentions(rows, html);
}

export async function readGranjaVipOfficialSnapshot({
  fetchImpl = fetch,
  baseUrl = process.env.GRANJA_VIP_BASE_URL || GRANJA_VIP_DEFAULT_BASE_URL,
  now = new Date(),
} = {}) {
  const sourceUrl = getBaseUrl(baseUrl);
  let discovered = [];
  let fetchError = null;
  try {
    const response = await fetchFreshText(sourceUrl, { fetchImpl, cacheBust: true });
    if (!response.ok) throw new Error(`http_${response.status}`);
    discovered = extractParticipantsFromOfficialHtml(response.text, { baseUrl: sourceUrl });
  } catch (e) {
    fetchError = e?.message || 'fetch_failed';
  }

  const fallback = loadGranjaVipParticipants();
  const rows = uniqueParticipants(discovered.length >= 6 ? discovered : fallback);
  const nominated = rows.filter(row => row.statusKey === 'nominado');
  const eliminated = rows.filter(row => row.statusKey === 'eliminado');
  const peones = rows.filter(row => row.statusKey === 'peon');
  const active = rows.filter(row => row.statusKey !== 'eliminado');

  return {
    source: GRANJA_VIP_SOURCE,
    sourceUrl,
    observedAt: now.toISOString(),
    timeZone: MEXICO_CITY_TZ,
    ok: rows.length >= 6,
    parsedCount: rows.filter(row => row.statusKey).length,
    total: rows.length,
    rows,
    active,
    nominated,
    eliminated,
    peones,
    error: rows.length >= 6 ? fetchError : (fetchError || 'granja_vip_roster_parse_failed'),
  };
}

function mexicoDateTimeParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: MEXICO_CITY_TZ,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday],
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function addDaysLocal({ year, month, day }, days) {
  const next = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function nextGranjaVipSundayClose(now = new Date(), {
  hour = Number(process.env.GRANJA_VIP_CLOSE_HOUR ?? DEFAULT_CLOSE_HOUR),
  minute = Number(process.env.GRANJA_VIP_CLOSE_MINUTE ?? DEFAULT_CLOSE_MINUTE),
} = {}) {
  const closeHour = Number.isFinite(hour) ? hour : DEFAULT_CLOSE_HOUR;
  const closeMinute = Number.isFinite(minute) ? minute : DEFAULT_CLOSE_MINUTE;
  const local = mexicoDateTimeParts(now);
  let daysAhead = (7 - local.weekday) % 7;
  const alreadyPastToday = daysAhead === 0
    && (local.hour > closeHour || (local.hour === closeHour && local.minute >= closeMinute));
  if (alreadyPastToday) daysAhead = 7;
  const target = addDaysLocal(local, daysAhead);
  return dateAtMexicoCityTime({
    ...target,
    hour: closeHour,
    minute: closeMinute,
    second: 0,
  });
}

function compactRows(rows = []) {
  return rows.map(row => ({
    name: row.name,
    slug: row.slug,
    statusKey: row.statusKey,
    statusLabel: row.statusLabel,
    url: row.url,
  }));
}

export function buildGranjaVipWeeklyMarketSpec({
  snapshot,
  now = new Date(),
  seedLiquidity = 1000,
  seasonLabel = process.env.GRANJA_VIP_SEASON_LABEL || GRANJA_VIP_DEFAULT_SEASON_LABEL,
} = {}) {
  if (!snapshot?.ok || !Array.isArray(snapshot.nominated) || snapshot.nominated.length < 2) return null;
  const closeHour = Number(process.env.GRANJA_VIP_CLOSE_HOUR ?? DEFAULT_CLOSE_HOUR);
  const closeMinute = Number(process.env.GRANJA_VIP_CLOSE_MINUTE ?? DEFAULT_CLOSE_MINUTE);
  const close = nextGranjaVipSundayClose(now, { hour: closeHour, minute: closeMinute });
  const weekKey = formatMexicoDateYmd(close);
  const sourceEventId = `granja-vip-elimination:${weekKey}`;
  const outcomes = snapshot.nominated.map(row => row.name).filter(Boolean);
  const evidence = [
    { title: 'La Granja VIP · TV Azteca', url: snapshot.sourceUrl },
    ...snapshot.nominated.map(row => ({
      title: `${row.name} · ${row.statusLabel || 'Nominado/a'}`,
      url: row.url || snapshot.sourceUrl,
    })),
  ];

  return {
    source: GRANJA_VIP_SOURCE,
    source_event_id: sourceEventId,
    question: '¿Quién sale de La Granja VIP esta semana?',
    category: 'musica',
    icon: null,
    outcomes,
    seed_liquidity: seedLiquidity,
    start_time: now.toISOString(),
    end_time: close.toISOString(),
    amm_mode: 'parallel',
    resolver_type: 'manual_review',
    resolver_config: {
      source: GRANJA_VIP_SOURCE,
      sourceEventId,
      suggestedOutcomeIndex: null,
      confidenceBps: 0,
      criteria: 'Resolver con el resultado oficial de la Gala de Eliminación de La Granja VIP. Si TV Azteca marca claramente al eliminado dentro de las opciones, confirmar esa opción; si hay abandono o cambio de nominados antes de la gala, revisar manualmente o anular según corresponda.',
      evidence,
      sourceUrls: evidence.map(item => item.url).filter(Boolean),
      evidenceUrl: snapshot.sourceUrl,
      timezone: MEXICO_CITY_TZ,
      staleReadPolicy: 'Usar lectura fresca de TV Azteca; no pagar automáticamente si no hay etiqueta oficial clara.',
    },
    source_data: {
      kind: 'granja_vip_week',
      showLabel: 'La Granja VIP',
      seasonLabel,
      weekKey,
      closeLocalTime: `domingo ${String(closeHour).padStart(2, '0')}:${String(closeMinute).padStart(2, '0')} ${MEXICO_CITY_TZ}`,
      snapshot: {
        sourceUrl: snapshot.sourceUrl,
        observedAt: snapshot.observedAt,
        parsedCount: snapshot.parsedCount,
        total: snapshot.total,
        rows: compactRows(snapshot.rows),
      },
      categorization: {
        geoTags: ['mexico'],
        topicTags: ['tv', 'farandula'],
      },
    },
    category_tags: ['musica'],
    geo_tags: ['mexico'],
    topic_tags: ['tv', 'farandula'],
  };
}

export const _internal = {
  DEFAULT_PARTICIPANTS,
  compactRows,
  getBaseUrl,
  statusPriority,
  stripHtml,
};
