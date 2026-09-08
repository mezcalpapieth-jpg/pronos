export const NETFLIX_TOP10_SOURCE = 'netflix-top10';
export const NETFLIX_TOP10_PAGE = 'https://www.netflix.com/tudum/top10';
export const NETFLIX_TOP10_GLOBAL_TSV = 'https://www.netflix.com/tudum/top10/data/all-weeks-global.tsv';
export const NETFLIX_TOP10_COUNTRIES_TSV = 'https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv';
export const NETFLIX_TOP10_GLOBAL_TV_PAGE = `${NETFLIX_TOP10_PAGE}/tv`;
export const NETFLIX_TOP10_GLOBAL_NON_ENGLISH_TV_PAGE = `${NETFLIX_TOP10_PAGE}/tv-non-english`;
export const NETFLIX_TOP10_MEXICO_TV_PAGE = `${NETFLIX_TOP10_PAGE}/mexico/tv`;

const DEFAULT_FETCH_TIMEOUT_MS = 8000;
const DEFAULT_COUNTRIES_FETCH_TIMEOUT_MS = 20000;
const DEFAULT_PAGE_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_DISCOVERY_LIMIT = 5;

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizeNetflixSlug(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

export function normalizeNetflixText(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNetflixTop10Tsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map(header => normalizeNetflixSlug(header).replace(/-/g, '_'));
  return lines.slice(1).map(line => {
    const cells = line.split('\t');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });
    return row;
  });
}

export function netflixRowValue(row, names) {
  for (const name of names) {
    const key = normalizeNetflixSlug(name).replace(/-/g, '_');
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

export function netflixTitle(row) {
  return netflixRowValue(row, ['show_title', 'title', 'name', 'season_title']);
}

export function netflixSeasonTitle(row) {
  return netflixRowValue(row, ['season_title']);
}

export function netflixDisplayTitle(row) {
  const show = netflixTitle(row);
  const season = netflixSeasonTitle(row);
  const showNorm = normalizeNetflixText(show);
  const seasonNorm = normalizeNetflixText(season);
  if (show && season && seasonNorm.startsWith(`${showNorm} `)) return season;
  if (show && season && showNorm !== seasonNorm) {
    return `${show} · ${season}`;
  }
  return show || season;
}

export function netflixWeek(row) {
  return netflixRowValue(row, ['week', 'week_of', 'week_start', 'week_start_date', 'week_ending']);
}

export function netflixRank(row) {
  return Number(netflixRowValue(row, ['weekly_rank', 'rank', 'position']));
}

export function isNetflixTvRow(row) {
  const category = netflixRowValue(row, ['category', 'list', 'type']).toLowerCase();
  return /tv|series|show/.test(category);
}

export function latestNetflixWeek(rows) {
  return rows
    .map(netflixWeek)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function netflixCountryMatches(row, country) {
  if (!country) return true;
  const wanted = normalizeNetflixText(country);
  const countryName = normalizeNetflixText(netflixRowValue(row, ['country_name', 'country', 'market']));
  const countryIso2 = normalizeNetflixText(netflixRowValue(row, ['country_iso2', 'country_code', 'iso2']));
  return countryName === wanted || countryIso2 === wanted;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function topNetflixRows(rows, { country = null, limit = DEFAULT_DISCOVERY_LIMIT } = {}) {
  const latestWeek = latestNetflixWeek(rows);
  if (!latestWeek) return [];
  return uniqueBy(
    rows
      .filter(row => netflixWeek(row) === latestWeek)
      .filter(isNetflixTvRow)
      .filter(row => netflixCountryMatches(row, country))
      .map(row => ({ row, title: netflixTitle(row), rank: netflixRank(row) }))
      .filter(item => item.title && Number.isFinite(item.rank))
      .sort((a, b) => a.rank - b.rank),
    item => normalizeNetflixSlug(item.title),
  ).slice(0, limit);
}

function withTimeoutSignal(timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (timer?.unref) timer.unref();
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

async function fetchText(url, {
  fetchImpl = fetch,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  accept = 'text/tab-separated-values,text/plain,*/*',
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('netflix_top10_fetch_unavailable');
  const { signal, cleanup } = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal,
      headers: {
        accept,
        'user-agent': 'Pronos Netflix Top 10 resolver (+https://pronos.io)',
      },
    });
    if (!response?.ok) throw new Error(`netflix_top10_http_${response?.status || 0}`);
    return await response.text();
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || e?.code === 23) {
      throw errorWithCode('netflix_top10_timeout', `netflix_top10_timeout_${timeoutMs}ms`);
    }
    throw e;
  } finally {
    cleanup();
  }
}

export async function fetchNetflixTop10Rows({
  scope = 'global',
  fetchImpl = fetch,
  globalUrl = process.env.NETFLIX_TOP10_GLOBAL_TSV_URL || NETFLIX_TOP10_GLOBAL_TSV,
  countriesUrl = process.env.NETFLIX_TOP10_COUNTRIES_TSV_URL || NETFLIX_TOP10_COUNTRIES_TSV,
  timeoutMs = null,
} = {}) {
  const normalizedScope = normalizeNetflixScope(scope);
  const url = normalizedScope === 'mx' ? countriesUrl : globalUrl;
  const effectiveTimeoutMs = timeoutMs != null && Number.isFinite(Number(timeoutMs))
    ? Number(timeoutMs)
    : normalizedScope === 'mx'
    ? DEFAULT_COUNTRIES_FETCH_TIMEOUT_MS
    : DEFAULT_FETCH_TIMEOUT_MS;
  const text = await fetchText(url, { fetchImpl, timeoutMs: effectiveTimeoutMs });
  return {
    rows: parseNetflixTop10Tsv(text),
    url,
    scope: normalizedScope,
  };
}

function decodeJavascriptStringBody(body) {
  const input = String(body || '');
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    if (i + 1 >= input.length) {
      out += '\\';
      break;
    }
    const esc = input[++i];
    switch (esc) {
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'v': out += '\v'; break;
      case '0': out += '\0'; break;
      case '\n': break;
      case '\r':
        if (input[i + 1] === '\n') i += 1;
        break;
      case 'x': {
        const hex = input.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 2;
        } else {
          out += esc;
        }
        break;
      }
      case 'u': {
        if (input[i + 1] === '{') {
          const close = input.indexOf('}', i + 2);
          const hex = close >= 0 ? input.slice(i + 2, close) : '';
          const codePoint = /^[0-9a-fA-F]+$/.test(hex) ? Number.parseInt(hex, 16) : NaN;
          if (close >= 0 && Number.isFinite(codePoint)) {
            out += String.fromCodePoint(codePoint);
            i = close;
          } else {
            out += esc;
          }
          break;
        }
        const hex = input.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
        } else {
          out += esc;
        }
        break;
      }
      default:
        out += esc;
        break;
    }
  }
  return out;
}

