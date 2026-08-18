/**
 * F1 market generator.
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
 * Outcome images: the race-winner grid uses constructor logos because
 * they read better at card scale and signal each driver's stable. Small
 * side H2H markets can override that with driver portraits.
 *
 * Resolver: sports_api / jolpica-f1 — auto-settles via the results
 * endpoint once the race is over.
 */

import { fetchWikipediaImage } from '../wikipedia.js';
import { teamForDriver } from '../f1-grid-2026.js';

const BASE = 'https://api.jolpi.ca/ergast/f1';

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`jolpica: HTTP ${res.status}`);
  return res.json();
}

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
      wikiUrl: d.url || null,
    }));
  } catch (e) {
    console.error('[market-gen/f1] drivers fetch failed', { message: e?.message });
    return [];
  }
}

function isDutchGrandPrix(raceName) {
  return /dutch|netherlands|pa[ií]ses bajos/i.test(String(raceName || ''));
}

function f1BinaryMarket({
  season,
  round,
  raceName,
  startTime,
  endTime,
  suffix,
  question,
  resolverConfig,
  outcomes = ['Sí', 'No'],
  outcomeImages = null,
  outcomeImage = null,
}) {
  const normalizedOutcomes = Array.isArray(outcomes) && outcomes.length >= 2
    ? outcomes
    : ['Sí', 'No'];
  const normalizedImages = Array.isArray(outcomeImages) && outcomeImages.length === normalizedOutcomes.length
    ? outcomeImages
    : normalizedOutcomes.map((_, i) => (i === 0 ? outcomeImage : null));

  return {
    source: 'jolpica-f1-side',
    source_event_id: `f1:${season}:${round}:${suffix}`,
    sport: 'f1',
    league: 'formula-1',
    question,
    category: 'deportes',
    icon: '🏁',
    outcomes: normalizedOutcomes,
    outcome_images: normalizedImages,
    seed_liquidity: 1000,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'unified',
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'jolpica-f1',
      season,
      round,
      ...resolverConfig,
    },
    source_data: {
      season,
      round,
      raceName,
      marketKind: suffix,
      marketStyle: normalizedOutcomes[0] === 'Sí' && normalizedOutcomes[1] === 'No'
        ? 'binary'
        : 'head-to-head',
    },
  };
}

function buildDutchGpSideMarkets({
  season,
  round,
  raceName,
  startTime,
  endTime,
  imageByDriverId = new Map(),
  portraitByDriverId = new Map(),
  imageByTeamKey = new Map(),
}) {
  if (String(season) !== '2026' || !isDutchGrandPrix(raceName)) return [];

  const perezImage = portraitByDriverId.get('perez')
    || imageByDriverId.get('perez')
    || imageByTeamKey.get('cadillac')
    || null;
  const bottasImage = portraitByDriverId.get('bottas')
    || imageByDriverId.get('bottas')
    || imageByTeamKey.get('cadillac')
    || null;

  return [
    f1BinaryMarket({
      season,
      round,
      raceName,
      startTime,
      endTime,
      suffix: 'perez-ahead-bottas',
      question: '¿Quién terminará delante en la carrera del Dutch GP 2026: Checo Pérez o Valtteri Bottas?',
      outcomes: ['Checo Pérez', 'Valtteri Bottas'],
      outcomeImages: [perezImage, bottasImage],
      resolverConfig: {
        shape: 'driver-ahead',
        driverAId: 'perez',
        driverALabel: 'Sergio Pérez',
        driverBId: 'bottas',
        driverBLabel: 'Valtteri Bottas',
      },
    }),
    f1BinaryMarket({
      season,
      round,
      raceName,
      startTime,
      endTime,
      suffix: 'verstappen-first-win-home',
      question: '¿Max Verstappen gana su primera carrera de la temporada en casa?',
      outcomeImage: imageByDriverId.get('max_verstappen') || imageByTeamKey.get('red-bull') || null,
      resolverConfig: {
        shape: 'driver-wins',
        driverId: 'max_verstappen',
        driverLabel: 'Max Verstappen',
      },
    }),
    f1BinaryMarket({
      season,
      round,
      raceName,
      startTime,
      endTime,
      suffix: 'perez-first-points',
      question: '¿Checo Pérez suma sus primeros puntos de la temporada en la carrera del Dutch GP 2026?',
      outcomeImage: imageByDriverId.get('perez') || imageByTeamKey.get('cadillac') || null,
      resolverConfig: {
        shape: 'driver-points',
        driverId: 'perez',
        driverLabel: 'Sergio Pérez',
      },
    }),
  ];
}

