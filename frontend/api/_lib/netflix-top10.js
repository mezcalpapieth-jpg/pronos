export const NETFLIX_TOP10_SOURCE = 'netflix-top10';
export const NETFLIX_TOP10_PAGE = 'https://www.netflix.com/tudum/top10';
export const NETFLIX_TOP10_GLOBAL_TSV = 'https://www.netflix.com/tudum/top10/data/all-weeks-global.tsv';
export const NETFLIX_TOP10_COUNTRIES_TSV = 'https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv';

const DEFAULT_FETCH_TIMEOUT_MS = 8000;
const DEFAULT_COUNTRIES_FETCH_TIMEOUT_MS = 20000;
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
  if (show && season && normalizeNetflixText(show) !== normalizeNetflixText(season)) {
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
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('netflix_top10_fetch_unavailable');
  const { signal, cleanup } = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal,
      headers: {
        accept: 'text/tab-separated-values,text/plain,*/*',
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

  const fetched = rows
    ? { rows, url: scope === 'mx' ? NETFLIX_TOP10_COUNTRIES_TSV : NETFLIX_TOP10_GLOBAL_TSV }
    : await fetchNetflixTop10Rows({ scope, fetchImpl });
  const scopeRows = fetched.rows
    .filter(isNetflixTvRow)
    .filter(row => scope !== 'mx' || netflixCountryMatches(row, 'Mexico') || netflixCountryMatches(row, 'MX'));
  const latestWeek = latestNetflixWeek(scopeRows);
  if (!latestWeek) throw errorWithCode('netflix_top10_empty');
  const latestKnownWeek = String(data.latestKnownWeek || config.latestKnownWeek || '').trim();
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
  const evidence = [
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
      confidenceBps: match ? 8200 : 7800,
      finalScore,
      evidenceUrl: NETFLIX_TOP10_PAGE,
      evidence,
      sourceUrls: evidence.map(item => item.url).filter(Boolean),
      rationale: `Netflix Top 10 sugiere ${label}: ${title} ${match ? `aparece en #${rank}` : 'no aparece'} para ${scopeLabel} en la semana ${latestWeek}; criterio del mercado: ${targetLabel}. Admin debe confirmar antes de pagar MXNP.`,
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
  titleMatches,
  yesNoOutcomeIndexes,
};