export function parseNetflixTop10PagePayload(html) {
  const marker = 'netflix.reactContext.models.graphql = JSON.parse(';
  const source = String(html || '');
  const start = source.indexOf(marker);
  if (start < 0) throw errorWithCode('netflix_top10_page_payload_missing');
  let i = start + marker.length;
  while (/\s/.test(source[i] || '')) i += 1;
  if (source[i] !== "'") throw errorWithCode('netflix_top10_page_payload_unexpected');

  let body = '';
  let closed = false;
  for (i += 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      body += ch;
      i += 1;
      if (i < source.length) body += source[i];
      continue;
    }
    if (ch === "'") {
      closed = true;
      break;
    }
    body += ch;
  }
  if (!closed) throw errorWithCode('netflix_top10_page_payload_unclosed');

  try {
    return JSON.parse(decodeJavascriptStringBody(body));
  } catch (e) {
    throw errorWithCode('netflix_top10_page_payload_invalid', e?.message || 'netflix_top10_page_payload_invalid');
  }
}

function pageCategoryToTsvCategory(category, scope) {
  const value = String(category || '').trim().toUpperCase();
  if (scope === 'mx') return 'TV';
  if (value === 'ENGLISH_SERIES') return 'TV (English)';
  if (value === 'NONENGLISH_SERIES') return 'TV (Non-English)';
  if (value === 'SERIES') return 'TV';
  return /SERIES|TV|SHOW/.test(value) ? 'TV' : value;
}

function parentShowTitle(parentShow) {
  if (!parentShow) return '';
  if (typeof parentShow === 'string') return parentShow;
  return String(parentShow.title || parentShow.name || '').trim();
}

function pageRowsFromPayload(payload, { scope, url } = {}) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const rows = Object.values(data)
    .filter(item => item?.__typename === 'PulseTop10ItemEntity')
    .map(item => {
      const rank = Number(item?.top10?.weeklyRank);
      const title = String(item?.top10Video?.title || '').trim();
      const parent = parentShowTitle(item?.top10Video?.parentShow);
      const showTitle = parent || title;
      return {
        ...(scope === 'mx' ? { country_name: 'Mexico', country_iso2: 'MX' } : {}),
        week: String(item?.top10?.weekEndDate || '').trim(),
        category: pageCategoryToTsvCategory(item?.top10?.category, scope),
        weekly_rank: Number.isFinite(rank) ? String(rank) : '',
        show_title: showTitle,
        season_title: parent && normalizeNetflixText(parent) !== normalizeNetflixText(title) ? title : '',
        netflix_page_url: url || '',
        netflix_page_category: item?.top10?.category || '',
      };
    })
    .filter(row => row.week && row.show_title && row.weekly_rank && isNetflixTvRow(row));

  return uniqueBy(
    rows.sort((a, b) => netflixRank(a) - netflixRank(b)),
    row => [
      row.week,
      row.category,
      row.country_iso2 || 'global',
      row.weekly_rank,
      normalizeNetflixSlug(row.show_title),
      normalizeNetflixSlug(row.season_title),
    ].join('|'),
  );
}

