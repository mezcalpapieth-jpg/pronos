/**
 * World Cup 2026 knockout-stage progression.
 *
 * Once groups complete, compute standings and spawn match markets
 * for the next round. Called from
 * /api/points/admin/progress-world-cup, which is also the handler
 * the scheduled cron hits.
 *
 * Tiebreakers here are approximate — we only persist per-match
 * "who won" (outcome index 0/1/2), not goals scored. So:
 *
 *   - Group standings: points-only (W=3, D=1, L=0). Head-to-head
 *     breaks ties. Further ties are settled alphabetically so the
 *     job stays deterministic; admin can override the resulting
 *     pairings before approving the R32 rows.
 *
 *   - Best third-placed teams: picked by points across all 12
 *     groups; admin assigns them to R32 slots using FIFA's lookup
 *     table (we emit placeholder slots matching the BRACKET config
 *     so the pairing only needs team-name substitution).
 */

import { BRACKET, GROUPS, GROUP_FIXTURES, TEAMS } from './world-cup-2026.js';

// ── Types (shape reference) ─────────────────────────────────────────────
// TeamStanding = { code, name, played, wins, draws, losses, points }

function badgeUrl(team) {
  if (!team) return null;
  if (team.espn) return `https://a.espncdn.com/i/teamlogos/countries/500/${team.espn}.png`;
  if (team.code) return `https://flagcdn.com/w160/${team.code}.png`;
  return null;
}

/**
 * Build {groupKey → [TeamStanding, TeamStanding, …]} from resolved
 * match markets. A market is a "group match" when source_data.group
 * is set AND source_data.matchday starts with 'MD'. Returns null if
 * any group is incomplete.
 */
export function computeStandings(resolvedMarkets) {
  const byGroup = new Map();
  for (const g of GROUPS) {
    byGroup.set(g.key, new Map()); // teamCode → standing
    for (const code of g.teams) {
      const team = TEAMS[code];
      byGroup.get(g.key).set(code, {
        code,
        name: team?.name || code,
        played: 0, wins: 0, draws: 0, losses: 0, points: 0,
      });
    }
  }

  // Count per group how many matches resolved — we need all 6 to
  // consider a group "complete". The static fixture list is our
  // ground truth for the expected match count.
  const expected = Object.fromEntries(GROUPS.map(g => [g.key, 0]));
  for (const f of GROUP_FIXTURES) expected[f.group] += 1;
  const resolved = Object.fromEntries(GROUPS.map(g => [g.key, 0]));

  for (const m of resolvedMarkets) {
    const sd = m.sourceData || null;
    if (!sd?.group) continue;
    if (!byGroup.has(sd.group)) continue;
    if (m.status !== 'resolved') continue;
    const homeCode = sd.home?.code;
    const awayCode = sd.away?.code;
    if (!homeCode || !awayCode) continue;
    const stands = byGroup.get(sd.group);
    const h = stands.get(homeCode);
    const a = stands.get(awayCode);
    if (!h || !a) continue;
    const winner = Number(m.outcome);
    h.played += 1; a.played += 1;
    if (winner === 1) {
      h.draws += 1; a.draws += 1;
      h.points += 1; a.points += 1;
    } else if (winner === 0) {
      h.wins += 1; a.losses += 1; h.points += 3;
    } else if (winner === 2) {
      a.wins += 1; h.losses += 1; a.points += 3;
    }
    resolved[sd.group] += 1;
  }

  // Sort each group: points desc, then alphabetical (deterministic
  // tiebreak since we don't have GD / GF).
  const finalByGroup = {};
  for (const g of GROUPS) {
    const list = Array.from(byGroup.get(g.key).values());
    list.sort((x, y) => y.points - x.points || x.name.localeCompare(y.name));
    finalByGroup[g.key] = list;
  }

  const allGroupsComplete = GROUPS.every(g => resolved[g.key] >= expected[g.key]);
  return {
    standings: finalByGroup,
    matchesResolved: resolved,
    matchesExpected: expected,
    allGroupsComplete,
  };
}

