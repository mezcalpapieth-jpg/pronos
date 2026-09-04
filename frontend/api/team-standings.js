/**
 * GET /api/team-standings?sport=soccer&team=arsenal
 *
 * Compact league-table reader for team profile pages. Football-data is
 * authoritative for the supported soccer domestic leagues. ESPN fills the
 * keyless gap for Liga MX and MLS.
 */
import { applyCors } from './_lib/cors.js';
import { findTeamProfile } from '../app/src/lib/teamProfiles.js';

const FOOTBALL_DATA_BASE = 'https://api.football-data.org/v4';
const ESPN_WEB_BASE = 'https://site.web.api.espn.com/apis/v2/sports';

const LEAGUE_TO_COMPETITION = {
  'Premier League': 'PL',
  'La Liga': 'PD',
  'Serie A': 'SA',
  Bundesliga: 'BL1',
  'Ligue 1': 'FL1',
  Eredivisie: 'DED',
  Championship: 'ELC',
  'Primeira Liga': 'PPL',
  'Brasileiro Série A': 'BSA',
};

const EUROPEAN_COMPETITION_TABLES = {
  'uefa-cl': {
    code: 'CL',
    name: 'UEFA Champions League',
    espnPath: 'soccer/uefa.champions',
  },
  'uefa-europa-league': {
    code: 'EL',
    name: 'UEFA Europa League',
    espnPath: 'soccer/uefa.europa',
  },
  'uefa-conference-league': {
    code: 'UCL',
    name: 'UEFA Conference League',
    espnPath: 'soccer/uefa.europa.conf',
  },
};

const ESPN_STANDINGS_LEAGUES = new Set(['Liga MX', 'MLS']);

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function displayFootballDataTeamName(team) {
  return team?.shortName || team?.name || team?.tla || 'Equipo';
}

function displayEspnTeamName(team) {
  return team?.displayName || team?.shortDisplayName || team?.name || team?.abbreviation || 'Equipo';
}

function espnTeamLogo(team) {
  if (team?.logo) return team.logo;
  const logos = Array.isArray(team?.logos) ? team.logos : [];
  return logos.find(logo => Array.isArray(logo?.rel) && logo.rel.includes('default'))?.href
    || logos[0]?.href
    || null;
}

function profileNameKeys(profile) {
  return [
    profile?.name,
    profile?.slug,
    ...(profile?.aliases || []),
  ].map(normalizeKey).filter(Boolean);
}

function normalizeStandingsContext(value) {
  const isWrapped = value && typeof value === 'object' && (
    Object.prototype.hasOwnProperty.call(value, 'profile')
    || Object.prototype.hasOwnProperty.call(value, 'highlightTeams')
    || Object.prototype.hasOwnProperty.call(value, 'competitionCode')
    || Object.prototype.hasOwnProperty.call(value, 'espnPath')
  );
  const profile = isWrapped ? value.profile : value;
  const highlightTeams = isWrapped && Array.isArray(value.highlightTeams) ? value.highlightTeams : [];
  return {
    profile: profile || null,
    highlightTeams: highlightTeams.map(String).map(s => s.trim()).filter(Boolean),
    league: (isWrapped ? value.league : null) || profile?.league || null,
    competitionCode: (isWrapped ? value.competitionCode : null) || competitionCodeForProfile(profile) || null,
    espnPath: (isWrapped ? value.espnPath : null) || espnStandingsPathForProfile(profile) || null,
  };
}

function rowMatchesProfile(row, profile, provider = 'football-data') {
  const rowTeam = row?.team || {};
  const providerId = provider === 'espn' ? profile?.espnTeamId : profile?.footballDataId;
  if (providerId && String(rowTeam.id) === String(providerId)) return true;
  const profileKeys = new Set(profileNameKeys(profile));
  const rowKeys = [
    rowTeam.name,
    rowTeam.shortName,
    rowTeam.tla,
    rowTeam.displayName,
    rowTeam.shortDisplayName,
    rowTeam.abbreviation,
  ]
    .map(normalizeKey)
    .filter(Boolean);
  if (rowKeys.some(key => profileKeys.has(key))) return true;

  const broadProfileKeys = [...profileKeys].filter(key => key.length >= 8);
  return rowKeys.some(rowKey => (
    rowKey.length >= 8
    && broadProfileKeys.some(profileKey => (
      rowKey.includes(profileKey) || profileKey.includes(rowKey)
    ))
  ));
}

