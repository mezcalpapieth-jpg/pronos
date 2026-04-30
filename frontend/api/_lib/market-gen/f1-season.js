/**
 * F1 season-long markets — Constructors' and Drivers' Championship.
 *
 * Two parallel markets per season, idempotent on
 * (source='jolpica-f1-season', source_event_id='constructors-2026' /
 * 'drivers-2026'). The (source, source_event_id) UNIQUE on
 * points_pending_markets keeps re-runs a no-op once the rows exist.
 *
 * Resolution: sports_api via readJolpicaF1Standings (sports-results.js).
 * The cron polls /api/f1/<season>/{constructorStandings,driverStandings}
 * and picks position-1 once end_time has passed (~3 days after the
 * Abu Dhabi GP). Standings can fluctuate up to the final race, so the
 * end_time is set deliberately — auto-resolve only fires after the
 * season is mathematically locked.
 *
 * Images are Wikipedia portraits/logos pulled at generation time
 * (one Wiki fetch per outcome). Subsequent cron ticks see the row
 * already exists and skip — Wikipedia load is bounded to once per
 * season per slot.
 */

import { CONSTRUCTORS_2026 } from '../f1-grid-2026.js';
import { fetchWikipediaImage } from '../wikipedia.js';

const SEASON = 2026;

// Last race of the 2026 season is Abu Dhabi GP on 2026-12-06.
// Buffer to 2026-12-10 23:59 UTC so the cron has 3-4 days to see
// final standings before flipping the market to resolved.
const SEASON_FINALE_END_ISO = '2026-12-10T23:59:00.000Z';

// Top-12 driver field for the Drivers' Championship market.
// IDs verified against the live 2026 Jolpica standings on
// 2026-04-30 — Tsunoda was demoted off the grid before the season,
// Hadjar moved up to Red Bull, Lindblad debuted at RB. Pérez and
// Bottas are at the new Cadillac team but skip them here since
// the title is realistically out of reach for that first-year
// program. "Otro" catches dark-horse winners (incl. anyone we
// didn't list).
//
// driverId is the Jolpica/Ergast slug, used by the cron's
// parallel-shape matcher (id-match → label-match → 'Otro').
const DRIVER_FIELD_2026 = [
  { id: 'norris',         name: 'Lando Norris',     wiki: 'https://en.wikipedia.org/wiki/Lando_Norris' },
  { id: 'max_verstappen', name: 'Max Verstappen',   wiki: 'https://en.wikipedia.org/wiki/Max_Verstappen' },
  { id: 'piastri',        name: 'Oscar Piastri',    wiki: 'https://en.wikipedia.org/wiki/Oscar_Piastri' },
  { id: 'russell',        name: 'George Russell',   wiki: 'https://en.wikipedia.org/wiki/George_Russell_(racing_driver)' },
  { id: 'antonelli',      name: 'Kimi Antonelli',   wiki: 'https://en.wikipedia.org/wiki/Andrea_Kimi_Antonelli' },
  { id: 'leclerc',        name: 'Charles Leclerc',  wiki: 'https://en.wikipedia.org/wiki/Charles_Leclerc' },
  { id: 'hamilton',       name: 'Lewis Hamilton',   wiki: 'https://en.wikipedia.org/wiki/Lewis_Hamilton' },
  { id: 'sainz',          name: 'Carlos Sainz',     wiki: 'https://en.wikipedia.org/wiki/Carlos_Sainz_Jr.' },
  { id: 'alonso',         name: 'Fernando Alonso',  wiki: 'https://en.wikipedia.org/wiki/Fernando_Alonso' },
  { id: 'albon',          name: 'Alexander Albon',  wiki: 'https://en.wikipedia.org/wiki/Alex_Albon' },
  { id: 'hulkenberg',     name: 'Nico Hülkenberg',  wiki: 'https://en.wikipedia.org/wiki/Nico_H%C3%BClkenberg' },
  { id: 'hadjar',         name: 'Isack Hadjar',     wiki: 'https://en.wikipedia.org/wiki/Isack_Hadjar' },
];

