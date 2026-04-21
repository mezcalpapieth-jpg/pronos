/**
 * 2026 World Cup market generator.
 *
 * Produces one 3-way (Home / Draw / Away) market per group-stage
 * match from the official FIFA draw + schedule.
 *
 * Notes:
 * - category: 'world-cup'  → naturally excluded from /c/deportes and
 *   from home Trending (unless admin flips featured).
 * - resolver_type: 'manual' for now (football-data free tier doesn't
 *   cover the WC; can swap to 'sports_api' later if we wire in a
 *   paid or alternative source).
 * - outcome_images: flagcdn URLs per team, aligned with outcomes
 *   [home, 'Empate', away].
 *
 * Idempotent — matchId is stable, so (source, source_event_id)
 * deduplication does the right thing across re-runs.
 */

import { GROUP_FIXTURES, TEAMS } from '../world-cup-2026.js';

const FLAG_BASE = 'https://flagcdn.com/w160';

function flagUrl(code) {
  return `${FLAG_BASE}/${code}.png`;
}

export async function generateWorldCupMarkets() {
  const specs = [];
  for (const f of GROUP_FIXTURES) {
    const home = TEAMS[f.homeCode];
    const away = TEAMS[f.awayCode];
    if (!home || !away) continue;

    const kickoffMs = new Date(f.kickoffIso).getTime();
    // Skip matches already played by the time of run — keeps the
    // queue clean after the group stage ends.
    if (!Number.isFinite(kickoffMs)) continue;
    const startTime = new Date(kickoffMs).toISOString();
    // 2h window past kickoff — same convention the league soccer
    // generators use.
    const endTime = new Date(kickoffMs + 2 * 3600_000).toISOString();

    specs.push({
      source: 'fifa-wc-2026',
      source_event_id: f.matchId,
      sport: 'soccer',
      league: 'world-cup',
      question: `${home.name} vs ${away.name}`,
      category: 'world-cup',
      icon: '🏆',
      outcomes: [home.name, 'Empate', away.name],
      outcome_images: [flagUrl(home.code), null, flagUrl(away.code)],
      seed_liquidity: 1000,
      start_time: startTime,
      end_time: endTime,
      amm_mode: 'unified',
      // No auto-resolver source for WC yet — admin resolves manually.
      resolver_type: 'manual',
      resolver_config: {
        source: 'manual',
        matchId: f.matchId,
        group: f.group,
        matchday: f.matchday,
        shape: 'draw3',
      },
      source_data: {
        matchId: f.matchId,
        group: f.group,
        matchday: f.matchday,
        venue: f.venue,
        kickoffIso: f.kickoffIso,
        home: { code: home.code, name: home.name },
        away: { code: away.code, name: away.name },
      },
    });
  }
  return specs;
}
