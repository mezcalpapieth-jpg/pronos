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
  tecos:         { code: 'tecos',         name: 'Tecos de los Dos Laredos',     city: 'Laredo',        logo: `${CF}/2024-04/Tecolotes.png` },
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
// INTENTIONALLY EMPTY.
//
// Previous revisions of this file shipped hand-crafted matchups with
// plausible-looking dates. The real lmb.com.mx schedule disagreed
// with what we had — we were generating markets for games that
// weren't actually scheduled, which is worse than having no LMB
// markets at all.
//
// Why we don't scrape: lmb.com.mx is a Next.js app whose /juegos
// page renders the scoreboard via an internal RSC payload that the
// public JS bundles don't expose. Reverse-engineering it is
// possible but breaks on every Next.js upgrade on their side.
//
// How to populate this array:
//   1) For ad-hoc market seeding, use the admin "Crear mercado" UI
//      directly — that writes straight into points_markets without
//      going through this generator. Best for one-off series.
//   2) For a scheduled pipeline, paste fixtures below in the
//      `mk(date, home, away, venue)` shape once you have a trusted
//      source (the official PDF calendar, a captured API response
//      from lmb.com.mx devtools, or Sportradar if we subscribe).
//
// Whenever this array is non-empty, the daily generator cron will
// produce pending-market specs that admin can approve. Leaving it
// empty is a safe default — the generator just returns [].
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

export const FIXTURES = [];