function rowMatchesHighlightTeams(row, highlightTeams = []) {
  const highlightKeys = new Set(highlightTeams.map(normalizeKey).filter(Boolean));
  if (highlightKeys.size === 0) return false;
  const rowTeam = row?.team || {};
  const rowKeys = [
    rowTeam.name,
    rowTeam.shortName,
    rowTeam.tla,
    rowTeam.displayName,
    rowTeam.shortDisplayName,
    rowTeam.abbreviation,
  ]
    .map(normalizeKey)
    .filter(Boolean);
  if (rowKeys.some(key => highlightKeys.has(key))) return true;

  const broadHighlightKeys = [...highlightKeys].filter(key => key.length >= 8);
  return rowKeys.some(rowKey => (
    rowKey.length >= 8
    && broadHighlightKeys.some(highlightKey => (
      rowKey.includes(highlightKey) || highlightKey.includes(rowKey)
    ))
  ));
}

function rowMatchesContext(row, context, provider = 'football-data') {
  return rowMatchesProfile(row, context?.profile, provider)
    || rowMatchesHighlightTeams(row, context?.highlightTeams);
}

function competitionConfigForLeagueSlug(leagueSlug) {
  return EUROPEAN_COMPETITION_TABLES[String(leagueSlug || '').trim().toLowerCase()] || null;
}

export function competitionCodeForProfile(profile) {
  if (profile?.sport !== 'soccer') return null;
  return LEAGUE_TO_COMPETITION[profile?.league] || null;
}

export function competitionCodeForLeagueSlug(leagueSlug) {
  return competitionConfigForLeagueSlug(leagueSlug)?.code || null;
}

export function espnStandingsPathForProfile(profile) {
  if (profile?.sport !== 'soccer') return null;
  if (!ESPN_STANDINGS_LEAGUES.has(profile?.league)) return null;
  const path = String(profile?.espnLeaguePath || '');
  return path.startsWith('soccer/') ? path : null;
}

export function espnStandingsPathForLeagueSlug(leagueSlug) {
  return competitionConfigForLeagueSlug(leagueSlug)?.espnPath || null;
}

function translateFootballDataGroupName(name, fallback) {
  const raw = String(name || '').trim();
  if (!raw) return fallback;
  const normalized = raw.toUpperCase().replace(/[\s-]+/g, '_');
  const group = normalized.match(/^GROUP_([A-Z])$/)?.[1];
  if (group) return `Grupo ${group}`;
  if (normalized === 'LEAGUE_STAGE') return 'Tabla general';
  return raw.replace(/_/g, ' ').trim();
}

function normalizeFootballDataRow(row, context) {
  return {
    position: numberOrNull(row?.position),
    teamId: row?.team?.id == null ? null : String(row.team.id),
    teamName: displayFootballDataTeamName(row?.team),
    logoUrl: row?.team?.crest || null,
    played: numberOrNull(row?.playedGames),
    won: numberOrNull(row?.won),
    draw: numberOrNull(row?.draw),
    lost: numberOrNull(row?.lost),
    points: numberOrNull(row?.points),
    goalsFor: numberOrNull(row?.goalsFor),
    goalsAgainst: numberOrNull(row?.goalsAgainst),
    goalDifference: numberOrNull(row?.goalDifference),
    highlighted: rowMatchesContext(row, context),
  };
}

function normalizeFootballDataGroup(standing, context, index) {
  const rows = Array.isArray(standing?.table) ? standing.table : [];
  const name = translateFootballDataGroupName(
    standing?.group || standing?.stage,
    context?.league || `Grupo ${index + 1}`,
  );
  return {
    key: groupKeyFromName(name, `group-${index + 1}`),
    name,
    rows: rows.map(row => normalizeFootballDataRow(row, context)),
  };
}

