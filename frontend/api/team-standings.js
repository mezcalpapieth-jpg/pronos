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

export function competitionCodeForProfile(profile) {
  if (profile?.sport !== 'soccer') return null;
  return LEAGUE_TO_COMPETITION[profile?.league] || null;
}

export function espnStandingsPathForProfile(profile) {
  if (profile?.sport !== 'soccer') return null;
  if (!ESPN_STANDINGS_LEAGUES.has(profile?.league)) return null;
  const path = String(profile?.espnLeaguePath || '');
  return path.startsWith('soccer/') ? path : null;
}

export function normalizeFootballDataStandings(data, profile) {
  const total = (Array.isArray(data?.standings) ? data.standings : [])
    .find(standing => String(standing?.type || '').toUpperCase() === 'TOTAL');
  const rows = Array.isArray(total?.table) ? total.table : [];
  return {
    league: {
      code: data?.competition?.code || competitionCodeForProfile(profile),
      name: data?.competition?.name || profile?.league || null,
    },
    season: {
      id: data?.season?.id || null,
      currentMatchday: numberOrNull(data?.season?.currentMatchday),
    },
    rows: rows.map(row => ({
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
      highlighted: rowMatchesProfile(row, profile),
    })),
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

function espnLeagueName(data, group, profile) {
  const base = profile?.league || data?.abbreviation || data?.name || 'Liga';
  const groupName = translateEspnGroupName(group?.name || group?.abbreviation);
  if (!groupName || normalizeKey(groupName) === normalizeKey(base)) return base;
  return `${base} · ${groupName}`;
}

export function normalizeEspnStandings(data, profile) {
  const groups = espnStandingsGroups(data);
  const selected = groups.find(group => (
    (group.standings?.entries || []).some(entry => rowMatchesProfile(espnEntryMatchRow(entry), profile, 'espn'))
  )) || groups[0] || null;
  const entries = Array.isArray(selected?.standings?.entries) ? selected.standings.entries : [];

  return {
    league: {
      code: profile?.league || data?.abbreviation || null,
      name: espnLeagueName(data, selected, profile),
    },
    season: {
      id: selected?.standings?.season || data?.season?.year || null,
      currentMatchday: null,
    },
    rows: entries.map((entry, index) => {
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
        highlighted: rowMatchesProfile(espnEntryMatchRow(entry), profile, 'espn'),
      };
    }),
  };
}

async function fetchFootballDataStandings(profile) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return { table: null, warning: 'football_data_key_missing' };

  const competitionCode = competitionCodeForProfile(profile);
  if (!competitionCode) return { table: null, warning: 'standings_not_supported' };

  const url = `${FOOTBALL_DATA_BASE}/competitions/${encodeURIComponent(competitionCode)}/standings`;
  const res = await fetch(url, {
    headers: { 'X-Auth-Token': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`football-data ${res.status}`);
  const data = await res.json();
  return {
    table: normalizeFootballDataStandings(data, profile),
    warning: null,
  };
}

async function fetchEspnStandings(profile) {
  const path = espnStandingsPathForProfile(profile);
  if (!path) return { table: null, warning: 'standings_not_supported' };

  const url = `${ESPN_WEB_BASE}/${path}/standings?region=us&lang=en&contentorigin=espn`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`espn ${res.status}`);
  const data = await res.json();
  return {
    table: normalizeEspnStandings(data, profile),
    warning: null,
  };
}

async function fetchTeamStandings(profile) {
  if (competitionCodeForProfile(profile)) return fetchFootballDataStandings(profile);
  if (espnStandingsPathForProfile(profile)) return fetchEspnStandings(profile);
  return { table: null, warning: 'standings_not_supported' };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const sport = typeof req.query.sport === 'string' ? req.query.sport : '';
  const teamSlug = typeof req.query.team === 'string' ? req.query.team : '';
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
  espnStandingsPathForProfile,
  normalizeEspnStandings,
  normalizeFootballDataStandings,
  rowMatchesProfile,
};
