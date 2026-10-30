import { parseHTML } from 'linkedom';
import { readGranjaVipOfficialResult } from './granja-vip-official.js';
import { readInitialInpcRelease, INPC_FIRST_RELEASE_CRITERIA, INPC_RELEASE_OUTCOMES } from './inegi-inpc-release.js';
import { readInitialGdpRelease } from './inegi-gdp-release.js';
import { CUTOFF_KINDS, readCutoffResult } from './official-cutoff-snapshots.js';
import { isAutomaticContract } from './automated-market-rules.js';

export const OFFICIAL_RESULT_SOURCE = 'official-result';
const FED_CRITERIA = 'Se resuelve con el comunicado FOMC publicado el 28 de octubre de 2026 a las 14:00 ET. Recorta si el rango objetivo baja, Mantiene si no cambia, Sube si aumenta.';
const MLB_CRITERIA = 'Se resuelve con el equipo que MLB declare campeon oficial de la Serie Mundial 2026. Si la Serie Mundial se cancela, MLB no declara campeon, o hay una contingencia no cubierta por las reglas oficiales, el mercado pasa a revision manual.';
const BALLON_CRITERIA = 'Se resuelve con el ganador del Balon de Oro masculino 2026 anunciado por France Football/Ballon d’Or. Si gana alguien fuera de la lista, gana Otro.';

function nameKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function pendingOfficialResult(reason) {
  const error = new Error(reason);
  error.benign = true;
  return error;
}

export async function fetchOfficialDocument(url, { host, fetchImpl = fetch, json = false } = {}) {
  let target = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (target.protocol !== 'https:' || target.hostname !== host || target.username || target.password || target.port) {
      throw new Error('official_result_untrusted_url');
    }
    const response = await fetchImpl(target.href, {
      redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8000),
      headers: { accept: json ? 'application/json' : 'text/html', 'user-agent': 'Pronos official result resolver (+https://pronos.io)' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      target = new URL(response.headers.get('location'), target);
      continue;
    }
    if (!response.ok) throw pendingOfficialResult(`official_result_http_${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 2_000_000) throw new Error('official_result_document_too_large');
    return json ? JSON.parse(text) : text;
  }
  throw new Error('official_result_redirect_limit');
}

function rateNumber(token) {
  const text = token.trim().replace(/[¼½¾]/g, c => ({ '¼': '.25', '½': '.5', '¾': '.75' })[c]);
  const fraction = text.match(/^(\d+)[ -]+(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) + Number(fraction[2]) / Number(fraction[3]);
  return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
}

export function parseFedTargetRange(html, dateYmd) {
  const { document } = parseHTML(html);
  const article = document.querySelector('#article');
  if (!article || !/Federal Reserve issues FOMC statement/i.test(article.textContent)) {
    throw pendingOfficialResult('fed_statement_not_available');
  }
  const expectedDate = new Date(`${dateYmd}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
  });
  if (document.querySelector('.article__time')?.textContent.trim() !== expectedDate) {
    throw pendingOfficialResult('fed_statement_date_mismatch');
  }
  const body = article.querySelector('.col-md-8:not(.heading)') || article;
  const matches = [...body.textContent.replace(/\s+/g, ' ').matchAll(
    /target range for the federal funds rate[^.!?]{0,100}?\b(?:at|to|of)\s+(\d+(?:[ -]\d+\/\d+|\.\d+|[¼½¾])?)\s+to\s+(\d+(?:[ -]\d+\/\d+|\.\d+|[¼½¾])?)\s+percent/gi,
  )].map(match => [rateNumber(match[1]), rateNumber(match[2])]);
  const ranges = [...new Map(matches.map(range => [JSON.stringify(range), range])).values()];
  if (ranges.length !== 1 || !ranges[0].every(Number.isFinite)
    || ranges[0][0] < 0 || ranges[0][1] <= ranges[0][0] || ranges[0][1] > 25) {
    throw pendingOfficialResult('fed_target_range_ambiguous');
  }
  return ranges[0];
}

export function parseBallonDorWinner(html, year, now = new Date()) {
  const { document } = parseHTML(html);
  const title = document.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim();
  const match = title?.match(new RegExp(`^(.{3,80}) wins ${year} Men['’]s Ballon d['’]Or$`, 'i'));
  if (!match) return null;
  const rawDate = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content');
  const published = new Date(rawDate && /(?:Z|[+-]\d{2}:\d{2})$/.test(rawDate) ? rawDate : `${rawDate}Z`);
  if (!Number.isFinite(published.getTime()) || published > now || published.getUTCFullYear() !== year) return null;
  const winner = match[1].trim();
  const lead = [...document.querySelectorAll('p')].some(node => {
    const text = nameKey(node.textContent);
    return text.startsWith(`${nameKey(winner)} `)
      && /\bhas (?:won|been awarded)\b/.test(text)
      && text.includes(`${year} men s ballon d or`);
  });
  return lead ? { winner, officialHeadline: title, publishedAt: published.toISOString() } : null;
}

