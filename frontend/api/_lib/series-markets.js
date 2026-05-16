const ESPN_SERIES_LEAGUES = new Set(['basketball/nba', 'baseball/mlb']);

function compact(value) {
  return String(value || '').trim();
}

function normalizeKeyPart(value) {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function teamId(team) {
  return compact(team?.id || team?.uid || team?.abbreviation || team?.displayName || team?.name);
}

function shortTeamName(team, fallback) {
  return compact(team?.shortDisplayName || team?.shortName || team?.name || team?.displayName || team?.abbreviation || fallback);
}

function parseJsonMaybe(value, fallback = null) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function textPool(...values) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .map((value) => typeof value === 'string' ? value : JSON.stringify(value))
    .join(' · ');
}

function extractGameNumberFromText(text) {
  const raw = compact(text);
  if (!raw) return null;
  const patterns = [
    /\bgame\s*#?\s*(\d{1,2})\b/i,
    /\bgm\.?\s*(\d{1,2})\b/i,
    /\bjuego\s*#?\s*(\d{1,2})\b/i,
    /\bpartido\s*#?\s*(\d{1,2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      const n = Number(match[1]);
      if (Number.isInteger(n) && n > 0 && n <= 9) return n;
    }
  }
  return null;
}

function extractBestOfFromText(text) {
  const raw = compact(text);
  if (!raw) return null;
  const patterns = [
    /\bbest\s+of\s+(\d{1,2})\b/i,
    /\bgame\s+\d{1,2}\s+of\s+(\d{1,2})\b/i,
    /\bjuego\s+\d{1,2}\s+de\s+(\d{1,2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      const n = Number(match[1]);
      if (n === 5 || n === 7) return n;
    }
  }
  return null;
}

function readEspnSeriesObject(ev, comp) {
  return comp?.series || ev?.series || ev?.competitions?.[0]?.series || null;
}

function bestOfFromSeriesObject(series) {
  const candidates = [
    series?.totalCompetitions,
    series?.totalGames,
    series?.maximumGameCount,
    series?.maxGames,
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (n === 5 || n === 7) return n;
  }
  return null;
}

function gameNumberFromSeriesObject(series) {
  const candidates = [
    series?.gameNumber,
    series?.currentGameNumber,
    series?.game,
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isInteger(n) && n > 0 && n <= 9) return n;
  }
  return null;
}

function seriesWinsFromSeriesObject(series, home, away) {
  const competitors = Array.isArray(series?.competitors) ? series.competitors : [];
  if (!competitors.length) return null;
  const homeId = teamId(home?.team || home);
  const awayId = teamId(away?.team || away);
  let homeWins = null;
  let awayWins = null;
  for (const item of competitors) {
    const id = teamId(item?.team || item);
    const wins = Number(item?.wins ?? item?.record?.wins ?? item?.seriesWins);
    if (!Number.isFinite(wins)) continue;
    if (id && homeId && id === homeId) homeWins = wins;
    if (id && awayId && id === awayId) awayWins = wins;
  }
  if (homeWins == null && awayWins == null) return null;
  return { homeWins: homeWins || 0, awayWins: awayWins || 0 };
}

function validGameNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 9 ? n : null;
}

function validSeriesWins(value) {
  if (!value || typeof value !== 'object') return null;
  const homeWins = Number(value.homeWins);
  const awayWins = Number(value.awayWins);
  if (!Number.isFinite(homeWins) || !Number.isFinite(awayWins)) return null;
  return {
    homeWins: Math.max(0, homeWins),
    awayWins: Math.max(0, awayWins),
  };
}

export function buildSeriesKey({ leaguePath, seasonYear, round, homeTeam, awayTeam } = {}) {
  const home = teamId(homeTeam);
  const away = teamId(awayTeam);
  if (!leaguePath || !home || !away) return null;
  const teams = [home, away].sort().map(normalizeKeyPart).join('-');
  const roundPart = round ? normalizeKeyPart(round) : 'series';
  return [normalizeKeyPart(leaguePath), seasonYear || 'season', roundPart, teams].join(':');
}

