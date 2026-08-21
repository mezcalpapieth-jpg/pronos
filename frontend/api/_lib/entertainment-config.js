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
 *           category?, topic?, outcomes?, probabilities?, probabilityYes?, criteria, evidence?,
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
    key: 'd23-2026-mcu-magneto',
    topic: 'cine',
    eventLabel: 'D23 2026 · Disney Entertainment Showcase',
    question: '¿Quién será anunciado como Magneto en el reboot de X-Men del MCU durante D23 2026?',
    category: 'musica',
    icon: '🎬',
    outcomes: ['Robert Pattinson', 'Adam Driver', 'Otro actor', 'No anuncian a Magneto'],
    probabilities: [22, 13, 20, 45],
    resolveAt: '2026-08-15T01:55:00Z',
    criteria: 'Resolver después del Disney Entertainment Showcase de D23 2026. Robert Pattinson o Adam Driver ganan si Disney, Marvel Studios, D23 o un trade principal (Variety, Deadline o The Hollywood Reporter) confirma a ese actor como Magneto/Erik Lensherr para el reboot de X-Men del MCU. Otro actor gana si se confirma oficialmente a otro actor. No anuncian a Magneto gana si no hay confirmación oficial o de trade principal durante D23 2026. Rumores, fan-casts, "in talks" o "eyed" no cuentan.',
    evidence: [
      {
        title: 'D23 · The Ultimate Disney Fan Event 2026',
        url: 'https://d23.com/ultimatefanevent2026-copy/',
      },
      {
        title: 'D23 · All-Day Programming Lineup Announced for D23 2026',
        url: 'https://d23.com/all-day-programming-lineup-announced-for-d23-the-ultimate-disney-fan-event-2026/',
        publishedAt: '2026-07-13',
      },
      {
        title: 'Marvel · Movies',
        url: 'https://www.marvel.com/movies',
      },
      {
        title: 'Variety · Marvel',
        url: 'https://variety.com/t/marvel/',
      },
      {
        title: 'Deadline · Marvel',
        url: 'https://deadline.com/tag/marvel/',
      },
      {
        title: 'The Hollywood Reporter · Marvel',
        url: 'https://www.hollywoodreporter.com/t/marvel/',
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
  // ─── Taquilla China · 牛来 (Niu Lai) ─────────────────────────────────
  // Escalera de 12 rangos de $1M USD sobre el 综合票房 acumulado — la
  // taquilla bruta, con cargo por servicio — que publica el dashboard
  // de 猫眼专业版. Ancla al generar: 3691.1万 = ¥36.91M = $5.49M el
  // 21/08/2026 06:15 hora de Pekín, día 18 en cartelera.
  //
  // Tipo de cambio CONGELADO en 6.7220 CNY/USD al crear el mercado. No
  // se vuelve a consultar al cierre: esto es un mercado de taquilla, no
  // de divisas, y un rate flotante metería una segunda fuente que
  // disputar. Los criterios cargan la tabla de fronteras ya convertida
  // a 万 para que resolver no requiera ninguna cuenta.
  //
  // Escalón de $1M por decisión explícita del admin. A 6.72 cada
  // escalón vale ¥6.72M, así que el peso real se concentra en las dos
  // primeras casillas: la frontera de $6.5M cae en 4369.3万 y el
  // consenso al crear el mercado ronda 4200–4500万. De la casilla 4 en
  // adelante la película tendría que sumar en tres días más de lo que
  // lleva en dieciocho.
  //
  // Resolución MANUAL a propósito: la API de Maoyan devuelve 403 sin su
  // signKey/uuid y la ficha por película exige login, así que no hay
  // fetch server-side posible. El admin lee el acumulado en el
  // dashboard público a la hora de cierre y guarda evidencia.
  //
  // amm_mode parallel (no unified): 12 legs Sí/No. PronosAMMMulti topa
  // en MAX_OUTCOMES=8, así que un unified de 12 no se podría desplegar
  // on-chain (ver onchain-trader.js).
  {
    kind: 'popular_event',
    key: 'niulai-box-office-2026-08-23',
    topic: 'cine',
    movie: '牛来 (Niu Lai)',
    eventLabel: 'Taquilla China · 牛来',
    question: '¿Cuánto acumulará 牛来 (Niu Lai) en taquilla china (USD) al cierre del domingo 23 de agosto?',
    category: 'musica',
    icon: '🎬',
    ammMode: 'parallel',
    outcomes: [
      'Menos de $6.5M',
      '$6.5M – $7.5M',
      '$7.5M – $8.5M',
      '$8.5M – $9.5M',
      '$9.5M – $10.5M',
      '$10.5M – $11.5M',
      '$11.5M – $12.5M',
      '$12.5M – $13.5M',
      '$13.5M – $14.5M',
      '$14.5M – $15.5M',
      '$15.5M – $16.5M',
      '$16.5M o más',
    ],
    probabilities: [0.52, 0.32, 0.08, 0.03, 0.015, 0.01, 0.007, 0.005, 0.004, 0.003, 0.003, 0.003],
    resolveAt: '2026-08-24T03:00:00Z',
    criteria: 'Todos los rangos están en dólares (USD), convertidos desde yuanes (RMB) con un tipo de cambio FIJO de 6.7220 CNY por USD, congelado el 21 de agosto de 2026 (fuentes: BCE vía frankfurter.dev en 6.7206 y currency-api en 6.7224). El tipo de cambio NO se vuelve a consultar al cierre: este mercado es sobre taquilla, no sobre divisas. Procedimiento: leer el 综合票房 acumulado (taquilla bruta, incluye cargo por servicio) de la película 牛来, movieId 1455644, en el dashboard público de 猫眼专业版 en https://piaofang.maoyan.com/dashboard el domingo 23 de agosto de 2026 a las 21:00 hora CDMX, equivalente a lunes 24 de agosto a las 11:00 hora de Pekín. Gana la opción cuyo rango contenga ese valor, con límite inferior inclusivo y superior exclusivo. Tabla de equivalencia ya calculada, para resolver sin hacer ninguna cuenta comparando directamente contra el número que muestra el dashboard: Menos de $6.5M = menos de 4369.3万; $6.5M–$7.5M = 4369.3万 a 5041.5万; $7.5M–$8.5M = 5041.5万 a 5713.7万; $8.5M–$9.5M = 5713.7万 a 6385.9万; $9.5M–$10.5M = 6385.9万 a 7058.1万; $10.5M–$11.5M = 7058.1万 a 7730.3万; $11.5M–$12.5M = 7730.3万 a 8402.5万; $12.5M–$13.5M = 8402.5万 a 9074.7万; $13.5M–$14.5M = 9074.7万 a 9746.9万; $14.5M–$15.5M = 9746.9万 a 10419.1万; $15.5M–$16.5M = 10419.1万 a 11091.3万; $16.5M o más = 11091.3万 en adelante. Las doce fronteras caen en valores que el dashboard puede reportar exactamente, así que la regla de límite inferior inclusivo decide en cada una: un acumulado de exactamente 4369.3万 pertenece a $6.5M–$7.5M, no a la opción anterior. OJO con las unidades: el dashboard cambia de 万 a 亿 al cruzar 1亿, que son 10000万, y ahí muestra por ejemplo 1.04亿, que equivale a 10400万; hay que convertir antes de comparar, y eso solo aplica a las últimas tres opciones. NO usar el 分账票房 (taquilla neta repartible), que es alrededor de 15% menor y aparece en el otro tab del mismo dashboard. Si la película ya no aparece en el listado al momento del cierre, resolver con el último valor acumulado observado. La lectura es manual: el admin debe guardar captura de pantalla del dashboard y la hora de Pekín visible como evidencia. Valor de referencia al generar el mercado: 3691.1万 = ¥36.91M = $5.49M el 21/08/2026 a las 06:15 hora de Pekín, con 18 días en cartelera.',
    evidence: [
      {
        title: '猫眼专业版 · 实时票房 (dashboard público, taquilla en vivo)',
        url: 'https://piaofang.maoyan.com/dashboard',
      },
    ],
    tags: {
      categoryTags: ['musica'],
      geoTags: ['world'],
      topicTags: ['cine'],
    },
  },
];
