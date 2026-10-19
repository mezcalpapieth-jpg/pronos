import { parseHTML } from 'linkedom';
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
  'Pablo Montero',
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
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
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
    /Eliminados:\s*La\s+Granja|Conductores|Contenido\s+Exclusivo|En\s+vivo\s+con/i,
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

function articleTitleScore(text, href = '') {
  const raw = stripAccents(stripHtml(`${text} ${href}`)).toLowerCase();
  if (!raw.includes('nominad')) return 0;
  let score = 1;
  if (/\boficial\b/.test(raw)) score += 5;
  if (/\blista\b|\bcompleta\b|\bfinal\b/.test(raw)) score += 4;
  if (/\bquienes?\s+son\b|\btabla\b/.test(raw)) score += 3;
  if (/\bvotar\b|\bsalvar\b/.test(raw)) score += 1;
  if (/\ben\s+vivo\b/.test(raw)) score -= 2;
  return Math.max(0, score);
}

function candidateNomineeArticleLinks(html, { baseUrl = GRANJA_VIP_DEFAULT_BASE_URL } = {}) {
  const source = String(html || '');
  const rows = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(source))) {
    const href = cleanUrl(match[1]);
    const label = stripHtml(match[2]);
    const score = articleTitleScore(label, href);
    if (!score) continue;
    const url = absoluteUrl(href, baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    rows.push({ url, title: label, score });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, 5);
}

function participantAliases(row) {
  const name = String(row?.name || '').trim();
  const aliases = new Set([
    normalizeGranjaVipName(name),
    normalizeGranjaVipName(name.replace(/["'][^"']+["']/g, ' ')),
    normalizeGranjaVipName(name.replace(/\s+["'][^"']+["']\s*/g, ' ')),
  ].filter(Boolean));
  const quoted = [...name.matchAll(/["']([^"']+)["']/g)].map(match => normalizeGranjaVipName(match[1]));
  quoted.forEach(alias => { if (alias) aliases.add(alias); });
  const manual = {
    'rafael mercadante': ['rafa mercadante', 'rafa'],
    'kevin contreras bicolor': ['kevyn contreras bicolor', 'kevyn contreras', 'kevin contreras', 'kevyn bicolor contreras', 'kevin bicolor contreras', 'kevyn bicolor', 'kevin bicolor', 'bicolor'],
    'kevyn contreras bicolor': ['kevin contreras bicolor', 'kevyn contreras', 'kevin contreras', 'kevyn bicolor contreras', 'kevin bicolor contreras', 'kevyn bicolor', 'kevin bicolor', 'bicolor'],
    'niurka marcos': ['niurka'],
    'mario mono osuna': ['mono osuna', 'mono'],
    'daniela alexis bebeshita': ['la bebeshita', 'bebeshita'],
    'abigail pak la coreanera': ['la coreanera', 'coreanera'],
    'manelyk gonzalez': ['mane', 'manelyk'],
    'pimpinela escarlata': ['pimpinela'],
    'mono osuna': ['mario mono osuna', 'mono'],
    'azalia la negra': ['azalia ojeda', 'azalia la negra', 'la negra'],
    'pascal nadaud': ['pascal naud'],
  };
  const normalizedName = normalizeGranjaVipName(name);
  (manual[normalizedName] || []).forEach(alias => aliases.add(normalizeGranjaVipName(alias)));
  return [...aliases].filter(alias => alias.length >= 4);
}

function nomineeSentencesFromArticle(html) {
  const text = stripHtml(html);
  if (!text) return [];
  const compactText = text.replace(/\s+/g, ' ').trim();
  const targeted = [];
  const targetPatterns = [
    /\bactualmente\s+los\s+nominados\s+son:?\s+([\s\S]{1,420}?)(?:\bTags relacionados\b|\bGaler[ií]as\b|$)/i,
    /\btabla\s+(?:final\s+)?(?:de\s+)?nominados[\s\S]{0,160}?\b(?:son|qued[oó]\s+integrada\s+por):?\s+([\s\S]{1,420}?)(?:\bTags relacionados\b|\bGaler[ií]as\b|$)/i,
    /\blista\s+(?:final\s+|completa\s+)?de\s+nominados[\s\S]{0,180}?\b(?:son|es|qued[oó]\s+integrada\s+por):?\s+([\s\S]{1,420}?)(?:\bTags relacionados\b|\bGaler[ií]as\b|$)/i,
  ];
  for (const pattern of targetPatterns) {
    const match = compactText.match(pattern);
    if (match?.[1]) targeted.push(match[1]);
  }
  if (targeted.length) return targeted;

  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|(?=##\s)/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  return sentences.filter(sentence => {
    const normalized = stripAccents(sentence).toLowerCase();
    return normalized.includes('nominad')
      && /\b(son|lista|tabla|quedo|quedo|integrada|completa|riesgo|eliminad)/.test(normalized);
  });
}