export function extractEspnSeriesMeta(ev, {
  leaguePath,
  league,
  sport,
  fallbackBestOf,
} = {}) {
  if (!ev || !ESPN_SERIES_LEAGUES.has(leaguePath)) return null;
  const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
  const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  if (!home?.team || !away?.team) return null;

  const series = readEspnSeriesObject(ev, comp);
  const notes = [
    ev.name,
    ev.shortName,
    ev?.competitions?.[0]?.notes,
    comp?.notes,
    series?.summary,
    series?.description,
    series?.shortName,
  ];
  const pool = textPool(notes);
  const gameNumber = gameNumberFromSeriesObject(series) || extractGameNumberFromText(pool);
  if (!gameNumber) return null;

  const seasonYear = ev?.season?.year || new Date(ev.date || Date.now()).getUTCFullYear();
  const round = compact(series?.round || series?.name || (ev?.season?.type === 3 ? series?.name : '')) || null;
  const bestOf = bestOfFromSeriesObject(series) || extractBestOfFromText(pool) || fallbackBestOf || 7;
  const homeTeam = {
    id: home.team.id || null,
    name: home.team.displayName || home.team.name || null,
    shortName: shortTeamName(home.team),
    abbreviation: home.team.abbreviation || null,
  };
  const awayTeam = {
    id: away.team.id || null,
    name: away.team.displayName || away.team.name || null,
    shortName: shortTeamName(away.team),
    abbreviation: away.team.abbreviation || null,
  };
  const key = buildSeriesKey({ leaguePath, seasonYear, round, homeTeam, awayTeam });
  if (!key) return null;

  return {
    key,
    leaguePath,
    league: league || null,
    sport: sport || null,
    gameNumber,
    bestOf,
    winTarget: Math.floor(bestOf / 2) + 1,
    guaranteedGames: bestOf === 5 ? 3 : 4,
    round,
    seasonYear,
    homeTeam,
    awayTeam,
    teams: [homeTeam, awayTeam],
    espnSeriesWins: seriesWinsFromSeriesObject(series, home, away),
  };
}

export function normalizeSeriesMeta({ resolverConfig, sourceData, row } = {}) {
  const cfg = parseJsonMaybe(resolverConfig, resolverConfig || null);
  const sd = parseJsonMaybe(sourceData, sourceData || null);
  const series = cfg?.series || sd?.series || null;
  const leaguePath = cfg?.leaguePath || series?.leaguePath || null;
  if (!series && !ESPN_SERIES_LEAGUES.has(leaguePath)) return null;

  const outcomes = parseJsonMaybe(row?.outcomes, row?.outcomes || []);
  const home = series?.homeTeam || sd?.home || {
    id: null,
    name: outcomes?.[0] || null,
    shortName: outcomes?.[0] || null,
  };
  const away = series?.awayTeam || sd?.away || {
    id: null,
    name: outcomes?.[1] || null,
    shortName: outcomes?.[1] || null,
  };
  const seasonYear = series?.seasonYear || sd?.seasonYear || (row?.start_time ? new Date(row.start_time).getUTCFullYear() : null);
  const round = series?.round || sd?.round || null;
  const key = series?.key || buildSeriesKey({ leaguePath, seasonYear, round, homeTeam: home, awayTeam: away });
  const gameNumber = Number(series?.gameNumber);
  const bestOf = Number(series?.bestOf || 7);
  if (!key) return null;

  return {
    key,
    leaguePath,
    league: series?.league || row?.league || null,
    sport: series?.sport || row?.sport || null,
    gameNumber: Number.isInteger(gameNumber) && gameNumber > 0 ? gameNumber : null,
    bestOf: bestOf === 5 || bestOf === 7 ? bestOf : 7,
    winTarget: Math.floor((bestOf === 5 || bestOf === 7 ? bestOf : 7) / 2) + 1,
    guaranteedGames: (bestOf === 5 ? 3 : 4),
    round,
    seasonYear,
    homeTeam: home,
    awayTeam: away,
    teams: [home, away],
    espnSeriesWins: validSeriesWins(series?.espnSeriesWins),
  };
}

