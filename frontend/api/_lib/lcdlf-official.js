import {
  dateAtMexicoCityTime,
  formatMexicoDateYmd,
  MEXICO_CITY_TZ,
} from './market-gen/mexico-time.js';

export const LCDLF_SOURCE = 'lcdlf-official';
export const LCDLF_DEFAULT_BASE_URL = 'https://www.lacasadelosfamososmexico.tv';
export const LCDLF_DEFAULT_SEASON_LABEL = 'Temporada 4';

// Sunday elimination voting reopens at 20:00 CDMX during the pregala, before
// the 20:30 main gala, so close markets before that broadcast window starts.
const DEFAULT_CLOSE_HOUR = 19;
const DEFAULT_CLOSE_MINUTE = 55;
const DEFAULT_NOMINATION_CLOSE_WEEKDAY = 3; // Wednesday in Mexico City.
// The nomination gala starts at 22:00 CDMX, so default markets close before
// partial nomination information starts becoming public during the broadcast.
const DEFAULT_NOMINATION_CLOSE_HOUR = 21;
const DEFAULT_NOMINATION_CLOSE_MINUTE = 55;

const DEFAULT_RESIDENTS = [
  'Aldo Rendón',
  'Arantza Ruiz',
  'Brianda Deyanara',
  'Cynthia Klitbo',
  'Ernesto Laguardia',
  'Ese Pérez',
  'Fede Vigevani',
  'Flor Vigna',
  'Gema Garoa',
  'Karina Torres',
  'Luis Chaparro',
  'Mariana Ochoa',
  'Masad Altamimi',
  'Memo Schutz',
  'Moisés Peñaloza',
  'Ximena Herrera',
  'Yahir',
  'Yanet García',
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

function cleanUrl(url) {
  return String(url || '').split('#')[0].split('?')[0];
}

export function normalizeLcdlfName(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugifyLcdlfResidentName(value) {
  return normalizeLcdlfName(value).replace(/\s+/g, '-');
}

function titleFromSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getBaseUrl(baseUrl = process.env.LCDLF_BASE_URL || LCDLF_DEFAULT_BASE_URL) {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return LCDLF_DEFAULT_BASE_URL;
  }
}

function lcdlfStatusFromKey(key, rawFallback = '') {
  const normalized = String(key || '').trim().toLowerCase();
  if (normalized === 'eliminado') return { key: 'eliminado', label: 'Eliminado/a', raw: rawFallback || 'ELIMINADO' };
  if (normalized === 'nominado') return { key: 'nominado', label: 'Nominado/a', raw: rawFallback || 'NOMINADO' };
  if (normalized === 'lider_semana') return { key: 'lider_semana', label: 'Líder de la semana', raw: rawFallback || 'LIDER DE LA SEMANA' };
  if (normalized === 'en_casa') return { key: 'en_casa', label: 'En casa', raw: rawFallback || 'EN CASA' };
  return null;
}

function statusFromResidentEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const keyed = lcdlfStatusFromKey(entry.statusKey, entry.rawStatus || entry.statusLabel);
  if (keyed) return keyed;
  return normalizeLcdlfStatus(entry.rawStatus || entry.statusLabel || entry.status || '');
}

function normalizeResidentEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const name = entry.trim();
    if (!name) return null;
    return { name, slug: slugifyLcdlfResidentName(name) };
  }
  if (typeof entry === 'object') {
    const name = String(entry.name || entry.label || '').trim();
    const slug = String(entry.slug || '').trim() || (name ? slugifyLcdlfResidentName(name) : '');
    if (!name && !slug) return null;
    const status = statusFromResidentEntry(entry);
    return {
      name: name || titleFromSlug(slug),
      slug,
      url: entry.url || null,
      statusKey: status?.key || null,
      statusLabel: status?.label || null,
      rawStatus: status?.raw || null,
    };
  }
  return null;
}