/**
 * Top 8 third-placed teams across all 12 groups (FIFA advances 8
 * out of 12 into the R32). Returns a stable `{ teamCode, groupKey,
 * points }[]` sorted by points desc, alphabetical fallback.
 */
export function bestThirds(standings) {
  const thirds = GROUPS.map(g => {
    const s = standings[g.key]?.[2];
    if (!s) return null;
    return { teamCode: s.code, groupKey: g.key, points: s.points, name: s.name };
  }).filter(Boolean);
  thirds.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return thirds.slice(0, 8);
}

/**
 * Translate a bracket slot placeholder like "1A" / "2B" / "3C/E/F/H"
 * into an actual team by consulting the computed standings.
 *
 * For best-third slots ("3X/Y/Z/W") we pick the HIGHEST-ranked
 * third-placed team that is ALSO from one of the listed groups —
 * approximating FIFA's 3rd-place allocation table. If none match
 * (shouldn't happen if bestThirds length = 8), we fall back to the
 * overall best third.
 */
function slotTeamCode(placeholder, standings, thirdsRanked) {
  const m = /^(\d)([A-L])$/.exec(placeholder);
  if (m) {
    const pos = Number(m[1]);
    const groupKey = m[2];
    const team = standings[groupKey]?.[pos - 1];
    return team?.code || null;
  }
  const m2 = /^3([A-L/]+)$/.exec(placeholder);
  if (m2) {
    const allowedGroups = new Set(m2[1].split('/'));
    const pick = thirdsRanked.find(t => allowedGroups.has(t.groupKey))
              || thirdsRanked[0];
    return pick?.teamCode || null;
  }
  return null;
}

/**
 * Build R32 market specs (16 matches) from the resolved group
 * standings. Returns [] if groups aren't complete. Each spec is the
 * same shape the main WC generator emits so it flows through the
 * existing pending-markets → approve pipeline unchanged.
 */
export function buildR32Specs(standings) {
  const thirdsRanked = bestThirds(standings);
  // Thirds ordered by points is the "ranking pool". From that pool
  // we substitute into the four 3X/Y/Z/W placeholders one-at-a-time.
  const usedThirds = new Set();
  function pickThird(allowedGroups) {
    for (const t of thirdsRanked) {
      if (usedThirds.has(t.teamCode)) continue;
      if (!allowedGroups.has(t.groupKey)) continue;
      usedThirds.add(t.teamCode);
      return t;
    }
    // Fallback: any unused third, even outside allowed pool.
    for (const t of thirdsRanked) {
      if (!usedThirds.has(t.teamCode)) { usedThirds.add(t.teamCode); return t; }
    }
    return null;
  }

  const specs = [];
  for (const slot of BRACKET.r32) {
    const resolveSlot = (placeholder) => {
      const m = /^(\d)([A-L])$/.exec(placeholder);
      if (m) return standings[m[2]]?.[Number(m[1]) - 1]?.code || null;
      const m2 = /^3([A-L/]+)$/.exec(placeholder);
      if (m2) return pickThird(new Set(m2[1].split('/')))?.teamCode || null;
      return null;
    };
    const homeCode = resolveSlot(slot.home);
    const awayCode = resolveSlot(slot.away);
    if (!homeCode || !awayCode) continue;
    const home = TEAMS[homeCode];
    const away = TEAMS[awayCode];
    if (!home || !away) continue;

    const kickoffIso = `${slot.date}T18:00:00Z`;
    const kickoffMs = new Date(kickoffIso).getTime();
    const startTime = new Date(kickoffMs).toISOString();
    const endTime = new Date(kickoffMs + 2 * 3600_000).toISOString();

    specs.push({
      source: 'fifa-wc-2026',
      source_event_id: `wc26-${slot.id}`,
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
      resolver_type: 'manual',
      resolver_config: {
        source: 'manual',
        matchId: slot.id,
        round: 'r32',
        shape: 'draw3',
      },
      source_data: {
        matchId: slot.id,
        round: 'r32',
        kickoffIso,
        home: { code: home.code, name: home.name, espn: home.espn },
        away: { code: away.code, name: away.name, espn: away.espn },
      },
    });
  }
  return specs;
}