export function teamPairKeyFromMeta(meta) {
  const teams = [teamId(meta?.homeTeam), teamId(meta?.awayTeam)].filter(Boolean);
  if (teams.length !== 2) return null;
  return teams.sort().map(normalizeKeyPart).join('|');
}

export function seriesScoreSummary({ teamAWins = 0, teamBWins = 0, teamAName, teamBName } = {}) {
  const a = Math.max(0, Number(teamAWins) || 0);
  const b = Math.max(0, Number(teamBWins) || 0);
  if (a === b) return `Series tied ${a}-${b}`;
  if (a > b) return `${compact(teamAName) || 'Team A'} lead ${a}-${b}`;
  return `${compact(teamBName) || 'Team B'} lead ${b}-${a}`;
}

export function seriesSubtitle({ gameNumber, summary } = {}) {
  if (!gameNumber) return summary || null;
  return summary ? `Game ${gameNumber} · ${summary}` : `Game ${gameNumber}`;
}

export function seriesGameGate({ bestOf, gameNumber, teamAWins = 0, teamBWins = 0, status } = {}) {
  const game = validGameNumber(gameNumber);
  const size = bestOf === 5 || bestOf === 7 ? bestOf : 7;
  const guaranteedGames = size === 5 ? 3 : 4;
  const winTarget = Math.floor(size / 2) + 1;
  const a = Math.max(0, Number(teamAWins) || 0);
  const b = Math.max(0, Number(teamBWins) || 0);
  const totalWins = a + b;
  const minWins = Math.min(a, b);
  const clinched = a >= winTarget || b >= winTarget;

  if (!game || status === 'resolved') {
    return { status: status || null, seriesLocked: false, reason: null };
  }
  if (game <= guaranteedGames) {
    return { status: status || 'active', seriesLocked: false, reason: null };
  }
  if (clinched) {
    return { status: 'not_needed', seriesLocked: true, reason: 'series_clinched' };
  }

  const requiredMinWins = game - guaranteedGames;
  const requiredTotalWins = requiredMinWins * 2;
  const unlocked = minWins >= requiredMinWins && totalWins >= requiredTotalWins;
  if (unlocked) {
    return { status: status || 'active', seriesLocked: false, reason: null };
  }
  return {
    status: 'pending',
    seriesLocked: true,
    reason: `requires_series_${requiredMinWins}_${requiredTotalWins - requiredMinWins}`,
  };
}

export function applySeriesGateToMarket(market, seriesMeta = market?.seriesMeta) {
  if (!market || market.status === 'resolved') return market;
  const gameNumber = validGameNumber(seriesMeta?.gameNumber || market.gameNumber);
  const wins = validSeriesWins(seriesMeta?.espnSeriesWins);
  if (!gameNumber) return market;
  if (gameNumber <= (seriesMeta?.guaranteedGames || (seriesMeta?.bestOf === 5 ? 3 : 4))) return market;
  const resolvedWins = wins || { homeWins: 0, awayWins: 0 };

  const gate = seriesGameGate({
    bestOf: seriesMeta?.bestOf,
    gameNumber,
    teamAWins: resolvedWins.homeWins,
    teamBWins: resolvedWins.awayWins,
    status: market.status,
  });
  if (!gate.seriesLocked) return market;
  return {
    ...market,
    actualStatus: market.actualStatus || market.status,
    status: gate.status,
    live: false,
    seriesLocked: true,
    seriesLockReason: gate.reason,
  };
}

