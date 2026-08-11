export const MANANERA_TRANSCRIPT_SOURCE = 'gob-mx-presidencia-transcript';
export const MANANERA_YOUTUBE_CAPTIONS_SOURCE = 'youtube-official-captions';
export const MANANERA_OFFICIAL_BASE_URL = 'https://www.gob.mx/presidencia';
export const MANANERA_SEARCH_BASE_URL = 'https://www.gob.mx/busqueda';
export const MANANERA_YOUTUBE_SEARCH_BASE_URL = 'https://www.youtube.com/results';
export const MANANERA_ARCHIVE_URL = `${MANANERA_OFFICIAL_BASE_URL}/archivo/articulos`;

const YOUTUBE_SEARCH_API_URL = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_CHANNEL_BASE_URL = 'https://www.youtube.com/channel';
const YOUTUBE_WATCH_BASE_URL = 'https://www.youtube.com/watch';
const YOUTUBE_FEED_BASE_URL = 'https://www.youtube.com/feeds/videos.xml';
const DEFAULT_MANANERA_YOUTUBE_CHANNEL_IDS = [
  // Official Claudia Sheinbaum Pardo channel used for the daily morning stream.
  'UC6mvc52_1j0okpAaXJj2c_Q',
];
const OFFICIAL_YOUTUBE_CHANNEL_TITLE_RE = /\b(claudia\s+sheinbaum|gobierno\s+de\s+mexico|gobierno\s+de\s+méxico|presidencia)\b/i;

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

function spanishMonthName(month) {
  return Object.keys(MONTHS_ES).find(name => MONTHS_ES[name] === String(month).padStart(2, '0')) || String(month);
}

export function buildMananeraDirectTranscriptUrl(dateYmd) {
  const [year, month, day] = String(dateYmd || '').split('-');
  const monthName = spanishMonthName(month);
  const dd = String(day || '').padStart(2, '0');
  return `${MANANERA_OFFICIAL_BASE_URL}/articulos/version-estenografica-conferencia-de-prensa-de-la-presidenta-claudia-sheinbaum-pardo-del-${dd}-de-${monthName}-de-${year}`;
}

export function buildMananeraArchiveUrl() {
  return MANANERA_ARCHIVE_URL;
}

function dateSearchTokens(dateYmd) {
  const [year, month, day] = String(dateYmd || '').split('-');
  const monthName = Object.keys(MONTHS_ES).find(name => MONTHS_ES[name] === month);
  return [
    String(dateYmd || '').toLowerCase(),
    `${Number(day)} de ${monthName} de ${year}`,
    `${String(day).padStart(2, '0')} de ${monthName} de ${year}`,
    `${Number(day)} de ${monthName} ${year}`,
    `${String(day).padStart(2, '0')} de ${monthName} ${year}`,
  ].filter(Boolean);
}

export function buildMananeraSearchUrl(dateYmd) {
  const q = `site:gob.mx/presidencia versión estenográfica conferencia de prensa presidenta ${formatSpanishLongDate(dateYmd)}`;
  return `${MANANERA_SEARCH_BASE_URL}?q=${encodeURIComponent(q)}`;
}