async function fetchNetflixTop10PageRowsForUrl(url, {
  scope,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_PAGE_FETCH_TIMEOUT_MS,
} = {}) {
  const text = await fetchText(url, {
    fetchImpl,
    timeoutMs,
    accept: 'text/html,application/xhtml+xml,*/*',
  });
  return pageRowsFromPayload(parseNetflixTop10PagePayload(text), { scope, url });
}

export async function fetchNetflixTop10PageRows({
  scope = 'global',
  fetchImpl = fetch,
  globalTvUrl = NETFLIX_TOP10_GLOBAL_TV_PAGE,
  globalNonEnglishTvUrl = NETFLIX_TOP10_GLOBAL_NON_ENGLISH_TV_PAGE,
  mexicoTvUrl = NETFLIX_TOP10_MEXICO_TV_PAGE,
  timeoutMs = DEFAULT_PAGE_FETCH_TIMEOUT_MS,
} = {}) {
  const normalizedScope = normalizeNetflixScope(scope);
  const urls = normalizedScope === 'mx'
    ? [mexicoTvUrl]
    : [globalTvUrl, globalNonEnglishTvUrl];
  const pages = await Promise.all(urls.map(url => fetchNetflixTop10PageRowsForUrl(url, {
    scope: normalizedScope,
    fetchImpl,
    timeoutMs,
  })));
  return {
    rows: pages.flat(),
    url: urls[0],
    urls,
    scope: normalizedScope,
    source: 'official-page',
  };
}

export function normalizeNetflixScope(value) {
  const scope = String(value || '').trim().toLowerCase();
  if (['mx', 'mexico', 'méxico'].includes(scope)) return 'mx';
  return 'global';
}

function titleMatches(row, title) {
  const wanted = normalizeNetflixText(title);
  if (!wanted) return false;
  const show = netflixTitle(row);
  const season = netflixSeasonTitle(row);
  const candidates = [
    show,
    season,
    `${show} ${season}`,
    `${show}: ${season}`,
    netflixDisplayTitle(row),
  ].map(normalizeNetflixText).filter(Boolean);
  return candidates.includes(wanted);
}

function yesNoOutcomeIndexes(outcomes = []) {
  const labels = Array.isArray(outcomes) ? outcomes : [];
  const yes = labels.findIndex(label => /^(si|sí|yes)$/i.test(normalizeNetflixText(label)));
  const no = labels.findIndex(label => /^(no)$/i.test(normalizeNetflixText(label)));
  return {
    yesOutcome: yes >= 0 ? yes : 0,
    noOutcome: no >= 0 ? no : 1,
  };
}