async function readBallonDorWinner(cfg, outcomes, { fetchImpl, now }) {
  const year = Number(cfg.year);
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || new Set(outcomes.map(nameKey)).size !== outcomes.length) {
    throw new Error('ballon_invalid_config');
  }
  const landing = 'https://www.uefa.com/ballondor/';
  const { document } = parseHTML(await fetchOfficialDocument(landing, { host: 'www.uefa.com', fetchImpl }));
  const links = new Set();
  for (const anchor of document.querySelectorAll('a[href]')) {
    let url;
    try { url = new URL(anchor.getAttribute('href'), landing); }
    catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== 'www.uefa.com' || !url.pathname.startsWith('/uefachampionsleague/news/')) continue;
    url.search = ''; url.hash = '';
    const text = nameKey(`${anchor.textContent} ${url.pathname}`);
    if (text.includes(`wins ${year} men s ballon d or`)) links.add(url.href);
  }
  const found = [];
  for (const url of [...links].slice(0, 6)) {
    const result = parseBallonDorWinner(await fetchOfficialDocument(url, { host: 'www.uefa.com', fetchImpl }), year, now);
    if (result) found.push({ ...result, evidenceUrl: url });
  }
  if (new Set(found.map(row => nameKey(row.winner))).size !== 1) {
    const error = pendingOfficialResult('ballon_official_winner_missing_or_ambiguous');
    error.manualReview = found.length > 1 || now - new Date(cfg.resolveAt) > 2 * 86400000;
    throw error;
  }
  const result = found[0];
  const named = outcomes.findIndex(label => nameKey(label) === nameKey(result.winner));
  const winningIdx = named >= 0 ? named : outcomes.indexOf('Otro');
  if (winningIdx < 0) throw new Error('ballon_winner_not_in_market');
  return { winningIdx, resolverInfo: { source: OFFICIAL_RESULT_SOURCE, ...result, year, award: 'men' } };
}

export function pickWorldSeriesWinner(payload, { season, outcomes }) {
  const games = (payload?.dates || []).flatMap(day => day.games || []);
  const unique = new Map();
  const seriesTeams = new Set();
  for (const game of games) {
    if (game.gameType !== 'W' || Number(game.season) !== season || game.gamesInSeries !== 7
      || !Number.isInteger(game.seriesGameNumber) || game.seriesGameNumber < 1 || game.seriesGameNumber > 7) {
      throw pendingOfficialResult('mlb_series_identity_mismatch');
    }
    if (!Number.isInteger(game.gamePk) || unique.has(game.gamePk)) throw pendingOfficialResult('mlb_series_duplicate_game');
    for (const side of [game.teams?.home, game.teams?.away]) {
      if (!Number.isInteger(side?.team?.id)) throw pendingOfficialResult('mlb_series_identity_mismatch');
      seriesTeams.add(side.team.id);
    }
    unique.set(game.gamePk, game);
  }
  const final = [...unique.values()].filter(game => game.status?.abstractGameState === 'Final');
  if (seriesTeams.size !== 2 || new Set(final.map(game => game.seriesGameNumber)).size !== final.length) {
    throw pendingOfficialResult('mlb_series_identity_mismatch');
  }
  const wins = new Map();
  const teams = new Set();
  for (const game of final) {
    const sides = [game.teams?.home, game.teams?.away];
    if (sides.some(side => !Number.isInteger(side.score) || side.score < 0)) {
      throw pendingOfficialResult('mlb_series_incomplete_score');
    }
    sides.forEach(side => teams.add(side.team.id));
    const winners = sides.filter(side => side.isWinner === true);
    if (winners.length !== 1 || winners[0].score <= sides.find(side => side !== winners[0]).score) {
      throw pendingOfficialResult('mlb_series_ambiguous_winner');
    }
    const team = winners[0].team;
    const row = wins.get(team.id) || { name: team.name, wins: 0 };
    if (row.name !== team.name) throw pendingOfficialResult('mlb_series_identity_mismatch');
    row.wins++;
    wins.set(team.id, row);
  }
  const champions = [...wins.values()].filter(team => team.wins === 4);
  if (teams.size !== 2 || final.length < 4 || final.length > 7 || champions.length !== 1
    || [...wins.values()].some(team => team.wins > 4)) throw pendingOfficialResult('mlb_world_series_not_decided');
  const winningIdx = outcomes.indexOf(champions[0].name);
  if (winningIdx < 0) throw pendingOfficialResult('mlb_champion_not_in_market');
  return { winningIdx, champion: champions[0].name, wins: [...wins.values()], gameIds: final.map(game => game.gamePk) };
}