export function buildMananeraYouTubeSearchUrl(dateYmd) {
  const q = `Conferencia de prensa matutina ${formatSpanishLongDate(dateYmd)} Presidenta Claudia Sheinbaum`;
  return `${MANANERA_YOUTUBE_SEARCH_BASE_URL}?search_query=${encodeURIComponent(q)}`;
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

function candidateUrlsFromArchiveHtml(html, dateYmd) {
  const [year, month, day] = String(dateYmd || '').split('-');
  const monthName = spanishMonthName(month);
  const dateTokens = [
    `${String(day || '').padStart(2, '0')}-de-${monthName}-de-${year}`,
    `${Number(day)}-de-${monthName}-de-${year}`,
  ].filter(Boolean);
  const out = [];
  const seen = new Set();
  const re = /(?:href=["'])?(\/presidencia\/articulos\/[a-z0-9-]+)/gi;
  let match;
  while ((match = re.exec(String(html || '')))) {
    const path = match[1];
    const slug = path.split('/').pop() || '';
    if (!/version-estenografica/i.test(slug)) continue;
    if (!/conferencia-de-prensa|conferencia-matutina|matutina-del-pueblo/i.test(slug)) continue;
    if (!dateTokens.some(token => slug.includes(token))) continue;
    const href = `https://www.gob.mx${path}`;
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

async function fetchText(fetchImpl, url, extraHeaders = {}) {
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': 'Pronos resolver (+https://pronos.io)',
      accept: 'text/html,application/xhtml+xml',
      ...extraHeaders,
    },
  });
  if (!response?.ok) {
    const err = new Error(`transcript_fetch_failed_${response?.status || 'unknown'}`);
    err.status = response?.status || null;
    throw err;
  }
  return response.text();
}

async function tryFetchText(fetchImpl, url, extraHeaders = {}) {
  try {
    return await fetchText(fetchImpl, url, extraHeaders);
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

async function readTranscriptCandidate({
  fetchImpl,
  url,
  dateYmd,
  searchUrl,
  directUrl,
  archiveUrl,
  includeRawHtml = false,
}) {
  const html = await tryFetchText(fetchImpl, url);
  if (!html) return null;
  const text = stripHtml(html);
  if (text.length < 500) return null;
  if (!transcriptMatchesDate({ text, html, dateYmd })) return null;
  return {
    ready: true,
    url,
    title: extractTitle(html),
    text,
    html: includeRawHtml ? html : undefined,
    searchUrl,
    directUrl,
    archiveUrl,
  };
}

async function fetchJson(fetchImpl, url, extraHeaders = {}) {
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': 'Pronos resolver (+https://pronos.io)',
      accept: 'application/json',
      ...extraHeaders,
    },
  });
  if (!response?.ok) {
    const body = await response.text().catch(() => '');
    const err = new Error(`json_fetch_failed_${response?.status || 'unknown'}`);
    err.status = response?.status || null;
    err.body = body.slice(0, 200);
    throw err;
  }
  return response.json();
}

function configuredYouTubeChannelIds({ cfg = {}, env = process.env } = {}) {
  const values = [
    cfg.youtubeChannelId,
    ...(Array.isArray(cfg.youtubeChannelIds) ? cfg.youtubeChannelIds : []),
    ...(String(env.MANANERA_YOUTUBE_CHANNEL_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)),
  ].filter(Boolean);
  const source = values.length ? values : DEFAULT_MANANERA_YOUTUBE_CHANNEL_IDS;
  return [...new Set(source.map(id => String(id).trim()).filter(Boolean))];
}

function extractYouTubeVideoId(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/(?:live|shorts|embed)\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const match = raw.match(re);
    if (match) return match[1];
  }
  return null;
}

function titleLooksLikeMananeraForDate(title, dateYmd) {
  const normalized = normalizeTranscriptText(title);
  if (!/\b(conferencia|prensa|matutina|mananera|mananera del pueblo)\b/.test(normalized)) return false;
  if (!/\b(sheinbaum|presidenta)\b/.test(normalized)) return false;
  return dateSearchTokens(dateYmd)
    .map(normalizeTranscriptText)
    .some(token => token && normalized.includes(token));
}

function addDays(dateYmd, days) {
  const [year, month, day] = String(dateYmd || '').split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return d.toISOString().slice(0, 10);
}

function youtubeSearchApiUrl({ dateYmd, channelId = null, youtubeApiKey = null, eventType = null }) {
  const q = `Conferencia de prensa matutina ${formatSpanishLongDate(dateYmd)} Presidenta Claudia Sheinbaum`;
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: '5',
    order: 'date',
    safeSearch: 'none',
    q,
    publishedAfter: new Date(`${addDays(dateYmd, -2)}T00:00:00-06:00`).toISOString(),
    publishedBefore: new Date(`${addDays(dateYmd, 1)}T00:00:00-06:00`).toISOString(),
  });
  if (channelId) params.set('channelId', channelId);
  if (youtubeApiKey) params.set('key', youtubeApiKey);
  if (eventType) params.set('eventType', eventType);
  return `${YOUTUBE_SEARCH_API_URL}?${params.toString()}`;
}

