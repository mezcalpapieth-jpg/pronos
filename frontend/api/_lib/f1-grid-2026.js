/**
 * 2026 F1 grid — authoritative driver → team mapping.
 *
 * Jolpica's /current/drivers endpoint has been unreliable for
 * recent 2025/2026 transfers (Hamilton → Ferrari, Sainz → Williams,
 * Pérez/Bottas → Cadillac, Ocon → Haas, Hülkenberg → Sauber etc),
 * and it also surfaces reserve drivers like Jak Crawford who
 * aren't on the race grid. This file is the source of truth: both
 * the F1 generator and retrofit filter the Jolpica roster through
 * GRID_2026 so only the 22 actual race drivers get markets, each
 * tagged with their correct constructor's Wikipedia page.
 *
 * Edit freely — rookie call-ups or mid-season swaps get fixed by
 * updating the name → team mapping below.
 */

// Team key → { displayName, wikiUrl } for the 11 constructors on
// the 2026 grid. `wikiUrl` feeds Wikipedia's REST summary API for
// the badge art; pages were HEAD-probed and all return a logo.
export const CONSTRUCTORS_2026 = {
  'red-bull':     { name: 'Red Bull Racing', wiki: 'https://en.wikipedia.org/wiki/Red_Bull_Racing' },
  'ferrari':      { name: 'Ferrari',         wiki: 'https://en.wikipedia.org/wiki/Scuderia_Ferrari' },
  'mercedes':     { name: 'Mercedes',        wiki: 'https://en.wikipedia.org/wiki/Mercedes-AMG_Petronas_F1_Team' },
  'mclaren':      { name: 'McLaren',         wiki: 'https://en.wikipedia.org/wiki/McLaren' },
  'aston-martin': { name: 'Aston Martin',    wiki: 'https://en.wikipedia.org/wiki/Aston_Martin_in_Formula_One' },
  'alpine':       { name: 'Alpine',          wiki: 'https://en.wikipedia.org/wiki/BWT_Alpine_F1_Team' },
  'williams':     { name: 'Williams',        wiki: 'https://en.wikipedia.org/wiki/Williams_Racing' },
  'rb':           { name: 'Racing Bulls',    wiki: 'https://en.wikipedia.org/wiki/Racing_Bulls_Formula_One_Team' },
  'sauber':       { name: 'Kick Sauber',     wiki: 'https://en.wikipedia.org/wiki/Sauber_Motorsport' },
  'haas':         { name: 'Haas',            wiki: 'https://en.wikipedia.org/wiki/Haas_F1_Team' },
  'cadillac':     { name: 'Cadillac',        wiki: 'https://en.wikipedia.org/wiki/Cadillac_Formula_One_Team' },
};

// Normalized driver name → team key. Keys are lowercase + accent-
// stripped; aliases (e.g. "Alex Albon" vs "Alexander Albon") share
// the same team. Any driver NOT in this map is filtered out of the
// F1 market entirely — that's how we exclude reserves / test drivers
// like Jak Crawford.
const RAW_GRID = [
  // Red Bull Racing
  ['Max Verstappen', 'red-bull'],
  ['Yuki Tsunoda',   'red-bull'],
  // Ferrari
  ['Charles Leclerc', 'ferrari'],
  ['Lewis Hamilton',  'ferrari'],
  // Mercedes
  ['George Russell',           'mercedes'],
  ['Kimi Antonelli',           'mercedes'],
  ['Andrea Kimi Antonelli',    'mercedes'],  // Jolpica sometimes uses full name
  // McLaren
  ['Lando Norris',   'mclaren'],
  ['Oscar Piastri',  'mclaren'],
  // Aston Martin
  ['Fernando Alonso', 'aston-martin'],
  ['Lance Stroll',    'aston-martin'],
  // Alpine
  ['Pierre Gasly',      'alpine'],
  ['Franco Colapinto',  'alpine'],
  // Williams
  ['Alex Albon',         'williams'],
  ['Alexander Albon',    'williams'],
  ['Carlos Sainz',       'williams'],
  ['Carlos Sainz Jr.',   'williams'],
  ['Carlos Sainz Jr',    'williams'],
  // Racing Bulls (RB)
  ['Liam Lawson',  'rb'],
  ['Isack Hadjar', 'rb'],
  // Kick Sauber (Audi from 2026)
  ['Nico Hülkenberg',  'sauber'],
  ['Nico Hulkenberg',  'sauber'],
  ['Gabriel Bortoleto','sauber'],
  // Haas
  ['Esteban Ocon',   'haas'],
  ['Oliver Bearman', 'haas'],
  // Cadillac (new for 2026)
  ['Sergio Pérez',    'cadillac'],
  ['Sergio Perez',    'cadillac'],
  ['Valtteri Bottas', 'cadillac'],
];

function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\./g, '')
    .trim();
}

const NAME_TO_TEAM = new Map(
  RAW_GRID.map(([name, team]) => [normalize(name), team]),
);

/**
 * Look up a driver's constructor from the 2026 grid map. Returns
 * { teamKey, name, wiki } or null when the driver isn't on the
 * grid (reserves / test drivers / data errors).
 */
export function teamForDriver(name) {
  const teamKey = NAME_TO_TEAM.get(normalize(name));
  if (!teamKey) return null;
  const c = CONSTRUCTORS_2026[teamKey];
  if (!c) return null;
  return { teamKey, name: c.name, wiki: c.wiki };
}

export { normalize as normalizeDriverName };
