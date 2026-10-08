/**
 * NCAA football postseason generator.
 *
 * ESPN exposes FBS regular season, bowls, and CFP under the same college
 * football scoreboard path. Keep only scheduled postseason-looking events so
 * regular-season Saturdays do not flood the admin queue.
 */

import { fetchEspnScoreboardData, formatEspnDateCompact, formatEspnVenue } from './espn-scoreboard.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
const HORIZON_DAYS = 45;

const POSTSEASON_KEYWORDS = [
  'bowl',
  'college football playoff',
  'cfp',
  'playoff',
  'national championship',
  'semifinal',
  'quarterfinal',
  'first round',
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

function seasonIsPostseason(event, rootSeason) {
  const slug = normalizeText(event?.season?.slug || rootSeason?.type?.name);
  const type = Number(event?.season?.type ?? rootSeason?.type?.type);
  return slug.includes('postseason') || type === 3;
}

function hasPostseasonKeyword(text) {
  return POSTSEASON_KEYWORDS.some(keyword => text.includes(keyword));
}

function isPostseasonEvent(event, competition, rootSeason) {
  const text = eventText(event, competition, rootSeason);
  return seasonIsPostseason(event, rootSeason) || hasPostseasonKeyword(text);
}

function teamLogo(competitor) {
  return competitor?.team?.logo || competitor?.team?.logos?.[0]?.href || null;
}

function statusTimeText(event) {
  const statusType = event?.status?.type || {};
  return normalizeText(`${statusType.shortDetail || ''} ${statusType.detail || ''}`);
}

export async function generateNcaafMarkets({
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const horizon = new Date(current.getTime() + HORIZON_DAYS * 86_400_000);
  const range = `${formatDateCompact(current)}-${formatDateCompact(horizon)}`;

  const data = await fetchEspnScoreboardData({
    baseUrl: BASE,
    dateRange: range,
    fetchImpl,
    preferDaily: true,
    logPrefix: '[market-gen/ncaaf] scoreboard fetch failed',
  });
  if (!data) return [];

  const events = Array.isArray(data?.events) ? data.events : [];
  const specs = [];
  for (const ev of events) {
    if (ev?.status?.type?.state !== 'pre') continue;
    const kickoff = ev?.date;
    if (!kickoff) continue;
    const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
    if (!comp) continue;
    if (comp.timeValid === false || statusTimeText(ev).includes('tbd')) continue;
    if (!isPostseasonEvent(ev, comp, data?.season)) continue;

    const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
    const home = competitors.find(c => c.homeAway === 'home');
    const away = competitors.find(c => c.homeAway === 'away');
    if (!home?.team?.displayName || !away?.team?.displayName) continue;

    const kickoffMs = new Date(kickoff).getTime();
    const startTime = new Date(kickoffMs).toISOString();
    const endTime = new Date(kickoffMs + 4 * 3600_000).toISOString();
    const dateYmd = new Date(kickoff).toISOString().slice(0, 10);
    const matchupLabel = `${away.team.displayName} @ ${home.team.displayName}`;

    specs.push({
      source: 'espn-ncaaf',
      source_event_id: String(ev.id),
      sport: 'ncaaf',
      league: 'ncaaf',
      question: `¿Quién gana ${matchupLabel}?`,
      category: 'deportes',
      icon: '🏈',
      outcomes: [home.team.displayName, away.team.displayName],
      outcome_images: [teamLogo(home), teamLogo(away)],
      seed_liquidity: 1000,
      start_time: startTime,
      end_time: endTime,
      amm_mode: 'unified',
      resolver_type: 'sports_api',
      resolver_config: {
        source: 'espn',
        leaguePath: 'football/college-football',
        eventId: ev.id,
        dateYmd,
        shape: 'binary',
      },
      source_data: {
        eventId: ev.id,
        kickoffUtc: kickoff,
        matchupLabel,
        league: 'NCAAF',
        season: 'postseason',
        week: ev?.week?.number ?? data?.week?.number ?? null,
        home: { id: home?.team?.id, name: home.team.displayName, abbr: home.team.abbreviation },
        away: { id: away?.team?.id, name: away.team.displayName, abbr: away.team.abbreviation },
        venue: formatEspnVenue(comp?.venue),
        eventLabel: ev?.name || comp?.type?.text || null,
        suggestedPricing: {
          source: 'admin-config',
          probabilities: [0.5, 0.5],
          probabilityPct: [50, 50],
          seedLiquidities: [1000, 1000],
          rationale: 'NCAA football postseason binary matchup markets open balanced for admin review.',
          evidence: [],
        },
      },
    });
  }

  return specs;
}

export const _internal = { HORIZON_DAYS, isPostseasonEvent };
