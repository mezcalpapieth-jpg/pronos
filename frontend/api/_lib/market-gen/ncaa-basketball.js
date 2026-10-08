/**
 * NCAA basketball postseason generator.
 *
 * Pulls ESPN men's and women's college basketball scoreboards, but only keeps
 * scheduled events that look like NCAA Tournament / March Madness games.
 */

import { fetchEspnScoreboardData, formatEspnDateCompact, formatEspnVenue } from './espn-scoreboard.js';

const HORIZON_DAYS = 24;

const LEAGUES = [
  {
    source: 'espn-ncaamb',
    league: 'ncaamb',
    leagueLabel: 'NCAAM',
    leaguePath: 'basketball/mens-college-basketball',
    baseUrl: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
  },
  {
    source: 'espn-ncaawb',
    league: 'ncaawb',
    leagueLabel: 'NCAAW',
    leaguePath: 'basketball/womens-college-basketball',
    baseUrl: 'https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard',
  },
];

const MARCH_MADNESS_KEYWORDS = [
  'ncaa tournament',
  'march madness',
  'final four',
  'first four',
  'sweet 16',
  'sweet sixteen',
  'elite eight',
  'regional semifinal',
  'regional final',
  'national semifinal',
  'national championship',
  "men's basketball championship",
  'mens basketball championship',
  "women's basketball championship",
  'womens basketball championship',
];

function formatDateCompact(d) {
  return formatEspnDateCompact(d);
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function collectNoteText(notes) {
  if (!Array.isArray(notes)) return '';
  return notes
    .map(note => [
      note?.headline,
      note?.shortHeadline,
      note?.text,
      note?.type,
    ].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(' ');
}

function eventText(event, competition, rootSeason) {
  return normalizeText([
    event?.name,
    event?.shortName,
    event?.season?.slug,
    rootSeason?.type?.name,
    event?.status?.type?.detail,
    event?.status?.type?.shortDetail,
    competition?.type?.text,
    collectNoteText(event?.notes),
    collectNoteText(competition?.notes),
  ].filter(Boolean).join(' '));
}

function hasMarchMadnessKeyword(text) {
  return MARCH_MADNESS_KEYWORDS.some(keyword => text.includes(keyword));
}

function isMarchMadnessEvent(event, competition, rootSeason) {
  const text = eventText(event, competition, rootSeason);
  return hasMarchMadnessKeyword(text);
}

function statusTimeText(event) {
  const statusType = event?.status?.type || {};
  return normalizeText(`${statusType.shortDetail || ''} ${statusType.detail || ''}`);
}

function teamLogo(competitor) {
  return competitor?.team?.logo || competitor?.team?.logos?.[0]?.href || null;
}

async function fetchLeagueEvents({ leagueConfig, range, fetchImpl }) {
  const data = await fetchEspnScoreboardData({
    baseUrl: leagueConfig.baseUrl,
    dateRange: range,
    fetchImpl,
    preferDaily: true,
    logPrefix: `[market-gen/${leagueConfig.league}] scoreboard fetch failed`,
  });
  return data || null;
}

function buildSpec({ ev, comp, home, away, leagueConfig, rootData }) {
  const kickoff = ev.date;
  const kickoffMs = new Date(kickoff).getTime();
  const startTime = new Date(kickoffMs).toISOString();
  const endTime = new Date(kickoffMs + 3 * 3600_000).toISOString();
  const dateYmd = new Date(kickoff).toISOString().slice(0, 10);
  const matchupLabel = `${away.team.displayName} @ ${home.team.displayName}`;

  return {
    source: leagueConfig.source,
    source_event_id: String(ev.id),
    sport: 'ncaab',
    league: leagueConfig.league,
    question: `¿Quién gana ${matchupLabel}?`,
    category: 'deportes',
    icon: '🏀',
    outcomes: [home.team.displayName, away.team.displayName],
    outcome_images: [teamLogo(home), teamLogo(away)],
    seed_liquidity: 1000,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'unified',
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'espn',
      leaguePath: leagueConfig.leaguePath,
      eventId: ev.id,
      dateYmd,
      shape: 'binary',
    },
    source_data: {
      eventId: ev.id,
      kickoffUtc: kickoff,
      matchupLabel,
      league: leagueConfig.leagueLabel,
      season: 'march-madness',
      home: { id: home?.team?.id, name: home.team.displayName, abbr: home.team.abbreviation },
      away: { id: away?.team?.id, name: away.team.displayName, abbr: away.team.abbreviation },
      venue: formatEspnVenue(comp?.venue),
      eventLabel: ev?.name || comp?.type?.text || rootData?.leagues?.[0]?.name || null,
      suggestedPricing: {
        source: 'admin-config',
        probabilities: [0.5, 0.5],
        probabilityPct: [50, 50],
        seedLiquidities: [1000, 1000],
        rationale: 'NCAA basketball tournament binary matchup markets open balanced for admin review.',
        evidence: [],
      },
    },
  };
}

export async function generateNcaaBasketballMarkets({
  now = new Date(),
  fetchImpl = fetch,
  leagues = LEAGUES,
} = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const horizon = new Date(current.getTime() + HORIZON_DAYS * 86_400_000);
  const range = `${formatDateCompact(current)}-${formatDateCompact(horizon)}`;
  const specs = [];

  for (const leagueConfig of leagues) {
    const data = await fetchLeagueEvents({ leagueConfig, range, fetchImpl });
    const events = Array.isArray(data?.events) ? data.events : [];
    for (const ev of events) {
      if (ev?.status?.type?.state !== 'pre') continue;
      if (!ev?.date) continue;
      const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
      if (!comp) continue;
      if (comp.timeValid === false || statusTimeText(ev).includes('tbd')) continue;
      if (!isMarchMadnessEvent(ev, comp, data?.season)) continue;

      const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
      const home = competitors.find(c => c.homeAway === 'home');
      const away = competitors.find(c => c.homeAway === 'away');
      if (!home?.team?.displayName || !away?.team?.displayName) continue;
      specs.push(buildSpec({ ev, comp, home, away, leagueConfig, rootData: data }));
    }
  }

  return specs;
}

export const _internal = { HORIZON_DAYS, LEAGUES, isMarchMadnessEvent };
