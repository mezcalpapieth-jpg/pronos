/**
 * 2026 World Cup market generator.
 *
 * Produces one 3-way (Home / Draw / Away) market per group-stage
 * match from the official FIFA draw + schedule.
 *
 * Notes:
 * - category: 'world-cup'  → naturally excluded from /c/deportes and
 *   from home Trending (unless admin flips featured).
 * - resolver_type: 'sports_api' via ESPN's public FIFA World Cup
 *   scoreboard. The generator stores ESPN team abbreviations and the
 *   repair endpoint patches stable event ids as fixtures progress.
 * - outcome_images: flagcdn URLs per team, aligned with outcomes
 *   [home, 'Empate', away].
 *
 * Idempotent — matchId is stable, so (source, source_event_id)
 * deduplication does the right thing across re-runs.
 */

import { badgeUrl, GROUP_FIXTURES, GROUPS, TEAMS } from '../world-cup-2026.js';

export const WORLD_CUP_ESPN_LEAGUE_PATH = 'soccer/fifa.world';

export async function generateWorldCupMarkets() {
  const specs = [];

  // ── Per-match 3-way markets ──────────────────────────────────────────
  for (const f of GROUP_FIXTURES) {
    const home = TEAMS[f.homeCode];
    const away = TEAMS[f.awayCode];
    if (!home || !away) continue;

    const kickoffMs = new Date(f.kickoffIso).getTime();
    if (!Number.isFinite(kickoffMs)) continue;
    const startTime = new Date(kickoffMs).toISOString();
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
      outcome_images: [badgeUrl(home), null, badgeUrl(away)],
      seed_liquidity: 1000,
      start_time: startTime,
      end_time: endTime,
      amm_mode: 'unified',
      resolver_type: 'sports_api',
      resolver_config: {
        source: 'espn',
        leaguePath: WORLD_CUP_ESPN_LEAGUE_PATH,
        eventId: null,
        dateYmd: startTime.slice(0, 10),
        homeName: home.espn,
        awayName: away.espn,
        matchId: f.matchId,
        group: f.group,
        matchday: f.matchday,
        shape: 'draw3',
      },
      source_data: {
        matchId: f.matchId,
        competitionCode: 'WC',
        group: f.group,
        round: f.round,
        matchday: f.matchday,
        venue: f.venue,
        kickoffIso: f.kickoffIso,
        home: { code: f.homeCode, flagCode: home.code, espn: home.espn, name: home.name },
        away: { code: f.awayCode, flagCode: away.code, espn: away.espn, name: away.name },
      },
    });
  }

  // ── One "Winner of Group X" parallel market per group ───────────────
  // Each leg is a binary Sí/No on that team winning its group. 12
  // parent markets × 4 teams = 48 legs. Trading closes at the last
  // match of MD3 for that group (all known) — we look that up by
  // scanning the fixtures list.
  for (const g of GROUPS) {
    const md3Matches = GROUP_FIXTURES.filter(f => f.group === g.key && f.matchday === 'MD3');
    if (md3Matches.length === 0) continue;
    const lastKickoff = md3Matches
      .map(f => new Date(f.kickoffIso).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    if (!Number.isFinite(lastKickoff)) continue;

    const teams = g.teams.map(code => TEAMS[code]).filter(Boolean);
    if (teams.length === 0) continue;

    const outcomes = teams.map(t => t.name);
    const outcome_images = teams.map(t => badgeUrl(t));

    specs.push({
      source: 'fifa-wc-2026',
      source_event_id: `wc26-winner-group-${g.key}`,
      sport: 'soccer',
      league: 'world-cup',
      question: `¿Quién gana el Grupo ${g.key}?`,
      category: 'world-cup',
      icon: '🥇',
      outcomes,
      outcome_images,
      seed_liquidity: 1000,
      start_time: null,
      // Close 2h after the last MD3 kickoff — standings are final then.
      end_time: new Date(lastKickoff + 2 * 3600_000).toISOString(),
      amm_mode: 'parallel',
      resolver_type: 'manual',
      resolver_config: {
        source: 'manual',
        group: g.key,
        shape: 'parallel',
        legs: teams.map((t, i) => ({ label: t.name, teamCode: g.teams[i], espn: t.espn })),
      },
      source_data: {
        group: g.key,
        teams: teams.map((t, i) => ({ code: g.teams[i], flagCode: t.code, name: t.name, espn: t.espn })),
      },
    });
  }

  return specs;
}
