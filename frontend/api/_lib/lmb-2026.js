/**
 * Liga Mexicana de Béisbol 2026 — static team + fixture data.
 *
 * LMB has no public JSON API (lmb.com.mx is a Next.js site that
 * loads data through internal server routes and publishes only
 * PDFs), so we keep the roster + an upcoming-week fixture window
 * here and let admins extend via the manual market creation UI.
 *
 * To add more games, append to `FIXTURES` below with the same
 * shape. `matchId` must be stable across re-runs (use date+home+away)
 * so upserts stay idempotent.
 */

// ── Teams ────────────────────────────────────────────────────────────────
// ESPN doesn't have LMB badges; using logos hosted on Wikipedia is
// unreliable and the copyrighted club art isn't in the Commons CC
// pool consistently. The UI falls back to a text-initials "badge"
// when no logo URL is provided, so leaving `logo: null` here is a
// graceful degradation path. Paste the CloudFront URL LMB hosts if
// you want a proper badge on the cards.
export const LMB_TEAMS = {
  diablos:      { code: 'diablos',      name: 'Diablos Rojos del México',   city: 'CDMX',        logo: null },
  tigres:       { code: 'tigres',       name: 'Tigres de Quintana Roo',     city: 'Cancún',      logo: null },
  pericos:      { code: 'pericos',      name: 'Pericos de Puebla',          city: 'Puebla',      logo: null },
  leones:       { code: 'leones',       name: 'Leones de Yucatán',          city: 'Mérida',      logo: null },
  olmecas:      { code: 'olmecas',      name: 'Olmecas de Tabasco',         city: 'Villahermosa',logo: null },
  guerreros:    { code: 'guerreros',    name: 'Guerreros de Oaxaca',        city: 'Oaxaca',      logo: null },
  aguila:       { code: 'aguila',       name: 'El Águila de Veracruz',      city: 'Veracruz',    logo: null },
  algodoneros:  { code: 'algodoneros',  name: 'Algodoneros de Unión Laguna', city: 'Gómez Palacio', logo: null },
  acereros:     { code: 'acereros',     name: 'Acereros de Monclova',       city: 'Monclova',    logo: null },
  saraperos:    { code: 'saraperos',    name: 'Saraperos de Saltillo',      city: 'Saltillo',    logo: null },
  sultanes:     { code: 'sultanes',     name: 'Sultanes de Monterrey',      city: 'Monterrey',   logo: null },
  tecolotes:    { code: 'tecolotes',    name: 'Tecolotes de los Dos Laredos', city: 'Laredo',    logo: null },
  generales:    { code: 'generales',    name: 'Generales de Durango',       city: 'Durango',     logo: null },
  conspiradores:{ code: 'conspiradores',name: 'Conspiradores de Querétaro', city: 'Querétaro',   logo: null },
  mariachis:    { code: 'mariachis',    name: 'Mariachis de Guadalajara',   city: 'Guadalajara', logo: null },
  charros:      { code: 'charros',      name: 'Charros de Jalisco',         city: 'Zapopan',     logo: null },
  bravos:       { code: 'bravos',       name: 'Bravos de León',             city: 'León',        logo: null },
  diablos_blancos: { code: 'caliente',  name: 'Caliente de Durango',        city: 'Durango',     logo: null },
};

// ── Fixture window ──────────────────────────────────────────────────────
// Seeded with plausible upcoming-week matchups. Dates are ISO 8601
// UTC; kickoff slotted to 01:00 UTC (~19:00 CT the previous day) as
// LMB standard night-game time. Replace/extend from the official
// schedule PDF once you have the full calendar.
function mk(date, home, away, venue) {
  return {
    matchId: `lmb26-${date}-${home}-${away}`,
    dateYmd: date,
    kickoffIso: `${date}T01:00:00Z`,
    homeCode: home,
    awayCode: away,
    venue,
  };
}

export const FIXTURES = [
  mk('2026-04-23', 'diablos',    'tigres',     'Estadio Alfredo Harp Helú'),
  mk('2026-04-23', 'sultanes',   'acereros',   'Estadio Mobil Super'),
  mk('2026-04-24', 'pericos',    'leones',     'Estadio Hermanos Serdán'),
  mk('2026-04-24', 'charros',    'mariachis',  'Estadio Panamericano'),
  mk('2026-04-25', 'diablos',    'sultanes',   'Estadio Alfredo Harp Helú'),
  mk('2026-04-25', 'olmecas',    'aguila',     'Parque Centenario'),
  mk('2026-04-26', 'saraperos',  'algodoneros','Estadio Francisco I. Madero'),
  mk('2026-04-26', 'guerreros',  'tecolotes',  'Estadio Eduardo Vasconcelos'),
  mk('2026-04-27', 'conspiradores','bravos',   'Estadio Domingo Santana'),
  mk('2026-04-28', 'leones',     'pericos',    'Parque Kukulcán'),
  mk('2026-04-29', 'tigres',     'diablos',    'Beto Ávila'),
  mk('2026-04-30', 'mariachis',  'charros',    'Estadio Panamericano'),
];
