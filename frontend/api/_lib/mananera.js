export const MANANERA_TRANSCRIPT_SOURCE = 'gob-mx-presidencia-transcript';
export const MANANERA_OFFICIAL_BASE_URL = 'https://www.gob.mx/presidencia';
export const MANANERA_SEARCH_BASE_URL = 'https://www.gob.mx/busqueda';

const MONTHS_ES = {
  enero: '01',
  febrero: '02',
  marzo: '03',
  abril: '04',
  mayo: '05',
  junio: '06',
  julio: '07',
  agosto: '08',
  septiembre: '09',
  setiembre: '09',
  octubre: '10',
  noviembre: '11',
  diciembre: '12',
};

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    });
}

function stripHtml(html) {
  return decodeHtmlEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|section|article|tr|td|th)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTranscriptText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countPhraseOccurrences(text, phrase) {
  const needle = normalizeTranscriptText(phrase);
  let haystack = normalizeTranscriptText(text);
  if (!haystack || !needle) return 0;

  if (needle === 'estados unidos') {
    haystack = haystack.replace(/\bestados\s+unidos\s+mexicanos\b/g, ' ');
  }

  const pattern = escapeRegExp(needle).replace(/\s+/g, '\\s+');
  const re = new RegExp(`(^|[^a-z0-9])${pattern}(?=$|[^a-z0-9])`, 'g');
  let count = 0;
  while (re.exec(haystack)) count += 1;
  return count;
}

export function compareTranscriptCount(count, op, threshold) {
  const observed = Number(count);
  const target = Number(threshold);
  if (!Number.isFinite(observed) || !Number.isFinite(target)) return false;
  switch (op) {
    case 'gt': return observed > target;
    case 'gte': return observed >= target;
    case 'lt': return observed < target;
    case 'lte': return observed <= target;
    case 'eq': return observed === target;
    default: throw new Error(`unsupported transcript count op: ${op}`);
  }
}

export function formatSpanishLongDate(dateYmd) {
  const [year, month, day] = String(dateYmd || '').split('-');
  const monthName = Object.keys(MONTHS_ES).find(name => MONTHS_ES[name] === month) || month;
  return `${Number(day)} de ${monthName} de ${year}`;
}

function dateSearchTokens(dateYmd) {
  const [year, month, day] = String(dateYmd || '').split('-');
  const monthName = Object.keys(MONTHS_ES).find(name => MONTHS_ES[name] === month);
  return [
    String(dateYmd || '').toLowerCase(),
    `${Number(day)} de ${monthName} de ${year}`,
    `${String(day).padStart(2, '0')} de ${monthName} de ${year}`,
  ].filter(Boolean);
}

export function buildMananeraSearchUrl(dateYmd) {
  const q = `site:gob.mx/presidencia versión estenográfica conferencia de prensa presidenta ${formatSpanishLongDate(dateYmd)}`;
  return `${MANANERA_SEARCH_BASE_URL}?q=${encodeURIComponent(q)}`;
}

function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim() : null;
}

function candidateUrlsFromSearchHtml(html) {
  const out = [];
  const seen = new Set();
  const re = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(String(html || '')))) {
    let href = decodeHtmlEntities(match[1]).trim();
    if (!href) continue;
    if (href.startsWith('/')) href = `https://www.gob.mx${href}`;
    if (!/^https:\/\/www\.gob\.mx\/presidencia\//i.test(href)) continue;
    if (!/version-estenografica/i.test(href)) continue;
    href = href.split('#')[0];
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out.slice(0, 8);
}

function transcriptMatchesDate({ text, html, dateYmd }) {
  const normalized = normalizeTranscriptText(`${extractTitle(html) || ''} ${text}`);
  return dateSearchTokens(dateYmd)
    .map(normalizeTranscriptText)
    .some(token => token && normalized.includes(token));
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': 'Pronos resolver (+https://pronos.io)',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response?.ok) {
    const err = new Error(`transcript_fetch_failed_${response?.status || 'unknown'}`);
    err.status = response?.status || null;
    throw err;
  }
  return response.text();
}

export async function findMananeraTranscript({
  dateYmd,
  transcriptUrl = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!dateYmd) throw new Error('mananera: missing dateYmd');
  if (typeof fetchImpl !== 'function') throw new Error('mananera: fetch unavailable');

  const searchUrl = buildMananeraSearchUrl(dateYmd);
  const urls = [];
  if (transcriptUrl) urls.push(transcriptUrl);

  if (!transcriptUrl) {
    const searchHtml = await fetchText(fetchImpl, searchUrl);
    urls.push(...candidateUrlsFromSearchHtml(searchHtml));
  }

  for (const url of urls) {
    const html = await fetchText(fetchImpl, url);
    const text = stripHtml(html);
    if (text.length < 500) continue;
    if (!transcriptMatchesDate({ text, html, dateYmd })) continue;
    return {
      ready: true,
      url,
      title: extractTitle(html),
      text,
      searchUrl,
    };
  }

  return {
    ready: false,
    reason: 'official_transcript_not_found',
    searchUrl,
  };
}

export async function readMananeraPhraseResult(cfg = {}, options = {}) {
  if (cfg.source !== MANANERA_TRANSCRIPT_SOURCE) {
    throw new Error(`unsupported transcript source: ${cfg.source}`);
  }
  if (!cfg.dateYmd || !cfg.phrase || cfg.threshold == null || cfg.yesOutcome == null) {
    throw new Error('invalid api_transcript config');
  }

  const transcript = await findMananeraTranscript({
    dateYmd: cfg.dateYmd,
    transcriptUrl: cfg.transcriptUrl || null,
    fetchImpl: options.fetchImpl || globalThis.fetch,
  });
  if (!transcript.ready) return transcript;

  const count = countPhraseOccurrences(transcript.text, cfg.phrase);
  const yes = compareTranscriptCount(count, cfg.op || 'gte', cfg.threshold);
  const yesIdx = Number(cfg.yesOutcome);
  const noIdx = yesIdx === 0 ? 1 : 0;

  return {
    ready: true,
    yes,
    outcomeIndex: yes ? yesIdx : noIdx,
    count,
    phrase: cfg.phrase,
    op: cfg.op || 'gte',
    threshold: Number(cfg.threshold),
    transcriptUrl: transcript.url,
    transcriptTitle: transcript.title,
    searchUrl: transcript.searchUrl,
    observedAt: new Date().toISOString(),
  };
}