function videoUrl(videoId) {
  return `${YOUTUBE_WATCH_BASE_URL}?v=${encodeURIComponent(videoId)}`;
}

function youtubeChannelFeedUrl(channelId) {
  const params = new URLSearchParams({ channel_id: channelId });
  return `${YOUTUBE_FEED_BASE_URL}?${params.toString()}`;
}

function youtubeChannelStreamsUrl(channelId) {
  return `${YOUTUBE_CHANNEL_BASE_URL}/${encodeURIComponent(channelId)}/streams`;
}

function xmlTagText(xml, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = String(xml || '').match(re);
  return match ? decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim() : null;
}

function videosFromYouTubeFeedXml(xml) {
  const out = [];
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRe.exec(String(xml || '')))) {
    const entry = match[1];
    const id = xmlTagText(entry, 'yt:videoId') || xmlTagText(entry, 'videoId');
    const title = xmlTagText(entry, 'title') || '';
    const channelTitle = xmlTagText(xmlTagText(entry, 'author') || '', 'name') || '';
    if (!id || !title) continue;
    out.push({ id, title, channelTitle });
  }
  return out;
}

function decodeYouTubeJsonText(value) {
  const raw = String(value || '');
  try {
    return decodeHtmlEntities(JSON.parse(`"${raw.replace(/\n/g, '\\n')}"`))
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return decodeHtmlEntities(raw
      .replace(/\\u0026/g, '&')
      .replace(/\\n/g, ' ')
      .replace(/\\\//g, '/'))
      .replace(/\s+/g, ' ')
      .trim();
  }
}

function rendererTitleFromYouTubeBlock(block) {
  const source = String(block || '');
  const patterns = [
    /"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/,
    /"title":\{"simpleText":"((?:\\.|[^"\\])*)"/,
    /"title":\{"content":"((?:\\.|[^"\\])*)"/,
    /"accessibilityData":\{"label":"((?:\\.|[^"\\])*)"/,
  ];
  for (const re of patterns) {
    const match = source.match(re);
    const title = match ? decodeYouTubeJsonText(match[1]) : '';
    if (title) return title;
  }
  return '';
}

function videosFromYouTubeStreamsHtml(html) {
  const source = decodeHtmlEntities(String(html || ''))
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
  const out = [];
  const re = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
  let match;
  while ((match = re.exec(source))) {
    const id = match[1];
    if (out.some(item => item.id === id)) continue;
    const block = source.slice(match.index, Math.min(source.length, match.index + 9000));
    const title = rendererTitleFromYouTubeBlock(block);
    if (!title) continue;
    out.push({ id, title, channelTitle: '' });
  }
  return out;
}

function addYouTubeCandidate(out, video = {}) {
  const id = extractYouTubeVideoId(video.id || video.videoId || video.url);
  if (!id) return;
  if (out.some(item => item.id === id)) return;
  out.push({
    ...video,
    id,
    url: video.url || videoUrl(id),
  });
}

