/**
 * F1 market generator (parallel binary per driver).
 *
 * Jolpica is the community-maintained continuation of Ergast after
 * Ergast's shutdown; its schedule + driver-standings endpoints remain
 * drop-in compatible. We pull the NEXT race + the current driver
 * lineup and build ONE parallel market per race with ~20 legs
 * ("{Driver} gana el {GP}").
 *
 * ammMode = 'parallel' so users can bet on multiple drivers without
 * the strict "prices sum to 1" constraint — matches the user's own
 * spec and the F1 DFS-style market convention.
 *
 * Resolver: manual for now. A later pass can auto-settle via Jolpica's
 * results endpoint once the race is over.
 */

const BASE = 'https://api.jolpi.ca/ergast/f1';

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`jolpica: HTTP ${res.status}`);
  return res.json();
}

/**
 * Find the next scheduled race whose start is still in the future.
 * Jolpica's /current/next is a direct shortcut that's been solid.
 */
async function fetchNextRace() {
  try {
    const data = await fetchJson('/current/next.json');
    const race = data?.MRData?.RaceTable?.Races?.[0];
    if (!race) return null;
    const startIso = `${race.date}T${race.time || '00:00:00Z'}`;
    const startMs = new Date(startIso).getTime();
    if (!Number.isFinite(startMs) || startMs <= Date.now()) return null;
    return { ...race, _startIso: startIso };
  } catch (e) {
    console.error('[market-gen/f1] next race fetch failed', { message: e?.message });
    return null;
  }
}

async function fetchCurrentDrivers() {
  try {
    const data = await fetchJson('/current/drivers.json');
    const drivers = data?.MRData?.DriverTable?.Drivers || [];
    return drivers.map(d => ({
      id: d.driverId,
      code: d.code,
      label: `${d.givenName} ${d.familyName}`.trim(),
    }));
  } catch (e) {
    console.error('[market-gen/f1] drivers fetch failed', { message: e?.message });
    return [];
  }
}

export async function generateF1Markets() {
  const [race, drivers] = await Promise.all([fetchNextRace(), fetchCurrentDrivers()]);
  if (!race || drivers.length < 5) return [];

  // Lock trading 10 minutes before lights-out so the last-second grid
  // odds don't get chased while the resolver sorts qualifying.
  const endTime = new Date(new Date(race._startIso).getTime() - 10 * 60_000).toISOString();
  const raceName = race.raceName || `GP ${race.round}`;
  const season = race.season;
  const round = race.round;

  // Build legs with an explicit "Otro" catchall so a mid-season
  // substitute (reserve driver, replacement) doesn't leave the market
  // unresolvable. The sports_api resolver looks up the winner's
  // driverId against cfg.legs[].driverId; anything unmatched wins Otro.
  const legs = [
    ...drivers.map(d => ({ label: d.label, driverId: d.id })),
    { label: 'Otro', driverId: null },
  ];

  return [{
    source: 'jolpica-f1',
    source_event_id: `f1:${season}:${round}`,
    question: `¿Quién gana el ${raceName} ${season}?`,
    category: 'deportes',
    icon: '🏁',
    outcomes: legs.map(l => l.label),
    seed_liquidity: 1000,
    end_time: endTime,
    amm_mode: 'parallel',           // one binary per driver
    resolver_type: 'sports_api',    // auto via Jolpica /{season}/{round}/results
    resolver_config: {
      source: 'jolpica-f1',
      season, round,
      shape: 'parallel',
      legs,
    },
    source_data: {
      season, round,
      raceName,
      startIso: race._startIso,
      circuitName: race?.Circuit?.circuitName,
      drivers: drivers.map(d => ({ id: d.id, code: d.code, label: d.label })),
    },
  }];
}