export function applySeriesDetailGateToMarket(market, seriesMeta = market?.seriesMeta) {
  if (!market || market.status === 'resolved') return market;
  const currentItem = Array.isArray(seriesMeta?.sequence)
    ? seriesMeta.sequence.find((item) => Number(item.id) === Number(market.id))
    : null;
  if (!currentItem?.seriesLocked) {
    if (!market.actualStatus) return market;
    const restoredStatus = market.actualStatus;
    const startMs = market.startTime ? new Date(market.startTime).getTime() : 0;
    const endMs = market.endTime ? new Date(market.endTime).getTime() : 0;
    return {
      ...market,
      status: restoredStatus,
      actualStatus: null,
      seriesLocked: false,
      seriesLockReason: null,
      live: restoredStatus === 'active'
        && startMs > 0
        && endMs > startMs
        && startMs <= Date.now()
        && endMs > Date.now(),
    };
  }
  return {
    ...market,
    actualStatus: market.actualStatus || market.status,
    status: currentItem.status,
    live: false,
    seriesLocked: true,
    seriesLockReason: currentItem.seriesLockReason || null,
  };
}

function summarizeSeriesGateRow(row, fallbackMeta, rawMeta = null) {
  const outcomes = parseJsonMaybe(row?.outcomes, row?.outcomes || ['Sí', 'No']);
  const meta = rawMeta || normalizeSeriesMeta({
    resolverConfig: row?.resolver_config ?? row?.resolverConfig,
    sourceData: row?.pending_source_data ?? row?.protocol_source_data ?? row?.source_data,
    row,
  });
  return {
    id: row?.id,
    question: row?.question,
    outcomes,
    status: row?.status,
    outcome: row?.outcome,
    resolvedAt: row?.resolved_at ?? row?.resolvedAt ?? null,
    finalScore: row?.final_score ?? row?.finalScore ?? null,
    startTime: row?.start_time ?? row?.startTime ?? null,
    endTime: row?.end_time ?? row?.endTime ?? null,
    seriesMeta: {
      ...fallbackMeta,
      gameNumber: meta?.gameNumber || null,
      espnSeriesWins: meta?.espnSeriesWins || fallbackMeta?.espnSeriesWins || null,
    },
  };
}

export function seriesTradeLockFromRows(currentRow, rows = []) {
  const currentMeta = normalizeSeriesMeta({
    resolverConfig: currentRow?.resolver_config ?? currentRow?.resolverConfig,
    sourceData: currentRow?.pending_source_data ?? currentRow?.protocol_source_data ?? currentRow?.source_data,
    row: currentRow,
  });
  if (!currentMeta?.gameNumber) return null;
  if (currentMeta.gameNumber <= currentMeta.guaranteedGames) return null;
  const currentPair = teamPairKeyFromMeta(currentMeta);
  if (!currentPair) return null;
  const items = rows
    .map((row) => {
      const meta = normalizeSeriesMeta({
        resolverConfig: row?.resolver_config ?? row?.resolverConfig,
        sourceData: row?.pending_source_data ?? row?.protocol_source_data ?? row?.source_data,
        row,
      });
      if (!meta || meta.leaguePath !== currentMeta.leaguePath) return null;
      if (teamPairKeyFromMeta(meta) !== currentPair) return null;
      return summarizeSeriesGateRow(row, currentMeta, meta);
    })
    .filter(Boolean);
  if (!items.some((item) => Number(item.id) === Number(currentRow.id))) {
    items.push(summarizeSeriesGateRow(currentRow, currentMeta, currentMeta));
  }
  const detail = buildSeriesDetail(currentMeta, items);
  const currentItem = detail?.sequence?.find((item) => Number(item.id) === Number(currentRow.id));
  if (!currentItem?.seriesLocked) return null;
  return {
    locked: true,
    status: currentItem.status,
    reason: currentItem.seriesLockReason || null,
    summary: detail.summary || null,
  };
}

function winnerTeamKey(item) {
  if (item?.status !== 'resolved') return null;
  const outcome = Number(item.outcome);
  if (!Number.isInteger(outcome)) return null;
  const outcomes = Array.isArray(item.outcomes) ? item.outcomes : [];
  const label = outcomes[outcome];
  return normalizeKeyPart(label);
}

function teamKeySet(team) {
  return new Set([team?.id, team?.name, team?.shortName, team?.abbreviation].map(normalizeKeyPart).filter(Boolean));
}

function setsOverlap(a, b) {
  for (const value of a || []) {
    if (b?.has(value)) return true;
  }
  return false;
}