async function findMananeraYouTubeVideos({
  dateYmd,
  cfg = {},
  fetchImpl,
  youtubeApiKey = process.env.YOUTUBE_API_KEY,
} = {}) {
  const explicitVideoId = extractYouTubeVideoId(cfg.youtubeVideoId || cfg.youtubeUrl || cfg.videoId);
  const searchUrl = buildMananeraYouTubeSearchUrl(dateYmd);
  if (explicitVideoId) {
    return {
      ready: true,
      id: explicitVideoId,
      url: videoUrl(explicitVideoId),
      title: cfg.youtubeTitle || null,
      channelTitle: cfg.youtubeChannelTitle || null,
      searchUrl,
      explicit: true,
      videos: [{
        id: explicitVideoId,
        url: videoUrl(explicitVideoId),
        title: cfg.youtubeTitle || null,
        channelTitle: cfg.youtubeChannelTitle || null,
        searchUrl,
        explicit: true,
      }],
    };
  }

  const videos = [];
  const channelIds = configuredYouTubeChannelIds({ cfg });
  for (const channelId of channelIds) {
    try {
      const feedXml = await fetchText(fetchImpl, youtubeChannelFeedUrl(channelId), {
        accept: 'application/atom+xml,application/xml,text/xml',
      });
      for (const item of videosFromYouTubeFeedXml(feedXml)) {
        if (!titleLooksLikeMananeraForDate(item.title, dateYmd)) continue;
        addYouTubeCandidate(videos, {
          id: item.id,
          url: videoUrl(item.id),
          title: item.title,
          channelTitle: item.channelTitle,
          searchUrl,
          channelId,
          discovery: 'youtube-feed',
        });
      }
    } catch {
      // Feed is the free path. If it is unavailable, fall through to the
      // Data API search path when a key exists.
    }
  }

  for (const channelId of channelIds) {
    try {
      const streamsHtml = await fetchText(fetchImpl, youtubeChannelStreamsUrl(channelId), {
        accept: 'text/html,application/xhtml+xml',
      });
      for (const item of videosFromYouTubeStreamsHtml(streamsHtml)) {
        if (!titleLooksLikeMananeraForDate(item.title, dateYmd)) continue;
        addYouTubeCandidate(videos, {
          id: item.id,
          url: videoUrl(item.id),
          title: item.title,
          channelTitle: item.channelTitle,
          searchUrl,
          channelId,
          discovery: 'youtube-streams-tab',
        });
      }
    } catch {
      // The streams tab is a public HTML fallback for livestream archives.
      // If YouTube blocks it, the Data API search path below can still help.
    }
  }

  if (videos.length) {
    return {
      ready: true,
      ...videos[0],
      videos,
      searchUrl,
    };
  }

  if (!youtubeApiKey) {
    return {
      ready: false,
      reason: 'official_youtube_video_not_found',
      searchUrl,
    };
  }

  let apiErrorReason = null;
  for (const channelId of channelIds) {
    for (const eventType of [null, 'completed']) {
      const apiUrl = youtubeSearchApiUrl({ dateYmd, channelId, youtubeApiKey, eventType });
      let data;
      try {
        data = await fetchJson(fetchImpl, apiUrl);
      } catch (err) {
        apiErrorReason = err?.status ? `youtube_search_failed_${err.status}` : 'youtube_search_failed';
        continue;
      }
      const items = Array.isArray(data?.items) ? data.items : [];
      for (const item of items) {
        const id = item?.id?.videoId;
        const title = item?.snippet?.title || '';
        const channelTitle = item?.snippet?.channelTitle || '';
        if (!id) continue;
        if (!titleLooksLikeMananeraForDate(title, dateYmd)) continue;
        if (channelTitle && !OFFICIAL_YOUTUBE_CHANNEL_TITLE_RE.test(channelTitle) && !channelIds.includes(channelId)) continue;
        addYouTubeCandidate(videos, {
          id,
          url: videoUrl(id),
          title,
          channelTitle,
          searchUrl,
          channelId,
          discovery: eventType ? `youtube-data-api-${eventType}` : 'youtube-data-api',
        });
      }
    }
  }

  if (videos.length) {
    return {
      ready: true,
      ...videos[0],
      videos,
      searchUrl,
    };
  }

  return {
    ready: false,
    reason: apiErrorReason || 'official_youtube_video_not_found',
    searchUrl,
  };
}

async function findMananeraYouTubeVideo(options = {}) {
  const result = await findMananeraYouTubeVideos(options);
  if (!result.ready) return result;
  const first = Array.isArray(result.videos) ? result.videos[0] : null;
  return {
    ...result,
    ...(first || {}),
  };
}