function errorWithCode(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function netflixResolutionRows(rows, { scope, week }) {
  return rows
    .filter(row => netflixWeek(row) === week)
    .filter(isNetflixTvRow)
    .filter(row => scope !== 'mx' || netflixCountryMatches(row, 'Mexico') || netflixCountryMatches(row, 'MX'));
}

export async function buildNetflixTop10ResolutionReview({
  market,
  cfg,
  sourceData,
  outcomes,
  rows = null,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const data = sourceData && typeof sourceData === 'object' ? sourceData : {};
  const config = cfg && typeof cfg === 'object' ? cfg : {};
  const scope = normalizeNetflixScope(data.scope || config.scope);
  const targetRank = Number(data.targetRank ?? config.targetRank ?? (scope === 'mx' ? 3 : 1));
  const title = String(data.title || config.title || '').trim();
  if (!title) throw errorWithCode('netflix_top10_missing_title');
  if (!Number.isFinite(targetRank) || targetRank < 1) throw errorWithCode('netflix_top10_invalid_target_rank');

  let fetched = rows
    ? { rows, url: scope === 'mx' ? NETFLIX_TOP10_COUNTRIES_TSV : NETFLIX_TOP10_GLOBAL_TSV }
    : await fetchNetflixTop10Rows({ scope, fetchImpl });
  let fetchedSource = rows ? 'provided-rows' : 'official-tsv';
  let scopeRows = fetched.rows
    .filter(isNetflixTvRow)
    .filter(row => scope !== 'mx' || netflixCountryMatches(row, 'Mexico') || netflixCountryMatches(row, 'MX'));
  let latestWeek = latestNetflixWeek(scopeRows);
  if (!latestWeek) throw errorWithCode('netflix_top10_empty');
  const latestKnownWeek = String(data.latestKnownWeek || config.latestKnownWeek || '').trim();
  if (latestKnownWeek && latestWeek <= latestKnownWeek && !rows) {
    try {
      const pageFetched = await fetchNetflixTop10PageRows({ scope, fetchImpl });
      const pageRows = pageFetched.rows
        .filter(isNetflixTvRow)
        .filter(row => scope !== 'mx' || netflixCountryMatches(row, 'Mexico') || netflixCountryMatches(row, 'MX'));
      const pageLatestWeek = latestNetflixWeek(pageRows);
      if (pageLatestWeek && pageLatestWeek > latestKnownWeek) {
        fetched = pageFetched;
        fetchedSource = 'official-page';
        scopeRows = pageRows;
        latestWeek = pageLatestWeek;
      }
    } catch (e) {
      throw errorWithCode(
        'netflix_top10_page_fallback_failed',
        e?.message || 'netflix_top10_page_fallback_failed',
      );
    }
  }
  if (latestKnownWeek && latestWeek <= latestKnownWeek) {
    throw errorWithCode('netflix_top10_not_published_yet');
  }

  const scopedRows = netflixResolutionRows(scopeRows, { scope, week: latestWeek })
    .map(row => ({ row, rank: netflixRank(row), title: netflixTitle(row) }))
    .filter(item => item.title && Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank);
  const match = scopedRows.find(item => titleMatches(item.row, title));
  const rank = Number(match?.rank);
  const inTarget = Number.isFinite(rank) && rank <= targetRank;
  const { yesOutcome, noOutcome } = yesNoOutcomeIndexes(outcomes);
  const suggestedOutcomeIndex = inTarget ? yesOutcome : noOutcome;
  const scopeLabel = scope === 'mx' ? 'México' : 'global';
  const targetLabel = targetRank === 1 ? '#1' : `Top ${targetRank}`;
  const finalScore = match
    ? `Netflix Top 10 ${scopeLabel}: #${rank} ${netflixDisplayTitle(match.row)} (${latestWeek})`
    : `Netflix Top 10 ${scopeLabel}: ${title} no aparece en TV (${latestWeek})`;
  const label = inTarget ? 'Sí' : 'No';
  const evidence = fetchedSource === 'official-page'
    ? [
        { title: 'Netflix Top 10', url: NETFLIX_TOP10_PAGE },
        ...(fetched.urls || [fetched.url]).filter(Boolean).map(url => ({
          title: url.includes('/mexico/') ? 'Netflix Mexico TV page' : 'Netflix global TV page',
          url,
        })),
      ]
    : [
        { title: 'Netflix Top 10', url: NETFLIX_TOP10_PAGE },
        {
          title: scope === 'mx' ? 'Netflix countries TSV' : 'Netflix global TSV',
          url: fetched.url,
        },
      ];

  return {
    resolverConfigPatch: {
      ...(config || {}),
      source: NETFLIX_TOP10_SOURCE,
      sourceEventId: config.sourceEventId || market?.source_event_id || data.weekKey || String(market?.id || ''),
      suggestedOutcomeIndex,
      autoResolve: true,
      autoResolveSource: fetchedSource,
      confidenceBps: match ? 8200 : 7800,
      finalScore,
      evidenceUrl: NETFLIX_TOP10_PAGE,
      evidence,
      sourceUrls: evidence.map(item => item.url).filter(Boolean),
      rationale: `Netflix Top 10 sugiere ${label}: ${title} ${match ? `aparece en #${rank}` : 'no aparece'} para ${scopeLabel} en la semana ${latestWeek}; criterio del mercado: ${targetLabel}.`,
    },
    sourceDataPatch: {
      netflixTop10LastSnapshot: {
        observedAt: now.toISOString(),
        scope,
        latestWeek,
        title,
        targetRank,
        matchedTitle: match ? netflixDisplayTitle(match.row) : null,
        rank: Number.isFinite(rank) ? rank : null,
        source: fetchedSource,
      },
    },
  };
}

export function isNetflixTop10Market({ cfg, row, sourceData } = {}) {
  const source = String(row?.source || cfg?.source || sourceData?.source || sourceData?.sourceProvider || '').trim().toLowerCase();
  const kind = String(sourceData?.kind || '').trim().toLowerCase();
  return source === NETFLIX_TOP10_SOURCE
    || source === 'manual-netflix-top10'
    || kind === 'netflix_top10';
}

export const _internal = {
  netflixCountryMatches,
  netflixResolutionRows,
  parseNetflixTop10PagePayload,
  titleMatches,
  yesNoOutcomeIndexes,
};