export function normalizeFootballDataStandings(data, profile) {
  const context = normalizeStandingsContext(profile);
  const groups = (Array.isArray(data?.standings) ? data.standings : [])
    .filter(standing => String(standing?.type || '').toUpperCase() === 'TOTAL')
    .map((standing, index) => normalizeFootballDataGroup(standing, context, index))
    .filter(group => group.rows.length > 0);
  const selected = groups.find(group => group.rows.some(row => row.highlighted)) || groups[0] || null;
  return {
    league: {
      code: data?.competition?.code || context.competitionCode,
      name: data?.competition?.name || context.league || null,
    },
    season: {
      id: data?.season?.id || null,
      currentMatchday: numberOrNull(data?.season?.currentMatchday),
    },
    defaultGroupKey: selected?.key || null,
    groups,
    rows: selected?.rows || [],
  };
}

function statMap(stats) {
  const map = new Map();
  for (const stat of Array.isArray(stats) ? stats : []) {
    if (stat?.name) map.set(stat.name, stat);
  }
  return map;
}

function statNumber(stats, name) {
  const stat = stats.get(name);
  return numberOrNull(stat?.value ?? stat?.displayValue);
}

function translateEspnGroupName(name) {
  const normalized = normalizeKey(name);
  if (normalized === 'eastern conference') return 'Conferencia Este';
  if (normalized === 'western conference') return 'Conferencia Oeste';
  return String(name || '').replace(/^\d{4}\s+/, '').trim();
}

function groupKeyFromName(name, fallback) {
  const key = normalizeKey(name).replace(/\s+/g, '-');
  return key || fallback;
}

function espnStandingsGroups(data) {
  const children = Array.isArray(data?.children) ? data.children : [];
  const groups = children.filter(group => Array.isArray(group?.standings?.entries));
  if (groups.length > 0) return groups;
  if (Array.isArray(data?.standings?.entries)) return [data];
  return [];
}

function espnEntryMatchRow(entry) {
  const team = entry?.team || {};
  return {
    team: {
      id: team.id,
      name: team.displayName || team.name,
      shortName: team.shortDisplayName,
      tla: team.abbreviation,
      displayName: team.displayName,
      shortDisplayName: team.shortDisplayName,
      abbreviation: team.abbreviation,
    },
  };
}

function sortStandingsRows(rows) {
  return [...rows].sort((a, b) => {
    const aPosition = Number.isFinite(Number(a.position)) ? Number(a.position) : Number.POSITIVE_INFINITY;
    const bPosition = Number.isFinite(Number(b.position)) ? Number(b.position) : Number.POSITIVE_INFINITY;
    if (aPosition !== bPosition) return aPosition - bPosition;
    return String(a.teamName || '').localeCompare(String(b.teamName || ''), 'es');
  });
}

function normalizeEspnEntry(entry, context, index) {
  const stats = statMap(entry?.stats);
  const team = entry?.team || {};
  return {
    position: statNumber(stats, 'rank') ?? index + 1,
    teamId: team.id == null ? null : String(team.id),
    teamName: displayEspnTeamName(team),
    logoUrl: espnTeamLogo(team),
    played: statNumber(stats, 'gamesPlayed'),
    won: statNumber(stats, 'wins'),
    draw: statNumber(stats, 'ties'),
    lost: statNumber(stats, 'losses'),
    points: statNumber(stats, 'points'),
    goalsFor: statNumber(stats, 'pointsFor'),
    goalsAgainst: statNumber(stats, 'pointsAgainst'),
    goalDifference: statNumber(stats, 'pointDifferential'),
    highlighted: rowMatchesContext(espnEntryMatchRow(entry), context, 'espn'),
  };
}

function normalizeEspnGroup(group, context, index) {
  const rawName = group?.name || group?.abbreviation || context?.league || `Grupo ${index + 1}`;
  const name = translateEspnGroupName(rawName) || rawName;
  const entries = Array.isArray(group?.standings?.entries) ? group.standings.entries : [];
  return {
    key: groupKeyFromName(name, `group-${index + 1}`),
    name,
    seasonId: group?.standings?.season || null,
    rows: sortStandingsRows(entries.map((entry, entryIndex) => normalizeEspnEntry(entry, context, entryIndex))),
  };
}

export function normalizeEspnStandings(data, profile) {
  const context = normalizeStandingsContext(profile);
  const groups = espnStandingsGroups(data).map((group, index) => normalizeEspnGroup(group, context, index));
  const selected = groups.find(group => group.rows.some(row => row.highlighted)) || groups[0] || null;

  return {
    league: {
      code: context.competitionCode || context.league || data?.abbreviation || null,
      name: context.league || data?.abbreviation || data?.name || null,
    },
    season: {
      id: selected?.seasonId || data?.season?.year || null,
      currentMatchday: null,
    },
    defaultGroupKey: selected?.key || null,
    groups,
    rows: selected?.rows || [],
  };
}

