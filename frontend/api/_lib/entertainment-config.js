/**
 * Entertainment event calendar — admin-curated config for markets
 * that can't be auto-discovered via an API.
 *
 * The entertainment generator reads from three arrays below and emits
 * pending-market specs for any event whose resolution date falls in
 * the near-term horizon. Admin resolves these manually after the
 * event airs.
 *
 * To update: append to the appropriate array, commit, Vercel
 * redeploys, next cron run picks it up. A single (kind, key)
 * source_event_id keeps re-runs idempotent per the DO UPDATE upsert
 * — so editing nominees / dates in place will refresh pending rows.
 *
 * ─── SHAPES ──────────────────────────────────────────────────────────
 *
 * AWARD:  { kind:'award', key, label, ceremonyDate, categories:[
 *           { key, label, nominees:[string] }] }
 * REALITY WEEK: { kind:'reality_week', key, showLabel, seasonLabel,
 *           weekNumber, eliminationDate, nominated:[string] }
 * REALITY WINNER: { kind:'reality_winner', key, showLabel, seasonLabel,
 *           finaleDate, housemates:[string] }
 * CONCERT: { kind:'concert', key, question, resolveAt,
 *           artist, venue, category? }
 *
 * `resolveAt` is an ISO UTC string; close time. `icon` / `category`
 * default sensibly per kind.
 */

// ─── Awards (Latin Grammy, Premios Juventud, Premios Lo Nuestro, …) ────
// Generator creates one parallel market per category whose ceremonyDate
// is within the horizon. Categories without at least 2 nominees are
// skipped (not enough legs to make a real market).
export const AWARD_CEREMONIES = [
  // Template — uncomment + fill when nominees drop for Latin Grammy 2026.
  // {
  //   kind: 'award',
  //   key: 'latin-grammy-2026',
  //   label: 'Latin Grammy 2026',
  //   ceremonyDate: '2026-11-13T01:00Z',
  //   categories: [
  //     { key: 'record',        label: 'Grabación del Año',     nominees: [] },
  //     { key: 'album',         label: 'Álbum del Año',          nominees: [] },
  //     { key: 'song',          label: 'Canción del Año',        nominees: [] },
  //     { key: 'newArtist',     label: 'Mejor Artista Nuevo',   nominees: [] },
  //   ],
  // },
];

// ─── Reality shows (La Casa de los Famosos, Exatlón, MasterChef…) ──────
// Two market types per season:
//   reality_week   → weekly elimination, parallel over nominees
//   reality_winner → season winner, parallel over initial cast
// Weekly entries get appended one at a time as the show airs and
// admin learns who got nominated each Monday.
export const REALITY_EVENTS = [
  // Template — uncomment + fill when LCDLF México season dates confirm.
  // {
  //   kind: 'reality_winner',
  //   key: 'lcdlf-mx-s3-winner',
  //   showLabel: 'La Casa de los Famosos México',
  //   seasonLabel: 'Temporada 3',
  //   finaleDate: '2026-09-28T02:00Z',
  //   housemates: [
  //     // seed with the full initial cast — keep length ≤ ~14 so the
  //     // parallel UI stays scannable
  //   ],
  // },
  // {
  //   kind: 'reality_week',
  //   key: 'lcdlf-mx-s3-w1',
  //   showLabel: 'La Casa de los Famosos México',
  //   seasonLabel: 'Temporada 3',
  //   weekNumber: 1,
  //   eliminationDate: '2026-07-20T02:00Z',
  //   nominated: ['Nominado 1', 'Nominado 2', 'Nominado 3'],
  // },
];

// ─── Concerts & tours (Ticketmaster / promoter-announced) ──────────────
// Binary markets. question is the full user-facing text so the admin
// keeps full creative control. resolveAt is when the answer becomes
// knowable (e.g. the date you can confirm sold-out status).
export const CONCERT_EVENTS = [
  // Template — uncomment + fill when real concert news lands.
  // {
  //   kind: 'concert',
  //   key: 'badbunny-cdmx-2026-06-10',
  //   artist: 'Bad Bunny',
  //   venue: 'Arena CDMX',
  //   question: '¿Bad Bunny vende todos los boletos de Arena CDMX antes del 1 de junio?',
  //   resolveAt: '2026-06-01T06:00Z',
  // },
];