function officialWinsForTeams(candidateMeta, teamAKeys, teamBKeys) {
  const wins = validSeriesWins(candidateMeta?.espnSeriesWins);
  if (!wins) return null;
  const homeKeys = teamKeySet(candidateMeta?.homeTeam);
  const awayKeys = teamKeySet(candidateMeta?.awayTeam);
  let teamAWins = null;
  let teamBWins = null;

  if (setsOverlap(homeKeys, teamAKeys)) teamAWins = wins.homeWins;
  if (setsOverlap(homeKeys, teamBKeys)) teamBWins = wins.homeWins;
  if (setsOverlap(awayKeys, teamAKeys)) teamAWins = wins.awayWins;
  if (setsOverlap(awayKeys, teamBKeys)) teamBWins = wins.awayWins;

  if (teamAWins == null || teamBWins == null) return null;
  return { teamAWins, teamBWins };
}

function compareSeriesTime(a, b) {
  const at = new Date(a.startTime || a.start_time || a.endTime || a.end_time || 0).getTime();
  const bt = new Date(b.startTime || b.start_time || b.endTime || b.end_time || 0).getTime();
  const aHasTime = Number.isFinite(at) && at > 0;
  const bHasTime = Number.isFinite(bt) && bt > 0;
  if (aHasTime && bHasTime && at !== bt) return at - bt;
  if (aHasTime !== bHasTime) return aHasTime ? -1 : 1;
  const ag = validGameNumber(a.explicitGameNumber);
  const bg = validGameNumber(b.explicitGameNumber);
  if (ag != null && bg != null && ag !== bg) return ag - bg;
  if ((ag != null) !== (bg != null)) return ag != null ? -1 : 1;
  return (a._ordinal || 0) - (b._ordinal || 0);
}

