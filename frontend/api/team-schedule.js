/**
 * GET /api/team-schedule?sport=soccer&team=arsenal
 *
 * Lightweight schedule reader for team profile pages. Markets are linked
 * on the client by source/sourceEventId; this endpoint only returns the
 * canonical event rows for the team.
 */
import { applyCors } from './_lib/cors.js';
import { findTeamProfile } from '../app/src/lib/teamProfiles.js';

const FOOTBALL_DATA_BASE = 'https://api.football-data.org/v4';

const COMPETITION_TO_LEAGUE = {
  CL:  'uefa-cl',
  EL:  'uefa-europa-league',
  UCL: 'uefa-conference-league',
  CLI: 'copa-libertadores',
  PD:  'la-liga',
  PL:  'premier-league',
  SA:  'serie-a',
  BL1: 'bundesliga',
};

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function scheduleWindow() {
  const now = Date.now();
  return {
    from: dateOnly(new Date(now - 90 * 86_400_000)),
    to: dateOnly(new Date(now + 180 * 86_400_000)),
  };
}

function espnCompetitors(event) {
  const comp = Array.isArray(event?.competitions) ? event.competitions[0] : null;
  const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || null;
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || null;
  return { comp, home, away };
}

function competitorName(c) {
  return c?.team?.displayName
    || c?.team?.shortDisplayName
    || c?.team?.name
    || c?.displayName
    || null;
}

function competitorLogo(c) {
  return c?.team?.logo
    || c?.team?.logos?.[0]?.href
    || null;
}

function espnTeamLogo(team) {
  return team?.logo
    || team?.logos?.[0]?.href
    || null;
}

function normalizeScore(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    return normalizeScore(value.value ?? value.displayValue);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function scoreLine(homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return null;
  return `${homeScore}-${awayScore}`;
}

function competitorScore(c) {
  return normalizeScore(c?.score);
}

function espnTeamRows(data) {
  const sports = Array.isArray(data?.sports) ? data.sports : [];
  return sports
    .flatMap(sport => Array.isArray(sport?.leagues) ? sport.leagues : [])
    .flatMap(league => Array.isArray(league?.teams) ? league.teams : [])
    .map(entry => entry?.team || entry)
    .filter(Boolean);
}

function espnTeamKeys(team) {
  return [
    team?.displayName,
    team?.shortDisplayName,
    team?.name,
    team?.location,
    team?.nickname,
    team?.abbreviation,
    team?.slug,
  ].map(normalizeKey).filter(Boolean);
}

function profileTeamKeys(profile) {
  return [
    profile?.name,
    profile?.slug,
    ...(profile?.aliases || []),
  ].map(normalizeKey).filter(Boolean);
}

function matchEspnTeam(profile, teams) {
  if (profile?.espnTeamId) {
    const id = String(profile.espnTeamId);
    const byId = teams.find(team => String(team?.id) === id);
    if (byId) return byId;
  }

  const profileKeys = new Set(profileTeamKeys(profile));
  return teams.find(team => espnTeamKeys(team).some(key => profileKeys.has(key))) || null;
}

async function resolveEspnTeamProfile(profile) {
  if (!profile?.espnLeaguePath) return profile;
  if (profile.espnTeamId && profile.logoUrl) return profile;

  const url = `https://site.api.espn.com/apis/site/v2/sports/${profile.espnLeaguePath}/teams`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return profile;
  const data = await res.json();
  const match = matchEspnTeam(profile, espnTeamRows(data));
  if (!match?.id) return profile;

  return {
    ...profile,
    espnTeamId: String(match.id),
    logoUrl: profile.logoUrl || espnTeamLogo(match),
  };
}

function normalizeEspnEvent(event, profile) {
  const { comp, home, away } = espnCompetitors(event);
  const sourceEventId = String(event?.id || '');
  if (!sourceEventId || !event?.date) return null;
  const homeScore = competitorScore(home);
  const awayScore = competitorScore(away);
  return {
    id: `espn:${sourceEventId}`,
    source: 'espn',
    sourceEventId,
    startsAt: event.date,
    status: event?.status?.type?.state || null,
    statusDetail: event?.status?.type?.shortDetail || event?.status?.type?.detail || null,
    sport: profile.sport,
    league: profile.league,
    homeName: competitorName(home),
    awayName: competitorName(away),
    homeLogo: competitorLogo(home),
    awayLogo: competitorLogo(away),
    homeScore,
    awayScore,
    finalScore: scoreLine(homeScore, awayScore),
    venue: comp?.venue?.fullName || null,
  };
}

async function fetchEspnSchedule(profile) {
  const resolvedProfile = await resolveEspnTeamProfile(profile);
  if (!resolvedProfile.espnLeaguePath || !resolvedProfile.espnTeamId) {
    return { schedule: [], warning: 'team_schedule_not_configured', team: resolvedProfile };
  }
  const url = `https://site.api.espn.com/apis/site/v2/sports/${resolvedProfile.espnLeaguePath}/teams/${resolvedProfile.espnTeamId}/schedule`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`espn ${res.status}`);
  const data = await res.json();
  const events = Array.isArray(data?.events)
    ? data.events
    : Array.isArray(data?.team?.events)
      ? data.team.events
      : [];
  const team = data?.team ? {
    ...resolvedProfile,
    espnTeamId: String(data.team.id || resolvedProfile.espnTeamId),
    logoUrl: resolvedProfile.logoUrl || espnTeamLogo(data.team),
  } : resolvedProfile;
  return {
    schedule: events.map(ev => normalizeEspnEvent(ev, resolvedProfile)).filter(Boolean),
    warning: null,
    team,
  };
}

