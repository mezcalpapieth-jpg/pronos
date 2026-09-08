/**
 * NFL market generator (binary, Home vs Away).
 *
 * ESPN's public NFL scoreboard covers preseason, regular season, and
 * postseason under the same football/nfl path. We keep scheduled games
 * in a one-week forward window and let the generic ESPN sports resolver
 * settle them once ESPN marks the event completed.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const HORIZON_DAYS = 7;

function formatDateCompact(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function seasonLabel(event, rootSeason) {
  const slug = String(event?.season?.slug || rootSeason?.type?.name || '').toLowerCase();
  const type = Number(event?.season?.type ?? rootSeason?.type?.type);
  if (slug.includes('preseason') || type === 1) return 'pretemporada NFL';
  if (slug.includes('postseason') || type === 3) return 'playoffs NFL';
  return 'NFL';
}

function teamLogo(competitor) {
  return competitor?.team?.logo || competitor?.team?.logos?.[0]?.href || null;
}

export async function generateNflMarkets({
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const horizon = new Date(current.getTime() + HORIZON_DAYS * 86_400_000);
  const range = `${formatDateCompact(current)}-${formatDateCompact(horizon)}`;
  const url = `${BASE}?dates=${range}&limit=500`;

  let data;
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.error('[market-gen/nfl] scoreboard fetch failed', { message: e?.message });
    return [];
  }

  const events = Array.isArray(data?.events) ? data.events : [];
  const specs = [];
  for (const ev of events) {
    const status = ev?.status?.type?.state;
    if (status !== 'pre') continue;
    const kickoff = ev?.date;
    if (!kickoff) continue;
    const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
    if (!comp) continue;
    const statusType = ev?.status?.type || {};
    const timeText = `${statusType.shortDetail || ''} ${statusType.detail || ''}`.toLowerCase();
    if (comp.timeValid === false || timeText.includes('tbd')) continue;

    const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
    const home = competitors.find(c => c.homeAway === 'home');
    const away = competitors.find(c => c.homeAway === 'away');
    if (!home?.team?.displayName || !away?.team?.displayName) continue;

    const kickoffMs = new Date(kickoff).getTime();
    const startTime = new Date(kickoffMs).toISOString();
    const endTime = new Date(kickoffMs + 4 * 3600_000).toISOString();
    const dateYmd = new Date(kickoff).toISOString().slice(0, 10);
    const label = seasonLabel(ev, data?.season);
    const matchupLabel = `${away.team.displayName} @ ${home.team.displayName}`;

    specs.push({
      source: 'espn-nfl',
      source_event_id: String(ev.id),
      sport: 'nfl',
      league: 'nfl',
      question: matchupLabel,
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
        leaguePath: 'football/nfl',
        eventId: ev.id,
        dateYmd,
        shape: 'binary',
      },
      source_data: {
        eventId: ev.id,
        kickoffUtc: kickoff,
        matchupLabel,
        league: 'NFL',
        season: label,
        week: ev?.week?.number ?? data?.week?.number ?? null,
        home: { id: home?.team?.id, name: home.team.displayName, abbr: home.team.abbreviation },
        away: { id: away?.team?.id, name: away.team.displayName, abbr: away.team.abbreviation },
        venue: comp?.venue?.fullName || null,
      },
    });
  }

  return specs;
}

export const _internal = { HORIZON_DAYS, seasonLabel };
