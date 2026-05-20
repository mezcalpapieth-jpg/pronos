/**
 * GET /api/team-directory
 *
 * Provides logo enrichment for the team selector. Static profiles already
 * carry many logos; this endpoint fills the rest from league directories
 * so the listing does not need per-team hardcoded ESPN ids.
 */
import { applyCors } from './_lib/cors.js';
import { TEAM_PROFILES } from '../app/src/lib/teamProfiles.js';

const CACHE_MS = 6 * 60 * 60 * 1000;

let cachedAt = 0;
let cachedLogos = null;

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function teamDirectoryKey(team = {}) {
  if (!team.sport || !team.slug) return null;
  return `${team.sport}:${team.slug}`;
}

function espnTeamRows(data) {
  const sports = Array.isArray(data?.sports) ? data.sports : [];
  return sports
    .flatMap(sport => Array.isArray(sport?.leagues) ? sport.leagues : [])
    .flatMap(league => Array.isArray(league?.teams) ? league.teams : [])
    .map(entry => entry?.team || entry)
    .filter(Boolean);
}

function espnTeamLogo(team) {
  return team?.logo
    || team?.logos?.[0]?.href
    || null;
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
    const byId = teams.find(team => String(team?.id) === String(profile.espnTeamId));
    if (byId) return byId;
  }

  const profileKeys = new Set(profileTeamKeys(profile));
  return teams.find(team => espnTeamKeys(team).some(key => profileKeys.has(key))) || null;
}

async function fetchEspnLeagueTeams(leaguePath) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/teams`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`espn ${res.status}`);
  return espnTeamRows(await res.json());
}

export async function buildDirectoryLogos(profiles = TEAM_PROFILES) {
  const logos = {};
  const profilesByLeaguePath = new Map();

  for (const profile of profiles) {
    const key = teamDirectoryKey(profile);
    if (!key) continue;
    if (profile.logoUrl) {
      logos[key] = profile.logoUrl;
      continue;
    }
    if (!profile.espnLeaguePath) continue;
    const group = profilesByLeaguePath.get(profile.espnLeaguePath) || [];
    group.push(profile);
    profilesByLeaguePath.set(profile.espnLeaguePath, group);
  }

  for (const [leaguePath, leagueProfiles] of profilesByLeaguePath.entries()) {
    try {
      const teams = await fetchEspnLeagueTeams(leaguePath);
      for (const profile of leagueProfiles) {
        const key = teamDirectoryKey(profile);
        const match = matchEspnTeam(profile, teams);
        const logo = espnTeamLogo(match);
        if (key && logo) logos[key] = logo;
      }
    } catch (e) {
      console.warn('[team-directory] espn logo lookup failed', {
        leaguePath,
        message: e?.message,
      });
    }
  }

  return logos;
}

async function getDirectoryLogos() {
  const now = Date.now();
  if (cachedLogos && now - cachedAt < CACHE_MS) return cachedLogos;
  cachedLogos = await buildDirectoryLogos(TEAM_PROFILES);
  cachedAt = now;
  return cachedLogos;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const logos = await getDirectoryLogos();
    return res.status(200).json({ logos, updatedAt: new Date(cachedAt).toISOString() });
  } catch (e) {
    console.error('[team-directory] failed', { message: e?.message });
    return res.status(200).json({ logos: {}, warning: 'team_directory_unavailable' });
  }
}

export const _internal = {
  buildDirectoryLogos,
  espnTeamRows,
  matchEspnTeam,
  teamDirectoryKey,
};