function extractJsonArrayAfterMarker(text, marker) {
  const source = String(text || '');
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf('[', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  return null;
}

function extractCaptionTracks(watchHtml) {
  const json = extractJsonArrayAfterMarker(watchHtml, '"captionTracks":');
  if (!json) return [];
  try {
    const tracks = JSON.parse(json);
    return Array.isArray(tracks) ? tracks : [];
  } catch {
    return [];
  }
}

function trackName(track) {
  const name = track?.name;
  if (typeof name?.simpleText === 'string') return name.simpleText;
  if (Array.isArray(name?.runs)) return name.runs.map(r => r?.text || '').join('');
  return '';
}

function selectSpanishCaptionTrack(tracks) {
  const candidates = (Array.isArray(tracks) ? tracks : [])
    .filter(track => track?.baseUrl)
    .map(track => ({
      ...track,
      score:
        (String(track.languageCode || '').toLowerCase().startsWith('es') ? 20 : 0)
        + (/espanol|español|spanish/i.test(trackName(track)) ? 10 : 0)
        + (track.kind === 'asr' ? 0 : 3),
    }))
    .filter(track => track.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function withCaptionJsonFormat(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set('fmt', 'json3');
  return url.toString();
}

function textFromJson3Caption(data) {
  const events = Array.isArray(data?.events) ? data.events : [];
  return events
    .flatMap(event => Array.isArray(event?.segs) ? event.segs : [])
    .map(seg => seg?.utf8 || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function segmentsFromJson3Caption(data) {
  const events = Array.isArray(data?.events) ? data.events : [];
  return events
    .flatMap(event => {
      const eventStart = Number(event?.tStartMs);
      const segs = Array.isArray(event?.segs) ? event.segs : [];
      return segs.map(seg => {
        const offset = Number(seg?.tOffsetMs);
        const startMs = Number.isFinite(eventStart)
          ? eventStart + (Number.isFinite(offset) ? offset : 0)
          : null;
        return {
          text: seg?.utf8 || '',
          startMs,
        };
      });
    })
    .filter(seg => String(seg.text || '').trim());
}

function textFromXmlCaption(xml) {
  return stripHtml(String(xml || '').replace(/<text\b[^>]*>/gi, ' ').replace(/<\/text>/gi, ' '));
}

function attrValue(attrs, name) {
  const re = new RegExp(`${name}=["']([^"']+)["']`, 'i');
  const match = String(attrs || '').match(re);
  return match ? decodeHtmlEntities(match[1]) : null;
}

function segmentsFromXmlCaption(xml) {
  const out = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let match;
  while ((match = re.exec(String(xml || '')))) {
    const startSeconds = Number(attrValue(match[1], 'start'));
    const text = stripHtml(match[2]);
    if (!text) continue;
    out.push({
      text,
      startMs: Number.isFinite(startSeconds) ? Math.round(startSeconds * 1000) : null,
    });
  }
  return out;
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function youtubeTimestampUrl(baseUrl, seconds) {
  if (!baseUrl || !Number.isFinite(Number(seconds))) return null;
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('t', `${Math.max(0, Math.floor(Number(seconds)))}s`);
    return url.toString();
  } catch {
    return null;
  }
}

function findPhraseMatchTimestamps({ segments, phrase, baseUrl, max = 10 } = {}) {
  const needle = normalizeTranscriptText(phrase);
  if (!needle || !Array.isArray(segments) || segments.length === 0) return [];

  let haystack = '';
  const timeByChar = [];
  const textByChar = [];
  for (const segment of segments) {
    const rawText = String(segment?.text || '').replace(/\s+/g, ' ').trim();
    const normalized = normalizeTranscriptText(rawText);
    if (!normalized) continue;
    const startMs = Number(segment?.startMs);
    const timeMs = Number.isFinite(startMs) ? Math.max(0, startMs) : null;
    if (haystack) {
      haystack += ' ';
      timeByChar.push(timeMs);
      textByChar.push(rawText);
    }
    for (const ch of normalized) {
      haystack += ch;
      timeByChar.push(timeMs);
      textByChar.push(rawText);
    }
  }

  if (!haystack) return [];
  const pattern = escapeRegExp(needle).replace(/\s+/g, '\\s+');
  const re = new RegExp(`(^|[^a-z0-9])(${pattern})(?=$|[^a-z0-9])`, 'g');
  const matches = [];
  const seenSeconds = new Set();
  let match;
  while ((match = re.exec(haystack)) && matches.length < max) {
    const startIndex = match.index + (match[1] ? match[1].length : 0);
    if (
      needle === 'estados unidos'
      && normalizeTranscriptText(haystack.slice(startIndex, startIndex + 'estados unidos mexicanos'.length)) === 'estados unidos mexicanos'
    ) {
      continue;
    }
    const startMs = timeByChar[startIndex];
    if (!Number.isFinite(startMs)) continue;
    const seconds = Math.max(0, Math.floor(startMs / 1000));
    if (seenSeconds.has(seconds)) continue;
    seenSeconds.add(seconds);
    matches.push({
      seconds,
      label: formatTimestamp(seconds),
      url: youtubeTimestampUrl(baseUrl, seconds),
      text: textByChar[startIndex] || null,
    });
  }
  return matches;
}

function requiredTimestampEvidence({ matchTimestamps, count, threshold } = {}) {
  if (!Array.isArray(matchTimestamps) || matchTimestamps.length === 0) return [];
  const observed = Math.max(0, Math.floor(Number(count) || 0));
  const target = Math.max(1, Math.floor(Number(threshold) || 1));
  const wanted = Math.min(observed, target, matchTimestamps.length);
  return matchTimestamps.slice(0, wanted);
}

async function fetchYouTubeCaptionText({ fetchImpl, videoId }) {
  const watchHtml = await fetchText(fetchImpl, videoUrl(videoId));
  const tracks = extractCaptionTracks(watchHtml);
  const track = selectSpanishCaptionTrack(tracks);
  if (!track) {
    return {
      ready: false,
      reason: 'youtube_captions_not_found',
      captionTrackCount: Array.isArray(tracks) ? tracks.length : 0,
    };
  }

  let captionUrl;
  try {
    captionUrl = withCaptionJsonFormat(track.baseUrl);
  } catch {
    return { ready: false, reason: 'youtube_captions_invalid_url' };
  }
  const response = await fetchImpl(captionUrl, {
    headers: {
      'user-agent': 'Pronos resolver (+https://pronos.io)',
      accept: 'application/json,text/xml,text/plain',
    },
  });
  if (!response?.ok) {
    return { ready: false, reason: `youtube_captions_fetch_failed_${response?.status || 'unknown'}` };
  }
  const body = await response.text();
  const bodyLength = body.length;
  let text = '';
  let timedSegments = [];
  try {
    const data = JSON.parse(body);
    text = textFromJson3Caption(data);
    timedSegments = segmentsFromJson3Caption(data);
  } catch {
    text = textFromXmlCaption(body);
    timedSegments = segmentsFromXmlCaption(body);
  }

  if (text.length < 500) {
    return {
      ready: false,
      reason: text.length === 0 ? 'youtube_captions_empty' : 'youtube_captions_too_short',
      captionTrackCount: Array.isArray(tracks) ? tracks.length : 0,
      captionBodyLength: bodyLength,
      captionTextLength: text.length,
      captionLanguage: track.languageCode || null,
      captionName: trackName(track) || null,
      captionKind: track.kind || null,
    };
  }
  return {
    ready: true,
    text,
    timedSegments,
    captionUrl,
    captionLanguage: track.languageCode || null,
    captionName: trackName(track) || null,
    captionKind: track.kind || null,
  };
}

function finalYouTubeCaptionFailureReason(captionAttempts = []) {
  const attempts = Array.isArray(captionAttempts) ? captionAttempts : [];
  const fetchFailed = attempts.find(a => String(a?.reason || '').startsWith('youtube_captions_fetch_failed'));
  if (fetchFailed?.reason) return fetchFailed.reason;
  const empty = attempts.find(a => a?.reason === 'youtube_captions_empty');
  if (empty?.reason) return empty.reason;
  const tooShort = attempts.find(a => a?.reason === 'youtube_captions_too_short');
  if (tooShort?.reason) return tooShort.reason;
  return attempts[attempts.length - 1]?.reason || 'youtube_captions_not_found';
}

export async function findMananeraYouTubeTranscript({
  dateYmd,
  cfg = {},
  fetchImpl = globalThis.fetch,
  youtubeApiKey = process.env.YOUTUBE_API_KEY,
} = {}) {
  if (!dateYmd) throw new Error('mananera youtube: missing dateYmd');
  if (typeof fetchImpl !== 'function') throw new Error('mananera youtube: fetch unavailable');

  const videoResult = await findMananeraYouTubeVideos({
    dateYmd,
    cfg,
    fetchImpl,
    youtubeApiKey,
  });
  if (!videoResult.ready) return videoResult;

  const videos = Array.isArray(videoResult.videos) && videoResult.videos.length
    ? videoResult.videos
    : [videoResult];
  const captionAttempts = [];
  for (const video of videos) {
    const captions = await fetchYouTubeCaptionText({ fetchImpl, videoId: video.id });
    if (!captions.ready) {
      captionAttempts.push({
        videoId: video.id,
        videoUrl: video.url,
        title: video.title || null,
        channelTitle: video.channelTitle || null,
        discovery: video.discovery || null,
        reason: captions.reason || null,
        captionTrackCount: captions.captionTrackCount ?? null,
        captionBodyLength: captions.captionBodyLength ?? null,
        captionTextLength: captions.captionTextLength ?? null,
        captionLanguage: captions.captionLanguage || null,
        captionName: captions.captionName || null,
        captionKind: captions.captionKind || null,
      });
      continue;
    }

    return {
      ready: true,
      source: MANANERA_YOUTUBE_CAPTIONS_SOURCE,
      url: video.url,
      title: video.title || 'Conferencia de prensa matutina',
      text: captions.text,
      searchUrl: video.searchUrl || videoResult.searchUrl,
      videoId: video.id,
      channelTitle: video.channelTitle,
      captionUrl: captions.captionUrl,
      captionLanguage: captions.captionLanguage,
      captionName: captions.captionName,
      captionKind: captions.captionKind,
      timedSegments: captions.timedSegments,
      captionAttempts,
    };
  }

  const firstAttempt = captionAttempts[0] || null;
  return {
    ready: false,
    reason: finalYouTubeCaptionFailureReason(captionAttempts),
    searchUrl: videoResult.searchUrl,
    videoUrl: firstAttempt?.videoUrl || null,
    transcriptTitle: firstAttempt?.title || null,
    captionAttempts,
  };
}

export async function findMananeraTranscript({
  dateYmd,
  transcriptUrl = null,
  fetchImpl = globalThis.fetch,
  includeRawHtml = false,
} = {}) {
  if (!dateYmd) throw new Error('mananera: missing dateYmd');
  if (typeof fetchImpl !== 'function') throw new Error('mananera: fetch unavailable');

  const searchUrl = buildMananeraSearchUrl(dateYmd);
  const directUrl = buildMananeraDirectTranscriptUrl(dateYmd);
  const archiveUrl = buildMananeraArchiveUrl();
  const urls = [];
  if (transcriptUrl) urls.push(transcriptUrl);

  if (!transcriptUrl) {
    urls.push(directUrl);
  }

  for (const url of urls) {
    const transcript = await readTranscriptCandidate({
      fetchImpl,
      url,
      dateYmd,
      searchUrl,
      directUrl,
      archiveUrl,
      includeRawHtml,
    });
    if (transcript) return transcript;
  }

  if (!transcriptUrl) {
    const archiveHtml = await tryFetchText(fetchImpl, archiveUrl);
    for (const url of candidateUrlsFromArchiveHtml(archiveHtml || '', dateYmd)) {
      const transcript = await readTranscriptCandidate({
        fetchImpl,
        url,
        dateYmd,
        searchUrl,
        directUrl,
        archiveUrl,
        includeRawHtml,
      });
      if (transcript) return transcript;
    }

    // Last-resort compatibility fallback for older gob.mx layouts that
    // were indexed in site search before they appeared in the archive.
    const searchHtml = await tryFetchText(fetchImpl, searchUrl);
    for (const url of candidateUrlsFromSearchHtml(searchHtml || '')) {
      const transcript = await readTranscriptCandidate({
        fetchImpl,
        url,
        dateYmd,
        searchUrl,
        directUrl,
        archiveUrl,
        includeRawHtml,
      });
      if (transcript) return transcript;
    }
  }

  return {
    ready: false,
    reason: 'official_transcript_not_found',
    searchUrl,
    directUrl,
    archiveUrl,
  };
}

export async function readMananeraPhraseResult(cfg = {}, options = {}) {
  if (cfg.source !== MANANERA_TRANSCRIPT_SOURCE) {
    throw new Error(`unsupported transcript source: ${cfg.source}`);
  }
  if (!cfg.dateYmd || !cfg.phrase || cfg.threshold == null || cfg.yesOutcome == null) {
    throw new Error('invalid api_transcript config');
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const stored = options.storedTranscript || null;
  let transcript = stored?.transcriptText && String(stored.dateYmd || '').slice(0, 10) === cfg.dateYmd
    ? {
        ready: true,
        url: stored.url,
        title: stored.title || null,
        text: stored.transcriptText,
        source: stored.source || MANANERA_TRANSCRIPT_SOURCE,
        searchUrl: buildMananeraSearchUrl(cfg.dateYmd),
      }
    : null;

  if (!transcript) {
    transcript = await findMananeraTranscript({
      dateYmd: cfg.dateYmd,
      transcriptUrl: cfg.transcriptUrl || null,
      fetchImpl,
    });
  }

  if (!transcript.ready && cfg.youtubeFallback !== false) {
    const youtubeTranscript = await findMananeraYouTubeTranscript({
      dateYmd: cfg.dateYmd,
      cfg,
      fetchImpl,
      youtubeApiKey: Object.prototype.hasOwnProperty.call(options, 'youtubeApiKey')
        ? options.youtubeApiKey
        : process.env.YOUTUBE_API_KEY,
    });
    if (youtubeTranscript.ready) {
      transcript = youtubeTranscript;
    } else {
      return {
        ...transcript,
        fallbackReason: youtubeTranscript.reason || null,
        youtubeSearchUrl: youtubeTranscript.searchUrl || buildMananeraYouTubeSearchUrl(cfg.dateYmd),
        youtubeVideoUrl: youtubeTranscript.videoUrl || null,
        youtubeTranscriptTitle: youtubeTranscript.transcriptTitle || null,
        youtubeCaptionAttempts: youtubeTranscript.captionAttempts || [],
      };
    }
  }
  if (!transcript.ready) return transcript;

  const count = countPhraseOccurrences(transcript.text, cfg.phrase);
  const matchTimestamps = findPhraseMatchTimestamps({
    segments: transcript.timedSegments,
    phrase: cfg.phrase,
    baseUrl: transcript.url,
  });
  const requiredMatchTimestamps = requiredTimestampEvidence({
    matchTimestamps,
    count,
    threshold: cfg.threshold,
  });
  const firstMatch = matchTimestamps[0] || null;
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
    transcriptSource: transcript.source || MANANERA_TRANSCRIPT_SOURCE,
    searchUrl: transcript.searchUrl,
    videoId: transcript.videoId || null,
    channelTitle: transcript.channelTitle || null,
    captionLanguage: transcript.captionLanguage || null,
    captionKind: transcript.captionKind || null,
    matchTimestamps,
    requiredMatchTimestamps,
    firstMatchSeconds: firstMatch?.seconds ?? null,
    firstMatchTimestamp: firstMatch?.label || null,
    firstMatchUrl: firstMatch?.url || null,
    observedAt: new Date().toISOString(),
  };
}