// Constructors' field — every team on the 2026 grid (no "Otro" for
// constructors since the field is closed; one of these eleven will
// win). Constructor IDs match the live 2026 Jolpica standings — note
// `audi` (the renamed-from-Sauber team for 2026) and the new
// Cadillac entry. The wiki-image lookup still goes through
// CONSTRUCTORS_2026 from f1-grid-2026.js, where the entries are
// keyed by the local team-key string (mapped via `key` below).
const CONSTRUCTOR_FIELD_2026 = [
  { id: 'mclaren',      key: 'mclaren',      name: 'McLaren' },
  { id: 'red_bull',     key: 'red-bull',     name: 'Red Bull Racing' },
  { id: 'ferrari',      key: 'ferrari',      name: 'Ferrari' },
  { id: 'mercedes',     key: 'mercedes',     name: 'Mercedes' },
  { id: 'aston_martin', key: 'aston-martin', name: 'Aston Martin' },
  { id: 'williams',     key: 'williams',     name: 'Williams' },
  { id: 'alpine',       key: 'alpine',       name: 'Alpine' },
  { id: 'rb',           key: 'rb',           name: 'Racing Bulls' },
  { id: 'haas',         key: 'haas',         name: 'Haas' },
  { id: 'audi',         key: 'sauber',       name: 'Audi' },
  { id: 'cadillac',     key: 'cadillac',     name: 'Cadillac' },
];

// Process-local memoization so the per-cron-tick image fetch is at
// most one round-trip per Wikipedia URL. Survives across both the
// Drivers' and Constructors' markets in the same generator run.
const wikiImageCache = new Map();
async function cachedWikiImage(url) {
  if (!url) return null;
  if (wikiImageCache.has(url)) return wikiImageCache.get(url);
  const img = await fetchWikipediaImage(url).catch(() => null);
  wikiImageCache.set(url, img);
  return img;
}

export async function generateF1SeasonMarkets() {
  // Build the Drivers' market.
  const driverImages = await Promise.all(
    DRIVER_FIELD_2026.map(p => cachedWikiImage(p.wiki)),
  );
  const driverLegs = [
    ...DRIVER_FIELD_2026.map(p => ({ label: p.name, driverId: p.id })),
    { label: 'Otro', driverId: null },
  ];

  // Build the Constructors' market. No "Otro" — the constructor
  // field is closed (11 teams on the 2026 grid).
  const constructorImages = await Promise.all(
    CONSTRUCTOR_FIELD_2026.map(t => cachedWikiImage(CONSTRUCTORS_2026[t.key]?.wiki || null)),
  );
  const constructorLegs = CONSTRUCTOR_FIELD_2026.map(t => ({ label: t.name, driverId: t.id }));

  return [
    {
      source: 'jolpica-f1-season',
      source_event_id: `drivers-${SEASON}`,
      sport: 'f1',
      league: 'formula-1',
      question: `¿Quién gana el Mundial de Pilotos ${SEASON}?`,
      category: 'deportes',
      icon: '🏆',
      outcomes: driverLegs.map(l => l.label),
      outcome_images: [...driverImages, null /* Otro */],
      seed_liquidity: 1500,
      // Markets are tradeable from now until ~3-4 days after the
      // season finale, so users can keep pricing in race-by-race
      // momentum until the title is mathematically locked.
      start_time: null,
      end_time: SEASON_FINALE_END_ISO,
      amm_mode: 'parallel',
      resolver_type: 'sports_api',
      resolver_config: {
        source: 'jolpica-f1-standings',
        shape: 'parallel',
        kind: 'drivers',
        season: SEASON,
        legs: driverLegs,
      },
      source_data: {
        season: SEASON,
        kind: 'drivers',
        field: DRIVER_FIELD_2026,
      },
    },
    {
      source: 'jolpica-f1-season',
      source_event_id: `constructors-${SEASON}`,
      sport: 'f1',
      league: 'formula-1',
      question: `¿Quién gana el Mundial de Constructores ${SEASON}?`,
      category: 'deportes',
      icon: '🏎️',
      outcomes: constructorLegs.map(l => l.label),
      outcome_images: constructorImages,
      seed_liquidity: 1500,
      start_time: null,
      end_time: SEASON_FINALE_END_ISO,
      amm_mode: 'parallel',
      resolver_type: 'sports_api',
      resolver_config: {
        source: 'jolpica-f1-standings',
        shape: 'parallel',
        kind: 'constructors',
        season: SEASON,
        legs: constructorLegs,
      },
      source_data: {
        season: SEASON,
        kind: 'constructors',
        field: CONSTRUCTOR_FIELD_2026,
      },
    },
  ];
}