export function buildSeriesDetail(meta, markets = []) {
  if (!meta) return null;
  const normalizedMarkets = markets
    .map((market, index) => {
      const marketMeta = market.seriesMeta || normalizeSeriesMeta({ resolverConfig: market.resolverConfig, sourceData: market.sourceData, row: market });
      const explicitGameNumber = validGameNumber(marketMeta?.gameNumber || market.gameNumber);
      return {
        ...market,
        seriesMeta: marketMeta,
        explicitGameNumber,
        gameNumber: explicitGameNumber,
        _ordinal: index + 1,
      };
    })
    .filter((market) => market.seriesMeta?.key === meta.key);

  const reservedExplicitGames = new Set(normalizedMarkets.map((market) => market.explicitGameNumber).filter(Boolean));
  const usedGames = new Set();
  [...normalizedMarkets].sort(compareSeriesTime).forEach((market, index) => {
    if (market.explicitGameNumber) {
      market.gameNumber = market.explicitGameNumber;
      usedGames.add(market.gameNumber);
      return;
    }
    let inferred = index + 1;
    while (usedGames.has(inferred) || reservedExplicitGames.has(inferred)) inferred += 1;
    market.gameNumber = inferred;
    usedGames.add(inferred);
  });

  normalizedMarkets.sort((a, b) => {
    const ag = a.gameNumber || 999;
    const bg = b.gameNumber || 999;
    if (ag !== bg) return ag - bg;
    const at = a.startTime || a.start_time || '';
    const bt = b.startTime || b.start_time || '';
    return String(at).localeCompare(String(bt)) || Number(a.id || 0) - Number(b.id || 0);
  });

  const teamA = meta.teams?.[0] || meta.homeTeam || {};
  const teamB = meta.teams?.[1] || meta.awayTeam || {};
  const teamAKeys = teamKeySet(teamA);
  const teamBKeys = teamKeySet(teamB);
  let teamAWins = 0;
  let teamBWins = 0;
  for (const market of normalizedMarkets) {
    const winner = winnerTeamKey(market);
    if (!winner) continue;
    if (teamAKeys.has(winner)) teamAWins += 1;
    else if (teamBKeys.has(winner)) teamBWins += 1;
  }
  const officialCandidates = [meta, ...normalizedMarkets.map(market => market.seriesMeta)].filter(Boolean);
  let officialWins = null;
  for (const candidate of officialCandidates) {
    const candidateWins = officialWinsForTeams(candidate, teamAKeys, teamBKeys);
    if (!candidateWins) continue;
    if (!officialWins || (candidateWins.teamAWins + candidateWins.teamBWins) >= (officialWins.teamAWins + officialWins.teamBWins)) {
      officialWins = candidateWins;
    }
  }
  if (officialWins && (officialWins.teamAWins + officialWins.teamBWins) >= (teamAWins + teamBWins)) {
    teamAWins = officialWins.teamAWins;
    teamBWins = officialWins.teamBWins;
  }

  const bestOf = meta.bestOf === 5 || meta.bestOf === 7 ? meta.bestOf : 7;
  const winTarget = Math.floor(bestOf / 2) + 1;
  const guaranteedGames = bestOf === 5 ? 3 : 4;
  const maxActualGame = Math.max(0, ...normalizedMarkets.map((market) => Number(market.gameNumber) || 0));
  const completedGames = Math.min(bestOf, Math.max(
    teamAWins + teamBWins,
    ...normalizedMarkets
      .filter((market) => market.status === 'resolved')
      .map((market) => Number(market.gameNumber) || 0),
  ));
  const sequenceStart = Math.min(1, ...normalizedMarkets.map((market) => Number(market.gameNumber) || 1));
  const shouldShowThrough = Math.max(maxActualGame, Math.min(bestOf, guaranteedGames));
  const clinched = teamAWins >= winTarget || teamBWins >= winTarget;
  const summary = seriesScoreSummary({
    teamAWins,
    teamBWins,
    teamAName: shortTeamName(teamA, 'Team A'),
    teamBName: shortTeamName(teamB, 'Team B'),
  });
  const byGame = new Map(normalizedMarkets.map((market) => [Number(market.gameNumber), market]));
  const sequence = [];
  for (let game = sequenceStart; game <= bestOf; game++) {
    const actual = byGame.get(game);
    if (actual) {
      const gate = seriesGameGate({
        bestOf,
        gameNumber: game,
        teamAWins,
        teamBWins,
        status: actual.status,
      });
      const displayStatus = gate.seriesLocked ? gate.status : actual.status;
      sequence.push({
        id: actual.id,
        gameNumber: game,
        question: actual.question,
        status: displayStatus,
        actualStatus: displayStatus !== actual.status ? actual.status : null,
        outcome: actual.outcome ?? null,
        startTime: actual.startTime || actual.start_time || null,
        endTime: actual.endTime || actual.end_time || null,
        finalScore: actual.finalScore || actual.final_score || null,
        subtitle: seriesSubtitle({ gameNumber: game, summary }),
        summary,
        placeholder: actual.placeholder === true || actual.id == null,
        seriesLocked: gate.seriesLocked,
        seriesLockReason: gate.reason,
      });
      continue;
    }
    if (game <= shouldShowThrough || game > guaranteedGames) {
      const missingCompleted = game <= completedGames;
      const gate = seriesGameGate({
        bestOf,
        gameNumber: game,
        teamAWins,
        teamBWins,
        status: 'active',
      });
      const pendingStatus = clinched && game > completedGames ? 'not_needed' : gate.status;
      sequence.push({
        id: null,
        gameNumber: game,
        question: null,
        status: missingCompleted ? 'resolved' : pendingStatus,
        outcome: null,
        startTime: null,
        endTime: null,
        finalScore: null,
        subtitle: seriesSubtitle({ gameNumber: game, summary }),
        summary,
        placeholder: true,
        seriesLocked: !missingCompleted && pendingStatus !== 'active',
        seriesLockReason: !missingCompleted && pendingStatus !== 'active' ? (gate.reason || 'series_clinched') : null,
      });
    }
  }

  return {
    ...meta,
    teamAWins,
    teamBWins,
    summary,
    subtitle: seriesSubtitle({ gameNumber: meta.gameNumber, summary }),
    sequence,
  };
}

export const _internal = {
  extractGameNumberFromText,
  extractBestOfFromText,
  normalizeKeyPart,
};
