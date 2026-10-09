import { parseHTML } from 'linkedom';
import { dateAtMexicoCityTime } from './market-gen/mexico-time.js';
import { deferUntilResolveAt } from './price-buckets.js';

export const CENAPRED_POPOCATEPETL_SOURCE = 'cenapred-popocatepetl';
export const CENAPRED_ARCHIVE_URL = 'https://www.gob.mx/cenapred/es/archivo/articulos';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DEFAULT_OUTCOMES = ['0 a 19', '20 a 49', '50 a 99', '100 o m\u00e1s'];
const MAX_ARCHIVE_PAGES = 4;
const MAX_HTML_BYTES = 1_000_000;

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function dateParts(ymd) {
  const match = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('cenapred_invalid_report_date');
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== ymd) throw new Error('cenapred_invalid_report_date');
  return { year, month, day };
}

function dateInText(text) {
  const match = normalize(text).match(/\b(\d{1,2}) de ([a-z]+) de (\d{4})\b/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2]) + 1;
  if (!month) return null;
  const ymd = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  try { dateParts(ymd); return ymd; } catch { return null; }
}

export function popocatepetlResolveAt(targetDateYmd) {
  const { year, month, day } = dateParts(targetDateYmd);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return dateAtMexicoCityTime({
    year: next.getUTCFullYear(), month: next.getUTCMonth() + 1,
    day: next.getUTCDate(), hour: 0, minute: 0,
  }).toISOString();
}

export function popocatepetlResolverConfig(targetDateYmd, outcomes = DEFAULT_OUTCOMES) {
  return {
    source: CENAPRED_POPOCATEPETL_SOURCE,
    shape: 'price-bucket',
    targetDateYmd,
    resolveAt: popocatepetlResolveAt(targetDateYmd),
    unit: 'exhalaciones',
    // The shared bucket resolver uses exclusive upper bounds.
    buckets: [
      { label: outcomes[0], min: 0, max: 20 },
      { label: outcomes[1], min: 20, max: 50 },
      { label: outcomes[2], min: 50, max: 100 },
      { label: outcomes[3], min: 100, max: null },
    ],
  };
}

export function upgradeLegacyPopocatepetlResolver({ resolverType, cfg, source, sourceEventId, sourceData, outcomes }) {
  if (!['manual', 'manual_review'].includes(resolverType)
    || cfg?.shape !== 'manual' || cfg?.source !== 'october-tournament-2026'
    || source !== 'october-tournament-2026') return null;
  const match = String(sourceEventId || '').match(/^october-2026:popocatepetl-exhalations-(\d{4}-\d{2}-\d{2})$/);
  if (!match || !Array.isArray(outcomes) || outcomes.length !== 4
    || outcomes.some((label, i) => normalize(label) !== normalize(DEFAULT_OUTCOMES[i]))) return null;
  if (sourceData?.targetDateYmd && sourceData.targetDateYmd !== match[1]) return null;
  if (sourceData?.kind && sourceData.kind !== 'october_tournament_popocatepetl') return null;
  if (!/cenapred/.test(normalize(cfg.criteria)) || !/exhalaciones/.test(normalize(cfg.criteria))) return null;
  try {
    const automatic = popocatepetlResolverConfig(match[1], outcomes);
    if (cfg.resolveAt && new Date(cfg.resolveAt).getTime() > new Date(automatic.resolveAt).getTime()) {
      automatic.resolveAt = cfg.resolveAt;
    }
    return { ...cfg, ...automatic };
  } catch { return null; }
}

function officialUrl(value) {
  const url = new URL(value, 'https://www.gob.mx');
  if (url.protocol !== 'https:' || url.hostname !== 'www.gob.mx' || url.port
    || url.username || url.password
    || !/^\/cenapred\/(?:es\/)?(?:articulos\/|archivo\/articulos)/.test(url.pathname)) {
    throw new Error('cenapred_non_official_url');
  }
  return url.href;
}

async function fetchHtml(url) {
  let href = officialUrl(url);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const res = await fetch(href, {
      headers: { accept: 'text/html', 'user-agent': 'Pronos resolver (+https://pronos.io)' },
      signal: AbortSignal.timeout(8000), redirect: 'manual', cache: 'no-store',
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      href = officialUrl(new URL(res.headers.get('location'), href).href);
      await res.body?.cancel();
      continue;
    }
    if (!res.ok) throw new Error(`cenapred_http_${res.status}`);
    if (res.url) officialUrl(res.url);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) throw new Error('cenapred_non_html_response');
    if (Number(res.headers.get('content-length')) > MAX_HTML_BYTES) throw new Error('cenapred_report_too_large');
    const html = await res.text();
    if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error('cenapred_report_too_large');
    return { html, url: href };
  }
  throw new Error('cenapred_too_many_redirects');
}