async function fetchFootballDataStandings(profile) {
  const context = normalizeStandingsContext(profile);
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return { table: null, warning: 'football_data_key_missing' };

  const competitionCode = context.competitionCode;
  if (!competitionCode) return { table: null, warning: 'standings_not_supported' };

  const url = `${FOOTBALL_DATA_BASE}/competitions/${encodeURIComponent(competitionCode)}/standings`;
  const res = await fetch(url, {
    headers: { 'X-Auth-Token': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`football-data ${res.status}`);
  const data = await res.json();
  return {
    table: normalizeFootballDataStandings(data, context),
    warning: null,
  };
}

async function fetchEspnStandings(profile) {
  const context = normalizeStandingsContext(profile);
  const path = context.espnPath;
  if (!path) return { table: null, warning: 'standings_not_supported' };

  const url = `${ESPN_WEB_BASE}/${path}/standings?region=us&lang=en&contentorigin=espn`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`espn ${res.status}`);
  const data = await res.json();
  return {
    table: normalizeEspnStandings(data, context),
    warning: null,
  };
}

async function fetchTeamStandings(profile) {
  if (competitionCodeForProfile(profile)) return fetchFootballDataStandings(profile);
  if (espnStandingsPathForProfile(profile)) return fetchEspnStandings(profile);
  return { table: null, warning: 'standings_not_supported' };
}

async function fetchCompetitionStandings(leagueSlug, highlightTeams = []) {
  const config = competitionConfigForLeagueSlug(leagueSlug);
  if (!config) return { table: null, warning: 'standings_not_supported' };

  const context = {
    profile: null,
    highlightTeams,
    league: config.name,
    competitionCode: config.code,
    espnPath: config.espnPath,
  };

  if (process.env.FOOTBALL_DATA_API_KEY && config.code) {
    try {
      return await fetchFootballDataStandings(context);
    } catch (e) {
      if (!config.espnPath) throw e;
      console.warn('[team-standings] football-data competition standings failed; falling back to ESPN', {
        league: leagueSlug,
        message: e?.message,
      });
    }
  }

  if (config.espnPath) return fetchEspnStandings(context);
  return { table: null, warning: 'standings_not_supported' };
}

function highlightTeamsFromQuery(query) {
  return [query.home, query.away, query.teamA, query.teamB]
    .flatMap(value => (Array.isArray(value) ? value : [value]))
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const sport = typeof req.query.sport === 'string' ? req.query.sport : '';
  const teamSlug = typeof req.query.team === 'string' ? req.query.team : '';
  const leagueSlug = typeof req.query.league === 'string' ? req.query.league : '';

  if (leagueSlug) {
    try {
      const result = await fetchCompetitionStandings(leagueSlug, highlightTeamsFromQuery(req.query));
      return res.status(200).json({
        team: null,
        table: result.table,
        warning: result.warning,
      });
    } catch (e) {
      console.error('[team-standings] competition fetch failed', {
        league: leagueSlug,
        message: e?.message,
      });
      return res.status(200).json({
        team: null,
        table: null,
        warning: 'standings_source_unavailable',
      });
    }
  }

  const profile = findTeamProfile(sport, teamSlug);
  if (!profile) return res.status(404).json({ error: 'team_not_found' });

  try {
    const result = await fetchTeamStandings(profile);
    return res.status(200).json({
      team: profile,
      table: result.table,
      warning: result.warning,
    });
  } catch (e) {
    console.error('[team-standings] fetch failed', {
      sport: profile.sport,
      team: profile.slug,
      message: e?.message,
    });
    return res.status(200).json({
      team: profile,
      table: null,
      warning: 'standings_source_unavailable',
    });
  }
}

export const _internal = {
  competitionCodeForProfile,
  competitionCodeForLeagueSlug,
  espnStandingsPathForLeagueSlug,
  espnStandingsPathForProfile,
  normalizeEspnStandings,
  normalizeFootballDataStandings,
  rowMatchesProfile,
  rowMatchesHighlightTeams,
};
