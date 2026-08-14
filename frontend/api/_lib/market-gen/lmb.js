/**
 * Liga Mexicana de Béisbol generator.
 *
 * Reads the hand-maintained fixture window from lmb-2026.js and
 * produces one binary (home / away) market per game. Since LMB
 * doesn't expose a free public API, resolution stays manual —
 * admin picks the winner after each game.
 *
 * category: 'deportes'
 * sport:    'baseball'
 * league:   'lmb'  (distinct from MLB)
 * featured: false (default on pending rows)
 */

import { LMB_TEAMS, FIXTURES } from '../lmb-2026.js';

export async function generateLmbMarkets() {
  const specs = [];
  const now = Date.now();
  for (const f of FIXTURES) {
    const home = LMB_TEAMS[f.homeCode];
    const away = LMB_TEAMS[f.awayCode];
    if (!home || !away) continue;

    const kickoffMs = new Date(f.kickoffIso).getTime();
    // Drop games already past — keeps the queue tidy as the season
    // progresses and the static file accumulates historical rows.
    if (!Number.isFinite(kickoffMs) || kickoffMs < now - 6 * 3600_000) continue;

    const startTime = new Date(kickoffMs).toISOString();
    const endTime = new Date(kickoffMs + 4 * 3600_000).toISOString();

    specs.push({
      source: 'lmb-mx-2026',
      source_event_id: f.matchId,
      sport: 'baseball',
      league: 'lmb',
      question: `${away.name} @ ${home.name}`,
      category: 'deportes',
      icon: '⚾',
      outcomes: [home.name, away.name],
      outcome_images: [home.logo || null, away.logo || null],
      seed_liquidity: 1000,
      start_time: startTime,
      end_time: endTime,
      amm_mode: 'unified',
      resolver_type: 'manual',
      resolver_config: {
        source: 'manual',
        matchId: f.matchId,
        shape: 'binary',
      },
      source_data: {
        matchId: f.matchId,
        venue: f.venue,
        kickoffIso: f.kickoffIso,
        home: { code: home.code, name: home.name, city: home.city },
        away: { code: away.code, name: away.name, city: away.city },
      },
    });
  }
  return specs;
}