function publicationTime(article) {
  const time = article.querySelector('time');
  const raw = time?.getAttribute('date') || time?.getAttribute('datetime') || '';
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error('cenapred_missing_publication_time');
  const parts = dateParts(match[1]);
  const [hour, minute, second] = match.slice(2).map(Number);
  if (hour > 23 || minute > 59 || second > 59) throw new Error('cenapred_invalid_publication_time');
  return { dateYmd: match[1], iso: dateAtMexicoCityTime({ ...parts, hour, minute, second }).toISOString() };
}

async function findReports(targetDateYmd) {
  const reports = new Map();
  for (let page = 1; page <= MAX_ARCHIVE_PAGES; page += 1) {
    const url = new URL(CENAPRED_ARCHIVE_URL);
    url.search = new URLSearchParams({ filter_origin: 'archive', idiom: 'es', order: 'DESC', page: String(page) });
    const { html } = await fetchHtml(url.href);
    const { document } = parseHTML(html);
    const articles = [...document.querySelectorAll('article')];
    if (!articles.length) throw new Error('cenapred_archive_not_readable');
    for (const article of articles) {
      const title = article.querySelector('h2')?.textContent || '';
      if (!/popocatepetl/.test(normalize(title)) || !/monitoreo|actualizacion/.test(normalize(title))
        || dateInText(title) !== targetDateYmd) continue;
      const published = publicationTime(article);
      if (published.dateYmd !== targetDateYmd) throw new Error('cenapred_publication_date_mismatch');
      const href = article.querySelector('a[href]')?.getAttribute('href');
      if (!href) throw new Error('cenapred_missing_report_url');
      const reportUrl = officialUrl(href);
      reports.set(reportUrl, { url: reportUrl, publishedAt: published.iso });
    }
    // Continue through the target day so a later correction on another page is not missed.
    const oldest = articles.at(-1)?.querySelector('time')?.getAttribute('date')?.slice(0, 10);
    if (oldest && oldest < targetDateYmd) break;
    if (!document.querySelector('a[rel="next"]')) break;
    if (page === MAX_ARCHIVE_PAGES) throw new Error('cenapred_archive_search_incomplete');
  }
  if (!reports.size) throw new Error('cenapred_report_not_published');
  return [...reports.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function parseCenapredPopocatepetlReport(html, targetDateYmd) {
  dateParts(targetDateYmd);
  const { document } = parseHTML(html);
  const title = document.querySelector('h1')?.textContent?.trim() || '';
  if (!/popocatepetl/.test(normalize(title)) || !/monitoreo|actualizacion/.test(normalize(title))
    || dateInText(title) !== targetDateYmd) throw new Error('cenapred_report_date_mismatch');
  const body = document.querySelector('.article-body');
  const attribution = body?.parentElement?.querySelector('section')?.textContent || '';
  if (!/centro nacional de prevencion de desastres/.test(normalize(attribution))
    || dateInText(attribution) !== targetDateYmd) throw new Error('cenapred_attribution_date_mismatch');
  if (!body) throw new Error('cenapred_missing_report_body');
  for (const node of body.querySelectorAll('script, style')) node.remove();
  const text = normalize(body.textContent);
  const counts = [...text.matchAll(/\bse (?:detectaron|registraron|identificaron|contabilizaron) (?:un total de )?([+-]?[\d.,]+) exhalaciones\b/g)]
    .map(match => {
      if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(match[1])) throw new Error('cenapred_non_integer_count');
      const value = Number(match[1].replace(/,/g, ''));
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('cenapred_non_integer_count');
      return value;
    });
  if (/\bno se (?:detectaron|registraron) exhalaciones\b/.test(text)) counts.push(0);
  if (!counts.length) throw new Error('cenapred_missing_exhalation_count');
  if (new Set(counts).size !== 1) throw new Error('cenapred_ambiguous_exhalation_count');
  return { value: counts[0], count: counts[0], reportDateYmd: targetDateYmd, reportTitle: title };
}

export async function readCenapredPopocatepetlExhalations(cfg = {}, { now = Date.now() } = {}) {
  const targetDateYmd = cfg.targetDateYmd;
  const earliestResolveAt = popocatepetlResolveAt(targetDateYmd);
  deferUntilResolveAt(earliestResolveAt, now);
  deferUntilResolveAt(cfg.resolveAt, now);
  try {
    const reports = await findReports(targetDateYmd);
    const latest = reports.filter(report => report.publishedAt === reports[0].publishedAt);
    let result;
    for (const report of latest) {
      const { html, url } = await fetchHtml(report.url);
      const parsed = parseCenapredPopocatepetlReport(html, targetDateYmd);
      if (result && result.count !== parsed.count) throw new Error('cenapred_conflicting_latest_reports');
      result = { ...parsed, source: CENAPRED_POPOCATEPETL_SOURCE,
        sourceUrl: url, reportPublishedAt: report.publishedAt, readAt: new Date(now).toISOString() };
    }
    return result;
  } catch (cause) {
    const error = new Error(`cenapred_report_unavailable_for_${targetDateYmd}: ${cause.message}`);
    error.benign = true;
    error.info = { source: CENAPRED_POPOCATEPETL_SOURCE, targetDateYmd, reason: cause.message };
    throw error;
  }
}
