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
// Logos come from LMB's own CloudFront CDN (the host they use on
// lmb.com.mx). URLs verified with HEAD probes — filenames confirmed
// 200 at time of writing. The UI falls back to text-initials if a
// URL starts returning 404 (team rebrand / folder reshuffle), so
// these stay best-effort rather than critical.
const CF = 'https://d11rb39sj794dg.cloudfront.net/public';

export const LMB_TEAMS = {
  diablos:       { code: 'diablos',       name: 'Diablos Rojos del México',     city: 'CDMX',          logo: `${CF}/2024-04/Diablos.png` },
  tigres:        { code: 'tigres',        name: 'Tigres de Quintana Roo',       city: 'Cancún',        logo: `${CF}/2025-04/Tigres_2025.png` },
  pericos:       { code: 'pericos',       name: 'Pericos de Puebla',            city: 'Puebla',        logo: `${CF}/2024-04/Pericos.png` },
  leones:        { code: 'leones',        name: 'Leones de Yucatán',            city: 'Mérida',        logo: `${CF}/2024-04/Leones.png` },
  olmecas:       { code: 'olmecas',       name: 'Olmecas de Tabasco',           city: 'Villahermosa',  logo: `${CF}/2026-03/olmecas_azul.png` },
  guerreros:     { code: 'guerreros',     name: 'Guerreros de Oaxaca',          city: 'Oaxaca',        logo: `${CF}/2024-04/Guerreros.png` },
  aguila:        { code: 'aguila',        name: 'El Águila de Veracruz',        city: 'Veracruz',      logo: `${CF}/2025-05/veracruz.png` },
  algodoneros:   { code: 'algodoneros',   name: 'Algodoneros de Unión Laguna',  city: 'Gómez Palacio', logo: `${CF}/2024-04/Algodoneros.png` },
  acereros:      { code: 'acereros',      name: 'Acereros de Monclova',         city: 'Monclova',      logo: `${CF}/2024-04/Acereros.png` },
  saraperos:     { code: 'saraperos',     name: 'Saraperos de Saltillo',        city: 'Saltillo',      logo: `${CF}/2024-04/Saraperos.png` },
  sultanes:      { code: 'sultanes',      name: 'Sultanes de Monterrey',        city: 'Monterrey',     logo: `${CF}/2024-04/Sultanes.png` },
  tecolotes:     { code: 'tecolotes',     name: 'Tecolotes de los Dos Laredos', city: 'Laredo',        logo: `${CF}/2024-04/Tecolotes.png` },
  conspiradores: { code: 'conspiradores', name: 'Conspiradores de Querétaro',   city: 'Querétaro',     logo: `${CF}/2024-04/Conspiradores.png` },
  charros:       { code: 'charros',       name: 'Charros de Jalisco',           city: 'Zapopan',       logo: `${CF}/2024-04/Charros.png` },
  bravos:        { code: 'bravos',        name: 'Bravos de León',               city: 'León',          logo: `${CF}/2024-04/Bravos.png` },
  caliente:      { code: 'caliente',      name: 'Caliente de Durango',          city: 'Durango',       logo: `${CF}/2025-03/caliente.png` },
  piratas:       { code: 'piratas',       name: 'Piratas de Campeche',          city: 'Campeche',      logo: `${CF}/2024-04/Piratas.png` },
  toros:         { code: 'toros',         name: 'Toros de Tijuana',             city: 'Tijuana',       logo: `${CF}/2024-04/Toros.png` },
  dorados:       { code: 'dorados',       name: 'Dorados de Chihuahua',         city: 'Chihuahua',     logo: `${CF}/2024-04/Dorados1.png` },
  rieleros:      { code: 'rieleros',      name: 'Rieleros de Aguascalientes',   city: 'Aguascalientes',logo: `${CF}/2026-01/rieleros_azul.png` },
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
  mk('2026-04-24', 'charros',    'piratas',    'Estadio Panamericano'),
  mk('2026-04-25', 'diablos',    'sultanes',   'Estadio Alfredo Harp Helú'),
  mk('2026-04-25', 'olmecas',    'aguila',     'Parque Centenario'),
  mk('2026-04-26', 'saraperos',  'algodoneros','Estadio Francisco I. Madero'),
  mk('2026-04-26', 'guerreros',  'tecolotes',  'Estadio Eduardo Vasconcelos'),
  mk('2026-04-27', 'conspiradores','bravos',   'Estadio Domingo Santana'),
  mk('2026-04-28', 'leones',     'pericos',    'Parque Kukulcán'),
  mk('2026-04-29', 'tigres',     'diablos',    'Beto Ávila'),
  mk('2026-04-30', 'toros',      'charros',    'Estadio Chevron'),
];