function uniqueResidents(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const normalized = normalizeResidentEntry(row);
    if (!normalized?.slug) continue;
    const key = normalized.slug.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function loadLcdlfResidents() {
  const json = process.env.LCDLF_RESIDENTS_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        const rows = uniqueResidents(parsed);
        if (rows.length) return rows;
      }
    } catch (e) {
      console.warn('[lcdlf] invalid LCDLF_RESIDENTS_JSON', { message: e?.message });
    }
  }

  const csv = process.env.LCDLF_RESIDENTS;
  if (csv) {
    const rows = uniqueResidents(csv.split(','));
    if (rows.length) return rows;
  }

  return uniqueResidents(DEFAULT_RESIDENTS);
}

export function residentUrl(resident, { baseUrl = process.env.LCDLF_BASE_URL || LCDLF_DEFAULT_BASE_URL } = {}) {
  const base = getBaseUrl(baseUrl);
  const slug = String(resident?.slug || slugifyLcdlfResidentName(resident?.name || '')).trim();
  return `${base}/habitantes/${slug}`;
}

export function normalizeLcdlfStatus(value) {
  const text = stripAccents(stripHtml(value)).toUpperCase();
  if (/\bPODRIA\s+ESTAR\s+ELIMINAD[OA]\b/.test(text)) {
    return { key: 'nominado', label: 'Podría estar eliminado/a', raw: 'PODRIA ESTAR ELIMINADO' };
  }
  if (/\bELIMINAD[OA]\b/.test(text)) return { key: 'eliminado', label: 'Eliminado/a', raw: 'ELIMINADO' };
  if (/\bNOMINAD[OA]\b/.test(text)) return { key: 'nominado', label: 'Nominado/a', raw: 'NOMINADO' };
  if (/\bLIDER\s+DE\s+LA\s+SEMANA\b/.test(text)) return { key: 'lider_semana', label: 'Líder de la semana', raw: 'LIDER DE LA SEMANA' };
  if (/\bEN\s+CASA\b/.test(text)) return { key: 'en_casa', label: 'En casa', raw: 'EN CASA' };
  return null;
}

function findResidentHeroHtml(html, resident) {
  const source = String(html || '');
  const normalized = normalizeResidentEntry(resident);
  if (!normalized) return '';
  const slug = escapeRegExp(normalized.slug);
  const h1SlugRe = slug
    ? new RegExp(`<h1\\b[\\s\\S]{0,2200}?/habitantes/${slug}\\b`, 'i')
    : null;
  const h1Match = h1SlugRe ? h1SlugRe.exec(source) : null;
  let anchorIndex = h1Match?.index ?? -1;

  if (anchorIndex < 0 && slug) {
    const slugRe = new RegExp(`/habitantes/${slug}\\b`, 'gi');
    let match;
    while ((match = slugRe.exec(source))) {
      const before = source.slice(Math.max(0, match.index - 1800), match.index);
      if (/<h1\b/i.test(before)) {
        anchorIndex = match.index;
        break;
      }
    }
  }

  if (anchorIndex < 0) return '';
  const start = Math.max(0, anchorIndex - 4500);
  let end = Math.min(source.length, anchorIndex + 1600);
  const after = source.slice(anchorIndex + 1, end);
  const nextSection = after.search(/<section\b/i);
  if (nextSection >= 0) end = anchorIndex + 1 + nextSection;
  return source.slice(start, end);
}

export function parseLcdlfResidentStatus(html, resident = null) {
  if (!resident) return normalizeLcdlfStatus(html);
  const source = String(html || '');
  const hero = findResidentHeroHtml(html, resident);
  if (!hero) return source.length <= 12000 ? normalizeLcdlfStatus(source) : null;
  return normalizeLcdlfStatus(hero);
}