export async function generateF1Markets() {
  const [race, allDrivers] = await Promise.all([fetchNextRace(), fetchCurrentDrivers()]);
  if (!race) return [];

  // Filter Jolpica's roster through the hand-maintained 2026 grid
  // map so we only produce legs for the 22 drivers actually racing.
  // Reserves (Jak Crawford et al) are dropped; veterans whose 2026
  // transfers Jolpica hasn't reflected get their correct team from
  // the map anyway.
  const gridDrivers = [];
  for (const d of allDrivers) {
    const team = teamForDriver(d.label);
    if (!team) continue;
    gridDrivers.push({ ...d, teamKey: team.teamKey, teamName: team.name, teamWiki: team.wiki });
  }
  if (gridDrivers.length < 5) {
    console.warn('[market-gen/f1] grid filter dropped too many drivers', {
      jolpicaCount: allDrivers.length, matched: gridDrivers.length,
    });
    return [];
  }

  const kickoffMs = new Date(race._startIso).getTime();
  const startTime = new Date(kickoffMs).toISOString();
  const endTime   = new Date(kickoffMs + 2 * 3600_000).toISOString();
  const raceName = race.raceName || `GP ${race.round}`;
  const season = race.season;
  const round = race.round;

  // Wikipedia logo lookup, cached by teamKey so each team is hit
  // at most once per generator run (11 fetches instead of 22).
  const logoByTeam = new Map();
  async function resolveTeamLogo(teamKey, wiki) {
    if (logoByTeam.has(teamKey)) return logoByTeam.get(teamKey);
    const logo = wiki ? await fetchWikipediaImage(wiki) : null;
    logoByTeam.set(teamKey, logo);
    return logo;
  }
  const driverImages = await Promise.all(
    gridDrivers.map(d => resolveTeamLogo(d.teamKey, d.teamWiki)),
  );
  const imageByDriverId = new Map(gridDrivers.map((d, i) => [d.id, driverImages[i] || null]));
  const imageByTeamKey = new Map(logoByTeam);

  const portraitByDriverId = new Map();
  if (String(season) === '2026' && isDutchGrandPrix(raceName)) {
    const dutchSideDriverIds = new Set(['perez', 'bottas']);
    const dutchSidePortraitEntries = await Promise.all(
      gridDrivers
        .filter(d => dutchSideDriverIds.has(d.id))
        .map(async d => [d.id, d.wikiUrl ? await fetchWikipediaImage(d.wikiUrl) : null]),
    );
    for (const [driverId, image] of dutchSidePortraitEntries) {
      portraitByDriverId.set(driverId, image);
    }
  }

  const legs = [
    ...gridDrivers.map(d => ({ label: d.label, driverId: d.id, teamKey: d.teamKey })),
    { label: 'Otro', driverId: null, teamKey: null },
  ];
  const outcomeImages = [...driverImages, null];

  const raceWinnerMarket = {
    source: 'jolpica-f1',
    source_event_id: `f1:${season}:${round}`,
    sport: 'f1',
    league: 'formula-1',
    question: `¿Quién gana el ${raceName} ${season}?`,
    category: 'deportes',
    icon: '🏁',
    outcomes: legs.map(l => l.label),
    outcome_images: outcomeImages,
    seed_liquidity: 1000,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'parallel',
    resolver_type: 'sports_api',
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
      drivers: gridDrivers.map((d, i) => ({
        id: d.id,
        code: d.code,
        label: d.label,
        wikiUrl: d.wikiUrl,
        teamKey: d.teamKey,
        teamName: d.teamName,
        teamLogo: driverImages[i] || null,
      })),
    },
  };

  return [
    raceWinnerMarket,
    ...buildDutchGpSideMarkets({
      season,
      round,
      raceName,
      startTime,
      endTime,
      imageByDriverId,
      portraitByDriverId,
      imageByTeamKey,
    }),
  ];
}

export const _internal = {
  buildDutchGpSideMarkets,
  f1BinaryMarket,
  isDutchGrandPrix,
};
