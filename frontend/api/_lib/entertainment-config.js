/**
 * Entertainment event calendar — admin-curated config for markets
 * that can't be auto-discovered via an API.
 *
 * The entertainment generator reads from the arrays below and emits
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
 *           { key, label, nominees:[string], probabilities?: number[] }] }
 * REALITY WEEK: { kind:'reality_week', key, showLabel, seasonLabel,
 *           weekNumber, eliminationDate, nominated:[string], probabilities?: number[] }
 * REALITY WINNER: { kind:'reality_winner', key, showLabel, seasonLabel,
 *           finaleDate, housemates:[string], probabilities?: number[] }
 * CONCERT: { kind:'concert', key, question, resolveAt,
 *           artist, venue, category?, probabilityYes? }
 * POPULAR EVENT: { kind:'popular_event', key, question, resolveAt,
 *           category?, topic?, probabilityYes?, criteria, evidence?,
 *           tags?: { categoryTags?, geoTags?, topicTags? } }
 *
 * `resolveAt` is an ISO UTC string; close time. `probabilities` accepts
 * either 0–1 values or percentages. These become suggested opening odds
 * in admin, where they can still be edited before approval.
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

// ─── Popular culture / news-style binaries ─────────────────────────────
// Manual-review markets for broad, Polymarket-style questions that are
// popular enough to seed deliberately but do not have a trustworthy API
// resolver. These use a longer horizon than concerts so marquee dates
// such as GTA VI can appear in the admin queue while still staying capped.
export const POPULAR_EVENTS = [
  {
    kind: 'popular_event',
    key: 'gta6-delayed-again-2026',
    topic: 'gaming',
    question: '¿GTA VI se retrasa otra vez antes del 19 de noviembre de 2026?',
    category: 'general',
    icon: '🎮',
    resolveAt: '2026-11-20T06:00:00Z',
    probabilityYes: 28,
    criteria: 'Resolver Sí si Rockstar Games o Take-Two anuncian que el lanzamiento inicial de GTA VI para PS5/Xbox será después del 19 de noviembre de 2026, o si las tiendas oficiales muestran una fecha posterior antes del cierre. Resolver No si no hay anuncio oficial de retraso antes del cierre.',
    evidence: [
      {
        title: 'Rockstar Newswire · GTA VI set to launch November 19, 2026',
        url: 'https://www.rockstargames.com/newswire/article/ak3ak31a49a221/grand-theft-auto-vi-is-now-set-to-launch-november-19-2026',
        publishedAt: '2025-11-06',
      },
      {
        title: 'Rockstar Newswire · GTA VI pre-orders begin June 25',
        url: 'https://www.rockstargames.com/newswire/article/5171972o3ak5oa/pre-order-grand-theft-auto-vi-on-june-25',
        publishedAt: '2026-06-24',
      },
    ],
    tags: {
      categoryTags: ['general'],
      geoTags: ['world'],
      topicTags: ['general'],
    },
  },
  {
    kind: 'popular_event',
    key: 'avengers-doomsday-delayed-2026',
    topic: 'cine',
    movie: 'Avengers: Doomsday',
    franchise: 'Marvel Cinematic Universe',
    question: '¿Avengers: Doomsday se retrasa de su estreno del 18 de diciembre de 2026?',
    category: 'musica',
    icon: '🎬',
    resolveAt: '2026-12-18T23:59:00Z',
    probabilityYes: 22,
    criteria: 'Resolver Sí si Marvel Studios o Disney cambian oficialmente la fecha de estreno de Avengers: Doomsday a una fecha posterior al 18 de diciembre de 2026 antes del cierre. Resolver No si la fecha oficial sigue siendo el 18 de diciembre de 2026 al cierre.',
    evidence: [
      {
        title: 'Marvel · Avengers: Doomsday',
        url: 'https://www.marvel.com/movies/avengers-doomsday',
      },
    ],
    tags: {
      categoryTags: ['musica'],
      geoTags: ['world'],
      topicTags: ['cine'],
    },
  },
  {
    kind: 'popular_event',
    key: 'fed-raises-september-2026',
    topic: 'fed',
    question: '¿La Fed sube la tasa en la reunión del 16 de septiembre de 2026?',
    category: 'finanzas',
    icon: '🏦',
    resolveAt: '2026-09-16T19:30:00Z',
    probabilityYes: 48,
    criteria: 'Resolver Sí si el comunicado del FOMC del 16 de septiembre de 2026 aumenta el rango objetivo de la tasa de fondos federales frente al rango vigente antes de la reunión. Resolver No si mantiene o baja el rango.',
    evidence: [
      {
        title: 'Federal Reserve · 2026 FOMC calendars',
        url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
      },
      {
        title: 'Federal Reserve · September 2026 calendar',
        url: 'https://www.federalreserve.gov/newsevents/2026-september.htm',
      },
    ],
    tags: {
      categoryTags: ['finanzas'],
      geoTags: ['world'],
      topicTags: ['finanzas'],
    },
  },
  {
    kind: 'popular_event',
    key: 'spiderman-brand-new-day-2b-2026',
    topic: 'cine',
    movie: 'Spider-Man: Brand New Day',
    franchise: 'Spider-Man',
    question: '¿Spider-Man: Brand New Day supera $2,000MDD de taquilla mundial antes de septiembre?',
    category: 'musica',
    icon: '🕷️',
    resolveAt: '2026-09-01T06:00:00Z',
    probabilityYes: 62,
    criteria: 'Resolver Sí si Box Office Mojo, The Numbers o un reporte de AP/Variety/Deadline muestra que Spider-Man: Brand New Day alcanzó al menos $2,000 millones de dólares de taquilla mundial antes del 1 de septiembre de 2026. Resolver No si no hay una fuente creíble que lo confirme antes del cierre.',
    evidence: [
      {
        title: 'AP · Spider-Man: Brand New Day keeps record pace',
        url: 'https://apnews.com/article/4fe684597b2d272bbe45db9f78089a24',
        publishedAt: '2026-08-10',
      },
      {
        title: 'The Numbers · Spider-Man franchise box office history',
        url: 'https://www.the-numbers.com/movies/franchise/Spider-Man',
      },
    ],
    tags: {
      categoryTags: ['musica'],
      geoTags: ['world'],
      topicTags: ['cine'],
    },
  },
  {
    kind: 'popular_event',
    key: 'infantino-resigns-september-2026',
    topic: 'fifa',
    question: '¿Gianni Infantino renuncia como presidente de FIFA antes de octubre de 2026?',
    category: 'deportes',
    icon: '⚽',
    resolveAt: '2026-10-01T06:00:00Z',
    probabilityYes: 18,
    criteria: 'Resolver Sí si FIFA anuncia oficialmente antes del cierre que Gianni Infantino renunció o dejará el cargo de presidente antes de terminar su mandato actual. Resolver No si no existe anuncio oficial de renuncia antes del cierre.',
    evidence: [
      {
        title: 'AP · Infantino gets internal support at crisis meeting',
        url: 'https://apnews.com/article/98cacb47356cb365346ae998d1d38c49',
        publishedAt: '2026-08-06',
      },
      {
        title: 'FIFA · Infantino says he will stand for re-election in 2027',
        url: 'https://inside.fifa.com/organisation/president/news/gianni-infantino-president-reelection-2027-congress-vancouver',
        publishedAt: '2026-05-01',
      },
    ],
    tags: {
      categoryTags: ['deportes'],
      geoTags: ['world'],
      topicTags: ['deportes'],
    },
  },
];