function cleanResidentCardName(label, slug) {
  const cleaned = stripHtml(label)
    .replace(/\b(?:PODR[IÍ]A\s+ESTAR\s+ELIMINAD[OA]|ELIMINAD[OA]|NOMINAD[OA]|L[IÍ]DER\s+DE\s+LA\s+SEMANA|EN\s+CASA)\b/gi, ' ')
    .replace(/\bVer\s+m[aá]s\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return titleFromSlug(slug);
  if (cleaned.length > 42 || /\b(?:actor|actriz|cantante|influencer|conductor|conductora|creador|creadora)\b/i.test(cleaned)) {
    return titleFromSlug(slug);
  }
  return cleaned;
}

function nearbyCardTitle(source, anchorIndex) {
  const start = Math.max(0, anchorIndex - 1800);
  const chunk = source.slice(start, anchorIndex);
  const matches = [...chunk.matchAll(/data-card-title=["']([^"']+)["']/gi)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  return {
    title: stripHtml(last[1]),
    index: start + last.index,
  };
}

function cardHtmlForAnchor(source, anchorIndex, titleInfo) {
  const start = titleInfo?.index != null
    ? Math.max(0, source.lastIndexOf('<', titleInfo.index))
    : Math.max(0, anchorIndex - 900);
  const after = source.slice(anchorIndex + 1);
  const nextCard = after.search(/\bdata-card-title=["']/i);
  const end = nextCard >= 0
    ? anchorIndex + 1 + nextCard
    : Math.min(source.length, anchorIndex + 5000);
  return source.slice(start, end);
}

export function extractResidentsFromIndexHtml(html, {
  baseUrl = process.env.LCDLF_BASE_URL || LCDLF_DEFAULT_BASE_URL,
} = {}) {
  const residents = [];
  const base = getBaseUrl(baseUrl);
  const source = String(html || '');
  const anchorRe = /<a\b[^>]*href=["']([^"']*\/habitantes\/([^"'/#?]+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(source))) {
    const slug = cleanUrl(match[2]).replace(/^\/+|\/+$/g, '');
    const cardTitle = nearbyCardTitle(source, match.index);
    const cardHtml = cardHtmlForAnchor(source, match.index, cardTitle);
    const status = normalizeLcdlfStatus(cardHtml);
    const label = cardTitle?.title || cleanResidentCardName(match[3], slug);
    residents.push({
      name: label || titleFromSlug(slug),
      slug,
      url: match[1].startsWith('http') ? cleanUrl(match[1]) : `${base}${cleanUrl(match[1]).startsWith('/') ? '' : '/'}${cleanUrl(match[1])}`,
      statusKey: status?.key || null,
      statusLabel: status?.label || null,
      rawStatus: status?.raw || null,
    });
  }
  return uniqueResidents(residents);
}

async function fetchFreshText(url, {
  fetchImpl = fetch,
  timeoutMs = 8000,
  cacheBust = true,
} = {}) {
  const target = new URL(url);
  if (cacheBust) target.searchParams.set('_pronos', String(Date.now()));
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  if (timer?.unref) timer.unref();
  try {
    const response = await fetchImpl(target.toString(), {
      redirect: 'follow',
      signal: controller?.signal,
      headers: {
        'accept': 'text/html,application/xhtml+xml',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'user-agent': 'Pronos LCDLF resolver (+https://pronos.io)',
      },
    });
    const text = await response.text();
    return {
      ok: Boolean(response.ok),
      status: Number(response.status || 0),
      url: target.toString(),
      text,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function discoverResidents({ fetchImpl, baseUrl, now }) {
  if (process.env.LCDLF_DISCOVER_RESIDENTS === 'false') return [];
  try {
    const home = await fetchFreshText(getBaseUrl(baseUrl), { fetchImpl, cacheBust: true });
    if (!home.ok) return [];
    const rows = extractResidentsFromIndexHtml(home.text, { baseUrl });
    return rows.length >= 6 ? rows : [];
  } catch (e) {
    console.warn('[lcdlf] resident discovery failed', {
      message: e?.message,
      observedAt: now.toISOString(),
    });
    return [];
  }
}

export async function fetchLcdlfResidentStatus(resident, {
  fetchImpl = fetch,
  baseUrl = process.env.LCDLF_BASE_URL || LCDLF_DEFAULT_BASE_URL,
  now = new Date(),
} = {}) {
  const normalized = normalizeResidentEntry(resident);
  if (!normalized) return null;
  const url = resident?.url || residentUrl(normalized, { baseUrl });
  try {
    const response = await fetchFreshText(url, { fetchImpl, cacheBust: true });
    const parsed = response.ok ? parseLcdlfResidentStatus(response.text, normalized) : null;
    const status = parsed || (response.ok ? statusFromResidentEntry(normalized) : null);
    return {
      name: normalized.name,
      slug: normalized.slug,
      url,
      ok: response.ok,
      httpStatus: response.status,
      statusKey: status?.key || null,
      statusLabel: status?.label || null,
      rawStatus: status?.raw || null,
      checkedAt: now.toISOString(),
    };
  } catch (e) {
    return {
      name: normalized.name,
      slug: normalized.slug,
      url,
      ok: false,
      httpStatus: 0,
      statusKey: null,
      statusLabel: null,
      rawStatus: null,
      checkedAt: now.toISOString(),
      error: e?.message || 'fetch_failed',
    };
  }
}

export async function readLcdlfOfficialSnapshot({
  fetchImpl = fetch,
  residents = null,
  baseUrl = process.env.LCDLF_BASE_URL || LCDLF_DEFAULT_BASE_URL,
  now = new Date(),
} = {}) {
  const configured = residents ? uniqueResidents(residents) : loadLcdlfResidents();
  const discovered = residents ? [] : await discoverResidents({ fetchImpl, baseUrl, now });
  const roster = residents
    ? configured
    : uniqueResidents(discovered.length >= 6 ? [...discovered, ...configured] : configured);
  const checks = await Promise.allSettled(
    roster.map(row => fetchLcdlfResidentStatus(row, { fetchImpl, baseUrl, now })),
  );
  const rows = checks
    .map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      const fallback = roster[index];
      return {
        name: fallback?.name || `Habitante ${index + 1}`,
        slug: fallback?.slug || null,
        url: fallback ? residentUrl(fallback, { baseUrl }) : null,
        ok: false,
        httpStatus: 0,
        statusKey: null,
        statusLabel: null,
        rawStatus: null,
        checkedAt: now.toISOString(),
        error: result.reason?.message || 'fetch_failed',
      };
    })
    .filter(Boolean);

  const parsedCount = rows.filter(row => row.statusKey).length;
  const nominated = rows.filter(row => row.statusKey === 'nominado');
  const eliminated = rows.filter(row => row.statusKey === 'eliminado');
  const active = rows.filter(row => (
    row.statusKey !== 'eliminado'
    && (row.ok || row.statusKey)
    && (!row.statusKey || ['en_casa', 'nominado', 'lider_semana'].includes(row.statusKey))
  ));
  const usable = parsedCount >= 1;

  return {
    source: LCDLF_SOURCE,
    sourceUrl: getBaseUrl(baseUrl),
    observedAt: now.toISOString(),
    timeZone: MEXICO_CITY_TZ,
    ok: usable,
    parsedCount,
    total: rows.length,
    rows,
    active,
    nominated,
    eliminated,
    error: usable ? null : 'lcdlf_status_parse_failed',
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
    second: Number(parts.second),
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

export function nextLcdlfSundayClose(now = new Date(), {
  hour = Number(process.env.LCDLF_CLOSE_HOUR ?? DEFAULT_CLOSE_HOUR),
  minute = Number(process.env.LCDLF_CLOSE_MINUTE ?? DEFAULT_CLOSE_MINUTE),
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

export function nextLcdlfNominationClose(now = new Date(), {
  weekday = Number(process.env.LCDLF_NOMINATION_CLOSE_WEEKDAY ?? DEFAULT_NOMINATION_CLOSE_WEEKDAY),
  hour = Number(process.env.LCDLF_NOMINATION_CLOSE_HOUR ?? DEFAULT_NOMINATION_CLOSE_HOUR),
  minute = Number(process.env.LCDLF_NOMINATION_CLOSE_MINUTE ?? DEFAULT_NOMINATION_CLOSE_MINUTE),
} = {}) {
  const closeWeekday = Number.isFinite(weekday) && weekday >= 0 && weekday <= 6
    ? weekday
    : DEFAULT_NOMINATION_CLOSE_WEEKDAY;
  const closeHour = Number.isFinite(hour) ? hour : DEFAULT_NOMINATION_CLOSE_HOUR;
  const closeMinute = Number.isFinite(minute) ? minute : DEFAULT_NOMINATION_CLOSE_MINUTE;
  const local = mexicoDateTimeParts(now);
  let daysAhead = (closeWeekday - local.weekday + 7) % 7;
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

export function buildLcdlfWeeklyMarketSpec({
  snapshot,
  now = new Date(),
  seedLiquidity = 1000,
  seasonLabel = process.env.LCDLF_SEASON_LABEL || LCDLF_DEFAULT_SEASON_LABEL,
} = {}) {
  if (!snapshot?.ok || !Array.isArray(snapshot.nominated) || snapshot.nominated.length < 2) return null;
  const closeHour = Number(process.env.LCDLF_CLOSE_HOUR ?? DEFAULT_CLOSE_HOUR);
  const closeMinute = Number(process.env.LCDLF_CLOSE_MINUTE ?? DEFAULT_CLOSE_MINUTE);
  const close = nextLcdlfSundayClose(now, { hour: closeHour, minute: closeMinute });
  const weekKey = formatMexicoDateYmd(close);
  const sourceEventId = `lcdlf-mx-elimination:${weekKey}`;
  const outcomes = snapshot.nominated.map(row => row.name).filter(Boolean);
  const evidence = [
    { title: 'La Casa de los Famosos México', url: snapshot.sourceUrl },
    ...snapshot.nominated.map(row => ({
      title: `${row.name} · ${row.statusLabel || 'Nominado/a'}`,
      url: row.url,
    })),
  ];

  return {
    source: LCDLF_SOURCE,
    source_event_id: sourceEventId,
    question: `¿Quién sale de La Casa de los Famosos México esta semana?`,
    category: 'musica',
    icon: null,
    outcomes,
    seed_liquidity: seedLiquidity,
    end_time: close.toISOString(),
    amm_mode: 'parallel',
    resolver_type: 'api_lcdlf',
    resolver_config: {
      source: LCDLF_SOURCE,
      sourceEventId,
      shape: 'parallel-status',
      statusKey: 'eliminado',
      yesOutcome: 0,
      noOutcome: 1,
      closeOnStatus: false,
      statusMinStatusCount: 1,
      legs: snapshot.nominated.map(row => ({
        label: row.name,
        residentName: row.name,
        residentSlug: row.slug,
        statusKey: 'eliminado',
        evidenceUrl: row.url || snapshot.sourceUrl,
      })),
      criteria: 'Cada nominado se resuelve de forma independiente: Sí si el sitio oficial marca a esa persona como Eliminado/a esta semana. Cuando el eliminado oficial aparezca, los demás nominados se resuelven No. Si no hay una marca clara, el resolver difiere.',
      evidence,
      sourceUrls: evidence.map(item => item.url).filter(Boolean),
      evidenceUrl: snapshot.sourceUrl,
      timezone: MEXICO_CITY_TZ,
      staleReadPolicy: 'Usar lectura fresca del sitio oficial; si el eliminado no se puede leer, diferir o enviar a revisión manual.',
    },
    source_data: {
      kind: 'lcdlf_week',
      eliminationMarketShape: 'parallel-status',
      showLabel: 'La Casa de los Famosos México',
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
        topicTags: ['tv', 'farandula'],
      },
    },
    topic_tags: ['tv', 'farandula'],
  };
}

export function buildLcdlfNominationMarketSpecs({
  snapshot,
  now = new Date(),
  seedLiquidity = 1000,
  seasonLabel = process.env.LCDLF_SEASON_LABEL || LCDLF_DEFAULT_SEASON_LABEL,
} = {}) {
  if (!snapshot?.ok || !Array.isArray(snapshot.active) || snapshot.active.length < 2) return [];

  const activeRows = snapshot.active
    .filter(row => row?.name && row?.slug && row.statusKey !== 'eliminado');
  if (activeRows.length < 2) return [];

  const closeHour = Number(process.env.LCDLF_NOMINATION_CLOSE_HOUR ?? DEFAULT_NOMINATION_CLOSE_HOUR);
  const closeMinute = Number(process.env.LCDLF_NOMINATION_CLOSE_MINUTE ?? DEFAULT_NOMINATION_CLOSE_MINUTE);
  const closeWeekday = Number(process.env.LCDLF_NOMINATION_CLOSE_WEEKDAY ?? DEFAULT_NOMINATION_CLOSE_WEEKDAY);
  const close = nextLcdlfNominationClose(now, {
    weekday: closeWeekday,
    hour: closeHour,
    minute: closeMinute,
  });
  const weekKey = formatMexicoDateYmd(close);
  const baseEvidence = [
    { title: 'La Casa de los Famosos México', url: snapshot.sourceUrl },
  ];
  const sourceEventId = `lcdlf-mx-nomination:${weekKey}`;
  const evidence = [
    ...baseEvidence,
    ...activeRows.map(row => ({
      title: `${row.name} · ${row.statusLabel || 'En casa'}`,
      url: row.url,
    })),
  ].filter(item => item.url);
  const outcomes = activeRows.map(row => row.name);
  const legProbabilities = activeRows.map(() => 0.32);

  return [{
    source: LCDLF_SOURCE,
    source_event_id: sourceEventId,
    question: `¿Quién quedará nominado/a en La Casa de los Famosos México esta semana?`,
    category: 'musica',
    icon: null,
    outcomes,
    seed_liquidity: seedLiquidity,
    start_time: now.toISOString(),
    end_time: close.toISOString(),
    amm_mode: 'parallel',
    resolver_type: 'api_lcdlf',
    resolver_config: {
      source: LCDLF_SOURCE,
      sourceEventId,
      shape: 'parallel-status',
      statusKey: 'nominado',
      yesOutcome: 0,
      noOutcome: 1,
      closeOnStatus: false,
      statusMinStatusCount: 2,
      nominationMinStatusCount: 2,
      legs: activeRows.map(row => ({
        label: row.name,
        residentName: row.name,
        residentSlug: row.slug,
        statusKey: 'nominado',
        evidenceUrl: row.url || snapshot.sourceUrl,
      })),
      criteria: 'Cada participante se resuelve de forma independiente: Sí si el sitio oficial marca a esa persona como Nominado/a o con la frase "podría estar eliminado/a" esta semana. Cuando la ronda oficial de nominación esté publicada, las personas sin esa etiqueta se resuelven No.',
      evidence,
      sourceUrls: evidence.map(item => item.url).filter(Boolean),
      evidenceUrl: snapshot.sourceUrl,
      timezone: MEXICO_CITY_TZ,
      staleReadPolicy: 'Usar lectura fresca del sitio oficial; si el estado no se puede leer, diferir o enviar a revisión manual.',
    },
    source_data: {
      kind: 'lcdlf_nomination',
      nominationMarketShape: 'parallel-status',
      showLabel: 'La Casa de los Famosos México',
      seasonLabel,
      weekKey,
      residents: compactRows(activeRows),
      closeLocalTime: `miércoles ${String(closeHour).padStart(2, '0')}:${String(closeMinute).padStart(2, '0')} ${MEXICO_CITY_TZ}`,
      snapshot: {
        sourceUrl: snapshot.sourceUrl,
        observedAt: snapshot.observedAt,
        parsedCount: snapshot.parsedCount,
        total: snapshot.total,
        rows: compactRows(snapshot.rows),
      },
      suggestedPricing: {
        legProbabilities,
        legProbabilityPct: legProbabilities.map(p => Math.round(p * 1000) / 10),
      },
      categorization: {
        topicTags: ['tv', 'farandula'],
      },
    },
    topic_tags: ['tv', 'farandula'],
  }];
}

function outcomeIndexForName(outcomes = [], name) {
  const target = normalizeLcdlfName(name);
  if (!target) return -1;
  return outcomes.findIndex(label => normalizeLcdlfName(label) === target);
}

export function isLcdlfMarket({ cfg, row, sourceData } = {}) {
  const source = String(row?.source || cfg?.source || sourceData?.source || '').trim().toLowerCase();
  const kind = String(sourceData?.kind || '').trim().toLowerCase();
  return source === LCDLF_SOURCE || kind === 'lcdlf_week' || kind === 'lcdlf_nomination';
}

export async function buildLcdlfResolutionReview({
  market,
  cfg,
  sourceData,
  outcomes,
  snapshot = null,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const observed = snapshot || await readLcdlfOfficialSnapshot({ fetchImpl, now });
  const labels = Array.isArray(outcomes) ? outcomes : [];
  const matches = [];
  for (const row of observed.eliminated || []) {
    const index = outcomeIndexForName(labels, row.name);
    if (index >= 0) matches.push({ row, index });
  }

  const sourceEventId = cfg?.sourceEventId || market?.source_event_id || sourceData?.weekKey || String(market?.id || '');
  const basePatch = {
    source: LCDLF_SOURCE,
    sourceEventId,
    evidence: [
      { title: 'La Casa de los Famosos México', url: observed.sourceUrl },
      ...compactRows(observed.rows)
        .filter(row => row.url)
        .slice(0, 12)
        .map(row => ({
          title: `${row.name} · ${row.statusLabel || row.statusKey || 'sin etiqueta'}`,
          url: row.url,
        })),
    ],
    sourceUrls: [observed.sourceUrl],
  };

  if (matches.length === 1) {
    const { row, index } = matches[0];
    return {
      resolverConfigPatch: {
        ...basePatch,
        suggestedOutcomeIndex: index,
        confidenceBps: 8500,
        finalScore: `${row.name} eliminado/a`,
        evidenceUrl: row.url || observed.sourceUrl,
        rationale: `El sitio oficial marca a ${row.name} como eliminado/a. Admin debe confirmar la lectura antes de pagar MXNP.`,
      },
      sourceDataPatch: {
        lcdlfLastSnapshot: {
          observedAt: observed.observedAt,
          parsedCount: observed.parsedCount,
          rows: compactRows(observed.rows),
        },
      },
    };
  }

  const reason = matches.length > 1
    ? 'El sitio oficial devolvió más de un eliminado dentro de las opciones del mercado.'
    : 'El sitio oficial todavía no marcó como eliminado/a a ninguna opción de este mercado.';
  return {
    resolverConfigPatch: {
      ...basePatch,
      suggestedOutcomeIndex: null,
      confidenceBps: 0,
      finalScore: null,
      evidenceUrl: observed.sourceUrl,
      rationale: `${reason} Requiere revisión manual antes de pagar MXNP.`,
    },
    sourceDataPatch: {
      lcdlfLastSnapshot: {
        observedAt: observed.observedAt,
        parsedCount: observed.parsedCount,
        rows: compactRows(observed.rows),
      },
    },
  };
}

export const _internal = {
  DEFAULT_RESIDENTS,
  compactRows,
  extractResidentsFromIndexHtml,
  getBaseUrl,
  stripHtml,
};