function nominatedRowsFromArticle(html, rows) {
  const snippets = nomineeSentencesFromArticle(html);
  if (!snippets.length) return [];
  const nominees = [];
  const seen = new Set();
  for (const snippet of snippets) {
    const normalizedSnippet = normalizeGranjaVipName(snippet);
    for (const row of rows) {
      const aliases = participantAliases(row);
      if (!aliases.some(alias => normalizedSnippet.includes(alias))) continue;
      const key = row.slug || slugifyGranjaVipName(row.name);
      if (seen.has(key)) continue;
      seen.add(key);
      nominees.push(row);
    }
  }
  return nominees;
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
  if (target.protocol !== 'https:' || target.hostname !== 'www.tvazteca.com'
    || (!target.pathname.startsWith('/aztecauno/la-granja-vip/')
      && !/^\/aztecauno\/(?:newslatest-sitemap-latest|sitemap-\d{6})\.xml$/.test(target.pathname)) || target.username || target.password || target.port) {
    throw new Error('granja_vip_untrusted_url');
  }
  if (cacheBust) target.searchParams.set('_pronos', String(Date.now()));
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  if (timer?.unref) timer.unref();
  try {
    const response = await fetchImpl(target.toString(), {
      redirect: 'error',
      signal: controller?.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'Pronos La Granja VIP scraper (+https://pronos.io)',
      },
    });
    const text = await response.text();
    if (Buffer.byteLength(text) > 3_000_000) throw new Error('granja_vip_document_too_large');
    return {
      ok: Boolean(response?.ok),
      status: Number(response?.status || 0),
      url: target.toString(),
      text,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function parseOfficialGranjaArticle(html, url) {
  const { document } = parseHTML(html);
  const article = [...document.querySelectorAll('article')].find(node => node.querySelector('h1'));
  const title = article?.querySelector('h1')?.textContent.trim();
  const rawDate = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content');
  if (!title || !rawDate || /corral vip/i.test(title)) return null;
  // Brightspot emits UTC timestamps without an offset (21:45 = 15:45 CDMX).
  const published = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(rawDate) ? rawDate : `${rawDate}Z`);
  if (!Number.isFinite(published.getTime())) return null;
  const body = article.querySelector('.articleBody') || article;
  const paragraphs = [...body.querySelectorAll('p, li')].map(node => node.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return { title, url, publishedAt: published.toISOString(), paragraphs };
}

function officialGranjaLinks(html, baseUrl) {
  const { document } = parseHTML(html);
  const links = new Map();
  for (const node of document.querySelectorAll('a[href]')) {
    try {
      const url = new URL(node.getAttribute('href'), baseUrl);
      if (url.hostname !== 'www.tvazteca.com' || url.protocol !== 'https:' || !url.pathname.startsWith('/aztecauno/la-granja-vip/')) continue;
      const title = node.textContent.replace(/\s+/g, ' ').trim();
      url.search = ''; url.hash = '';
      if (title && !links.has(url.href)) links.set(url.href, { url: url.href, title });
    } catch { /* Ignore malformed navigation links. */ }
  }
  return [...links.values()];
}

function officialGranjaSitemapLinks(xml) {
  const links = [];
  for (const [, entry] of xml.matchAll(/<url>\s*([\s\S]*?)<\/url>/g)) {
    try {
      const url = new URL(decodeHtmlEntities(entry.match(/<loc>(.*?)<\/loc>/)?.[1] || ''));
      if (url.protocol !== 'https:' || url.hostname !== 'www.tvazteca.com'
        || !url.pathname.startsWith('/aztecauno/la-granja-vip/') || url.username || url.password || url.port) continue;
      const lastmod = new Date(entry.match(/<lastmod>(.*?)<\/lastmod>/)?.[1]);
      url.search = ''; url.hash = '';
      // Sitemaps are discovery only. The dated article and its headline must
      // still be fetched and verified before nominations or a result count.
      links.push({ url: url.href, title: url.pathname.split('/').filter(Boolean).pop().replace(/-/g, ' '),
        modifiedAt: Number.isFinite(lastmod.getTime()) ? lastmod.toISOString() : '' });
    } catch { /* Ignore malformed or non-official sitemap entries. */ }
  }
  return links.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function matchingGranjaRows(text, rows) {
  const normalized = ` ${normalizeGranjaVipName(text)} `;
  return rows.filter(row => participantAliases(row).some(alias => normalized.includes(` ${alias} `)));
}

export function extractParticipantsFromOfficialHtml(html, {
  baseUrl = process.env.GRANJA_VIP_BASE_URL || GRANJA_VIP_DEFAULT_BASE_URL,
} = {}) {
  const linked = candidateParticipantLinks(html, { baseUrl });
  const rows = uniqueParticipants(linked);
  return applyStatusMentions(rows, html);
}

function nominationList(text) {
  const paragraph = stripHtml(text);
  const marker = /(?:actualmente los nominados son|son los granjeros que forman parte de la lista de nominados|lista (?:actualizada|final|definitiva) de nominados[\s,:-]*(?:(?:esta|quedo) )?(?:son|integrad[ao]s? por|conformad[ao]s? por|se posicionaron))\s*:?\s*/i.exec(stripAccents(paragraph));
  // Only names after the explicit list marker count. Earlier sentences can
  // mention the person who saved/removed a nominee, and sidebars are unrelated.
  return marker ? paragraph.slice(marker.index + marker[0].length).split(/[.!?;]/)[0] : null;
}

function completeNominationList(list, rows) {
  let remaining = ` ${normalizeGranjaVipName(list)} `;
  const aliases = rows.flatMap(participantAliases).sort((a, b) => b.length - a.length);
  for (const alias of aliases) remaining = remaining.replaceAll(` ${alias} `, ' ');
  // An unrecognized entrant must never be silently dropped from the field.
  return remaining.split(/\s+/).every(word => !word || word === 'y' || word === 'e');
}

function finalNominationArticle(article, close) {
  const title = stripAccents(article.title);
  const day = formatMexicoDateYmd(new Date(article.publishedAt));
  const friday = formatMexicoDateYmd(new Date(close.getTime() - 2 * 86400000));
  return /(?:lista|tabla) (?:final|definitiva).*nominad/i.test(title)
    && day >= friday && new Date(article.publishedAt) < close;
}

function nominationLinkPriority(link) {
  const text = stripAccents(`${link.title} ${link.url}`).replace(/-/g, ' ');
  if (/(?:lista|tabla) (?:final|definitiva).*nominad|finalistas.*capataz|capataz.*finalistas/i.test(text)) return 0;
  return /lista actualizada.*nominad/i.test(text) ? 1 : 2;
}

function sameGranjaField(outcomes, rows) {
  // Use the known participant aliases, including Kevyn/Kevin and Mono Osuna.
  const remaining = [...(rows || [])];
  if (!Array.isArray(outcomes) || outcomes.length !== remaining.length) return false;
  for (const label of outcomes) {
    const index = remaining.findIndex(row => participantAliases(row).includes(normalizeGranjaVipName(label)));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

export async function assertGranjaVipFinalNominees(cfg, outcomes, { fetchImpl = fetch, now = new Date() } = {}) {
  if (cfg?.kind !== 'granja-vip-elimination') return null;
  const close = new Date(cfg.resolveAt);
  const upcomingWeek = formatMexicoDateYmd(nextGranjaVipSundayClose(now));
  if (!Number.isFinite(close.getTime()) || close <= now || cfg.weekKey !== upcomingWeek
    || formatMexicoDateYmd(close) !== upcomingWeek) {
    const error = new Error('granja_nomination_week_mismatch');
    error.status = 409;
    error.detail = 'Regenerar el borrador para la próxima gala del domingo antes de aprobarlo.';
    throw error;
  }
  const snapshot = await readGranjaVipOfficialSnapshot({ fetchImpl, now, articleEvidence: cfg.evidence || [] });
  const reason = !snapshot.nominationFinal ? 'granja_final_nominees_unavailable'
    : !sameGranjaField(outcomes, snapshot.nominated) ? 'granja_contestant_field_changed_or_unavailable' : null;
  if (reason) {
    const error = new Error(reason);
    error.status = 409;
    error.detail = 'La aprobación requiere la lista FINAL oficial posterior a la Traición del viernes, con las mismas opciones del mercado. Regenerar el borrador si cambiaron los nominados.';
    throw error;
  }
  return snapshot;
}

export async function readGranjaVipOfficialSnapshot({
  fetchImpl = fetch,
  baseUrl = process.env.GRANJA_VIP_BASE_URL || GRANJA_VIP_DEFAULT_BASE_URL,
  now = new Date(),
  historicalField = false,
  articleEvidence = [],
} = {}) {
  const sourceUrl = getBaseUrl(baseUrl);
  let discovered = [];
  let officialHtml = '';
  let nomineeEvidence = [];
  let capatazEvidence = [];
  let capatazFinalists = [];
  let fetchError = null;
  try {
    const response = await fetchFreshText(sourceUrl, { fetchImpl, cacheBust: true });
    if (!response.ok) throw new Error(`http_${response.status}`);
    officialHtml = response.text;
    discovered = extractParticipantsFromOfficialHtml(officialHtml, { baseUrl: sourceUrl });
  } catch (e) {
    fetchError = e?.message || 'fetch_failed';
  }

  const fallback = loadGranjaVipParticipants();
  const missing = fallback.filter(row => !discovered.some(known =>
    participantAliases(known).some(alias => participantAliases(row).includes(alias))));
  let rows = uniqueParticipants(discovered.length >= 6 ? [...discovered, ...missing] : fallback);
  // Headlines elsewhere on the page are not current nomination evidence.
  rows = rows.map(row => ({ ...row, statusKey: null, statusLabel: null, rawStatus: null }));
  const eliminatedSection = sectionBetween(officialHtml, /Eliminados:\s*La\s+Granja\s+VIP\s+Segunda\s+Temporada/i, /Conductores/i);
  const eliminatedNames = normalizeGranjaVipName(stripHtml(eliminatedSection));
  rows = rows.map(row => participantAliases(row).some(alias => ` ${eliminatedNames} `.includes(` ${alias} `))
    ? mergeStatus(row, { key: 'eliminado', label: 'Eliminado/a', raw: 'ELIMINADO' }) : row);
  const close = nextGranjaVipSundayClose(now);
  let discoveryHtml = officialHtml;
  const sitemapLinks = [];
  // The show's curated listings omit some current gala articles. TV Azteca
  // publishes these feeds in robots.txt: monthly covers Friday, news the gala.
  const months = new Set([close, new Date(close.getTime() - 2 * 86400000)]
    .map(date => formatMexicoDateYmd(date).slice(0, 7).replace('-', '')));
  const discoveryUrls = ['notas-la-granja-vip', 'videos'].map(path => new URL(path, sourceUrl).href)
    .concat('https://www.tvazteca.com/aztecauno/newslatest-sitemap-latest.xml',
      [...months].map(month => `https://www.tvazteca.com/aztecauno/sitemap-${month}.xml`));
  await Promise.all(discoveryUrls.map(async url => {
    try {
      const page = await fetchFreshText(url, { fetchImpl });
      if (!page.ok) return;
      if (new URL(url).pathname.endsWith('.xml')) sitemapLinks.push(...officialGranjaSitemapLinks(page.text));
      else discoveryHtml += page.text;
    } catch { /* Other official listings may still provide evidence. */ }
  }));
  const weekStart = formatMexicoDateYmd(new Date(close.getTime() - 6 * 86400000));
  const weekEnd = formatMexicoDateYmd(close);
  const currentArticles = [];
  const officialArticleLinks = [...new Map([
    ...officialGranjaLinks(discoveryHtml, sourceUrl),
    ...sitemapLinks,
  ].map(link => [link.url, link])).values()]
    .sort((a, b) => String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')));
  if (discoveryHtml || articleEvidence.length) {
    const links = [...new Map([...articleEvidence, ...officialArticleLinks].filter(link => link?.url).map(link => [link.url, link])).values()]
      .filter(link => /nominad|capataz/i.test(`${link.title} ${link.url}`))
      .filter(link => !/corral|primera-temporada/i.test(`${link.title} ${link.url}`))
      .sort((a, b) => nominationLinkPriority(a) - nominationLinkPriority(b)
        || String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')));
    await Promise.all(links.slice(0, 12).map(async article => {
      try {
        const articleResponse = await fetchFreshText(article.url, { fetchImpl, cacheBust: true });
        if (!articleResponse.ok) return;
        const parsed = parseOfficialGranjaArticle(articleResponse.text, article.url);
        if (!parsed || parsed.publishedAt > now.toISOString()) return;
        currentArticles.push(parsed);
      } catch {
        // Missing dated evidence must never fall back to sidebar headlines.
      }
    }));
  }
  currentArticles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  let nominationPublishedAt = null;
  let nominationFinal = false;
  const nomineeArticles = currentArticles.filter(article => {
    const localDate = formatMexicoDateYmd(new Date(article.publishedAt));
    return localDate >= weekStart && localDate <= weekEnd && /nominad/i.test(article.title);
  });
  const finalArticles = nomineeArticles.filter(article => finalNominationArticle(article, close));
  // A later final announcement supersedes provisional lists. If its list
  // cannot be parsed, do not silently fall back to an older final lineup.
  for (const article of finalArticles.length ? finalArticles.slice(0, 1) : nomineeArticles) {
    const list = article.paragraphs.map(nominationList).find(Boolean);
    if (!list) continue;
    const articleNominees = matchingGranjaRows(list, rows);
    // Today's eliminated roster cannot invalidate a nomination article from before that gala.
    if (articleNominees.length < 2 || !completeNominationList(list, articleNominees) || (!historicalField && articleNominees.some(row => row.statusKey === 'eliminado'))) continue;
    const keys = new Set(articleNominees.map(row => row.slug));
    rows = rows.map(row => keys.has(row.slug)
      ? { ...row, ...statusFields({ key: 'nominado', label: 'Nominado/a', raw: 'NOMINADO' }) } : row);
    nomineeEvidence = [{ title: article.title, url: article.url, publishedAt: article.publishedAt }];
    nominationPublishedAt = article.publishedAt;
    nominationFinal = finalNominationArticle(article, close);
    break;
  }
  const capatazClose = nextGranjaVipCapatazClose(now);
  const capatazDate = formatMexicoDateYmd(capatazClose);
  for (const article of currentArticles) {
    if (formatMexicoDateYmd(new Date(article.publishedAt)) !== capatazDate || !/finalistas.*capataz|capataz.*finalistas/i.test(article.title)) continue;
    const list = article.paragraphs.find(text => /la final reunira/i.test(stripAccents(text)));
    const finalists = list ? matchingGranjaRows(list, rows) : [];
    if (finalists.length < 2 || (!historicalField && finalists.some(row => row.statusKey === 'eliminado'))) continue;
    capatazFinalists = finalists;
    capatazEvidence = [{ title: article.title, url: article.url, publishedAt: article.publishedAt }];
    break;
  }
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
    nomineeEvidence,
    nominationPublishedAt,
    nominationFinal,
    capatazFinalists,
    capatazEvidence,
    officialArticleLinks,
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

export function nextGranjaVipCapatazClose(now = new Date()) {
  const local = mexicoDateTimeParts(now);
  let daysAhead = (8 - local.weekday) % 7;
  if (daysAhead === 0 && (local.hour > 20 || (local.hour === 20 && local.minute >= 25))) daysAhead = 7;
  return dateAtMexicoCityTime({ ...addDaysLocal(local, daysAhead), hour: 20, minute: 25, second: 0 });
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
  kind = 'elimination',
} = {}) {
  const capataz = kind === 'capataz';
  const contestants = capataz ? snapshot?.capatazFinalists : snapshot?.nominated;
  const datedEvidence = capataz ? snapshot?.capatazEvidence : snapshot?.nomineeEvidence;
  if (!snapshot?.ok || !Array.isArray(contestants) || contestants.length < 2 || !datedEvidence?.length) return null;
  // Elimination options can change during Friday's Traición. Only publish
  // drafts after the final lineup is available; Capataz is independent.
  if (!capataz && snapshot.nominationFinal !== true) return null;
  const closeHour = Number(process.env.GRANJA_VIP_CLOSE_HOUR ?? DEFAULT_CLOSE_HOUR);
  const closeMinute = Number(process.env.GRANJA_VIP_CLOSE_MINUTE ?? DEFAULT_CLOSE_MINUTE);
  const close = capataz ? nextGranjaVipCapatazClose(now) : nextGranjaVipSundayClose(now, { hour: closeHour, minute: closeMinute });
  const weekKey = formatMexicoDateYmd(close);
  const earliest = capataz ? weekKey : formatMexicoDateYmd(new Date(close.getTime() - 6 * 86400000));
  if (!datedEvidence.some(item => {
    const published = new Date(item.publishedAt);
    if (!Number.isFinite(published.getTime()) || published > now) return false;
    const day = formatMexicoDateYmd(published);
    return day >= earliest && day <= weekKey;
  })) return null;
  const sourceEventId = `granja-vip-${kind}:${weekKey}`;
  const outcomes = contestants.map(row => row.name).filter(Boolean);
  if (outcomes.length !== contestants.length || new Set(outcomes.map(normalizeGranjaVipName)).size !== outcomes.length) return null;
  const evidence = [
    { title: 'La Granja VIP · TV Azteca', url: snapshot.sourceUrl },
    ...datedEvidence,
    ...contestants.map(row => ({
      title: `${row.name} · ${row.statusLabel || 'Nominado/a'}`,
      url: row.url || snapshot.sourceUrl,
    })),
  ];

  return {
    source: GRANJA_VIP_SOURCE,
    source_event_id: sourceEventId,
    question: capataz ? `¿Quién será Capataz de La Granja VIP el ${weekKey}?` : '¿Quién sale de La Granja VIP esta semana?',
    category: 'musica',
    icon: null,
    outcomes,
    seed_liquidity: seedLiquidity,
    start_time: now.toISOString(),
    end_time: close.toISOString(),
    amm_mode: 'parallel',
    resolver_type: 'api_chart',
    resolver_config: {
      source: 'official-result',
      kind: `granja-vip-${kind}`,
      weekKey,
      resolveAt: close.toISOString(),
      legs: outcomes.map(label => ({ label })),
      sourceEventId,
      suggestedOutcomeIndex: null,
      confidenceBps: 0,
      criteria: capataz
        ? `Gana quien TV Azteca anuncie oficialmente como ganador de la prueba de Capataz del ${weekKey}. Solo cuenta el resultado de esa prueba, no el capataz de semanas anteriores. Si cambia la lista de finalistas, hay empate, cancelación o resultado ambiguo, requiere revisión manual.`
        : 'Resolver con el resultado oficial de la Gala de Eliminación de La Granja VIP. Si TV Azteca marca claramente al eliminado dentro de las opciones, confirmar esa opción; si hay abandono o cambio de nominados antes de la gala, revisar manualmente o anular según corresponda.',
      evidence,
      sourceUrls: evidence.map(item => item.url).filter(Boolean),
      evidenceUrl: snapshot.sourceUrl,
      timezone: MEXICO_CITY_TZ,
      staleReadPolicy: 'Usar lectura fresca de TV Azteca; no pagar automáticamente si no hay etiqueta oficial clara.',
    },
    source_data: {
      kind: capataz ? 'granja_vip_capataz' : 'granja_vip_week',
      showLabel: 'La Granja VIP',
      seasonLabel,
      weekKey,
      closeLocalTime: capataz ? `lunes 20:25 ${MEXICO_CITY_TZ}` : `domingo ${String(closeHour).padStart(2, '0')}:${String(closeMinute).padStart(2, '0')} ${MEXICO_CITY_TZ}`,
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

export async function readGranjaVipOfficialResult(cfg, outcomes, { fetchImpl = fetch, now = new Date() } = {}) {
  const defer = (reason, manualReview = false) => {
    const error = new Error(reason);
    error.benign = true;
    error.manualReview = manualReview;
    error.info = { source: GRANJA_VIP_SOURCE, reason, weekKey: cfg.weekKey,
      rationale: 'TV Azteca no confirma de forma inequívoca el resultado y la lista de participantes de esta prueba. Revisar la evidencia oficial antes de pagar.' };
    return error;
  };
  const close = new Date(cfg.resolveAt);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.weekKey) || !Number.isFinite(close.getTime()) || now < close) throw defer('granja_result_not_due');
  const capataz = cfg.kind === 'granja-vip-capataz';
  const snapshot = await readGranjaVipOfficialSnapshot({
    fetchImpl, now: new Date(close.getTime() - 60000), historicalField: true, articleEvidence: cfg.evidence || [],
  });
  const field = capataz ? snapshot.capatazFinalists : snapshot.nominated;
  if (!capataz && !snapshot.nominationFinal) throw defer('granja_final_nominees_unavailable', true);
  if (!sameGranjaField(outcomes, field)) {
    throw defer('granja_contestant_field_changed_or_unavailable', true);
  }
  const links = snapshot.officialArticleLinks.filter(link => {
    const title = stripAccents(link.title);
    return capataz ? /capataz/i.test(title) && /gano|ganador|nuevo|nueva|consiguio|convirtio/i.test(title)
      : /eliminad/i.test(title) && !/salvad|nominad|riesgo|votar/i.test(title);
  });
  const found = [];
  for (const link of links.slice(0, 8)) {
    const response = await fetchFreshText(link.url, { fetchImpl });
    if (!response.ok) continue;
    const article = parseOfficialGranjaArticle(response.text, link.url);
    if (!article || article.publishedAt > now.toISOString()) continue;
    const date = formatMexicoDateYmd(new Date(article.publishedAt));
    const resultDay = formatMexicoDateYmd(new Date(close.getTime() + 86400000));
    if (date < cfg.weekKey || date > resultDay || new Date(article.publishedAt) < close) continue;
    const headline = stripAccents(article.title);
    const explicit = capataz ? /(?:gana|ganador|nuevo|nueva|se convierte|consigue|convirtio).{0,100}capataz|capataz.{0,80}(?:es |gana)/i
      : /(?:es |fue |se convierte|se convirtio).{0,60}eliminad|eliminad[oa].{0,30}(?:es |fue )/i;
    if (!explicit.test(headline) || /\?|empate|abandono|expulsion|cancelad|dos eliminad|doble eliminacion|recuerda|semana pasada|anterior|podria|sera|seria/i.test(headline)) continue;
    // Result headlines often also name the surviving nominees. Match the
    // eliminated subject before "es/fue ... eliminado", not those opponents.
    const elimination = !capataz && /\b(?:es|fue|se convierte en|se convirtio en)\s+(?:\S+\s+){0,4}eliminad[oa]\b/i.exec(headline);
    const resultSubject = elimination ? headline.slice(0, elimination.index) : article.title;
    const matches = outcomes.map((name, index) => ({ name, index })).filter(row =>
      matchingGranjaRows(resultSubject, [{ name: row.name }]).length === 1);
    if (matches.length === 1) found.push({ winningIdx: matches[0].index, article });
  }
  const winners = new Set(found.map(row => row.winningIdx));
  if (winners.size !== 1) throw defer('granja_official_result_missing_or_ambiguous', winners.size > 1 || now - close > 86400000);
  const result = found[0];
  return { winningIdx: result.winningIdx, resolverInfo: {
    source: GRANJA_VIP_SOURCE, evidenceUrl: result.article.url, publishedAt: result.article.publishedAt,
    officialHeadline: result.article.title, weekKey: cfg.weekKey,
  } };
}

export const _internal = {
  DEFAULT_PARTICIPANTS,
  candidateNomineeArticleLinks,
  compactRows,
  getBaseUrl,
  nominatedRowsFromArticle,
  statusPriority,
  stripHtml,
};