export async function readOfficialResult(cfg, outcomes, { fetchImpl = fetch, now = new Date(), sql = null, marketId = null } = {}) {
  const readyAt = new Date(cfg.resolveAt);
  if (!Number.isFinite(readyAt.getTime()) || now < readyAt) throw pendingOfficialResult('official_result_not_due');
  if (cfg.kind === 'fed-target-range') {
    if (JSON.stringify(outcomes) !== JSON.stringify(['Recorta', 'Mantiene', 'Sube'])) throw new Error('fed_outcome_mismatch');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.statementDate) || !/^\d{4}-\d{2}-\d{2}$/.test(cfg.previousStatementDate)
      || cfg.previousStatementDate >= cfg.statementDate) throw new Error('fed_invalid_statement_dates');
    const urlFor = date => `https://www.federalreserve.gov/newsevents/pressreleases/monetary${date.replaceAll('-', '')}a.htm`;
    const currentUrl = urlFor(cfg.statementDate);
    const previousUrl = urlFor(cfg.previousStatementDate);
    const current = parseFedTargetRange(await fetchOfficialDocument(currentUrl, { host: 'www.federalreserve.gov', fetchImpl }), cfg.statementDate);
    const previous = parseFedTargetRange(await fetchOfficialDocument(previousUrl, { host: 'www.federalreserve.gov', fetchImpl }), cfg.previousStatementDate);
    const direction = current.map((value, i) => Math.sign(value - previous[i]));
    if (direction[0] !== direction[1]) throw pendingOfficialResult('fed_non_parallel_range_change');
    return { winningIdx: direction[0] + 1, resolverInfo: { source: OFFICIAL_RESULT_SOURCE, current, previous, evidenceUrl: currentUrl, previousUrl } };
  }
  if (cfg.kind === 'mlb-world-series') {
    const season = Number(cfg.season);
    if (!Number.isInteger(season) || season < 2000 || season > 2100) throw new Error('mlb_invalid_season');
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=${season}&gameTypes=W`;
    const payload = await fetchOfficialDocument(url, { host: 'statsapi.mlb.com', fetchImpl, json: true });
    const result = pickWorldSeriesWinner(payload, { season, outcomes });
    return { winningIdx: result.winningIdx, resolverInfo: { source: OFFICIAL_RESULT_SOURCE, ...result, evidenceUrl: url } };
  }
  if (cfg.kind === 'ballon-dor-men') return readBallonDorWinner(cfg, outcomes, { fetchImpl, now });
  if (cfg.kind === 'inegi-inpc-first-release') return readInitialInpcRelease(cfg, outcomes, { fetchImpl, now });
  if (cfg.kind === 'inegi-gdp-first-release') {
    if (!isAutomaticContract(cfg)) throw Object.assign(pendingOfficialResult('gdp_contract_invalid_or_modified'), { manualReview: true });
    return readInitialGdpRelease(cfg, outcomes, { fetchImpl, now });
  }
  if (CUTOFF_KINDS.includes(cfg.kind)) return readCutoffResult(cfg, outcomes, { sql, marketId, now });
  if (['granja-vip-capataz', 'granja-vip-elimination'].includes(cfg.kind)) {
    return readGranjaVipOfficialResult(cfg, outcomes, { fetchImpl, now });
  }
  throw new Error(`unsupported_official_result_${cfg.kind}`);
}

export function upgradeLegacyOfficialResult({ resolverType, cfg, source, sourceEventId, outcomes, endTime }) {
  if (!['manual', 'manual_review'].includes(resolverType) || !cfg) return null;
  if (source === 'october-tournament-2026' && sourceEventId === 'october-2026:fed-october-decision'
    && cfg.criteria === FED_CRITERIA
    && JSON.stringify(outcomes) === JSON.stringify(['Recorta', 'Mantiene', 'Sube'])) {
    return { ...cfg, source: OFFICIAL_RESULT_SOURCE, kind: 'fed-target-range', statementDate: '2026-10-28', previousStatementDate: '2026-09-16' };
  }
  if (source === 'mlb-world-series-2026' && sourceEventId === 'world-series-winner-2026'
    && cfg.competition === 'mlb-world-series' && Number(cfg.season) === 2026
    && cfg.criteria === MLB_CRITERIA
    && outcomes.length > 1 && outcomes.every((label, i) => cfg.legs?.[i]?.label === label)) {
    return { ...cfg, source: OFFICIAL_RESULT_SOURCE, kind: 'mlb-world-series', resolveAt: endTime };
  }
  if (source === 'october-tournament-2026' && sourceEventId === 'october-2026:ballon-dor-men'
    && cfg.criteria === BALLON_CRITERIA && outcomes.length > 1 && outcomes.at(-1) === 'Otro'
    && cfg.evidence?.some(row => row.url === 'https://www.uefa.com/ballondor/')) {
    return { ...cfg, source: OFFICIAL_RESULT_SOURCE, kind: 'ballon-dor-men', year: 2026 };
  }
  if (source === 'october-tournament-2026' && sourceEventId === 'october-2026:inpc-first-half-october-annual-inflation'
    && cfg.criteria === INPC_FIRST_RELEASE_CRITERIA && JSON.stringify(outcomes) === JSON.stringify(INPC_RELEASE_OUTCOMES)) {
    // Legacy specs delayed checking until the following day even though the
    // contract uses the initial release. Start just after betting closes.
    const closesAt = new Date(endTime);
    if (!endTime || !Number.isFinite(closesAt.getTime())) return null;
    return { ...cfg, source: OFFICIAL_RESULT_SOURCE, kind: 'inegi-inpc-first-release', targetPeriod: '2026-10-1Q',
      resolveAt: new Date(closesAt.getTime() + 60_000).toISOString() };
  }
  return null;
}