function normalizeFootballDataMatch(match, profile) {
  if (!match?.id || !match?.utcDate) return null;
  const homeScore = normalizeScore(match?.score?.fullTime?.home ?? match?.score?.regularTime?.home);
  const awayScore = normalizeScore(match?.score?.fullTime?.away ?? match?.score?.regularTime?.away);
  return {
    id: `football-data.org:${match.id}`,
    source: 'football-data.org',
    sourceEventId: String(match.id),
    startsAt: match.utcDate,
    status: match.status || null,
    statusDetail: match.status || null,
    sport: profile.sport,
    league: COMPETITION_TO_LEAGUE[match?.competition?.code] || profile.league || null,
    homeName: match?.homeTeam?.shortName || match?.homeTeam?.name || null,
    awayName: match?.awayTeam?.shortName || match?.awayTeam?.name || null,
    homeLogo: match?.homeTeam?.crest || null,
    awayLogo: match?.awayTeam?.crest || null,
    homeScore,
    awayScore,
    finalScore: scoreLine(homeScore, awayScore),
    venue: match?.venue || null,
  };
}

async function fetchFootballDataSchedule(profile) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!profile.footballDataId || !apiKey) {
    return { schedule: [], warning: 'football_data_key_missing', team: profile };
  }
  const { from, to } = scheduleWindow();
  const url = `${FOOTBALL_DATA_BASE}/teams/${profile.footballDataId}/matches?dateFrom=${from}&dateTo=${to}`;
  const res = await fetch(url, {
    headers: { 'X-Auth-Token': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`football-data ${res.status}`);
  const data = await res.json();
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  return {
    schedule: matches.map(match => normalizeFootballDataMatch(match, profile)).filter(Boolean),
    warning: null,
    team: profile,
  };
}

async function fetchTeamSchedule(profile) {
  if (profile.espnLeaguePath) {
    try {
      const espn = await fetchEspnSchedule(profile);
      if (espn.schedule.length > 0 || !profile.footballDataId) return espn;
    } catch (e) {
      if (profile.sport !== 'soccer' || !profile.footballDataId) throw e;
    }
  }
  if (profile.sport === 'soccer') return fetchFootballDataSchedule(profile);
  return fetchEspnSchedule(profile);
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
    const result = await fetchTeamSchedule(profile);
    return res.status(200).json({
      team: result.team || profile,
      schedule: result.schedule,
      warning: result.warning,
    });
  } catch (e) {
    console.error('[team-schedule] fetch failed', {
      sport: profile.sport,
      team: profile.slug,
      message: e?.message,
    });
    return res.status(200).json({
      team: profile,
      schedule: [],
      warning: 'schedule_source_unavailable',
    });
  }
}

export const _internal = {
  competitorScore,
  espnTeamRows,
  fetchEspnSchedule,
  matchEspnTeam,
  normalizeEspnEvent,
  resolveEspnTeamProfile,
};
