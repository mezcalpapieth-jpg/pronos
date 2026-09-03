/**
 * Demo market set — the markets shown while demo mode is on.
 *
 * Separate from lib/markets.js for one reason: deadlines here are computed
 * forward from *today*, so the grid is never empty and never shows a date in
 * the past, whenever the demo is given. Titles avoid hard dates for the same
 * reason. Same shape as lib/markets.js, so every component renders it as-is.
 *
 * All numbers are illustrative — this set never touches Polymarket or chain.
 */

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// "3 Dic 2026" — the format lib/deadline.js parses.
function inDays(n) {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
}

const YES_NO_EN = [{ label: 'Yes' }, { label: 'No' }];

const DEMO_MARKETS = [

  // ── Deportes ──────────────────────────────────────────────────────────────
  {
    id: 'demo-liga-mx-final', category: 'deportes', categoryLabel: 'DEPORTES · LIGA MX', icon: '⚽',
    title: '¿Quién gana la final del Apertura?',
    title_en: 'Who wins the Apertura final?',
    deadline: inDays(75),
    options: [{ label: 'América', pct: 41 }, { label: 'Monterrey', pct: 34 }, { label: 'Otro', pct: 25 }],
    options_en: [{ label: 'América' }, { label: 'Monterrey' }, { label: 'Other' }],
    volume: '4.12M', _source: 'local', trending: true,
  },
  {
    id: 'demo-checo-podio', category: 'deportes', categoryLabel: 'DEPORTES · F1', icon: '🏎️',
    title: '¿Checo Pérez sube al podio en la próxima carrera?',
    title_en: 'Will Checo Pérez podium in the next race?',
    deadline: inDays(21),
    options: [{ label: 'Sí', pct: 27 }, { label: 'No', pct: 73 }],
    options_en: YES_NO_EN, volume: '2.86M', _source: 'local', trending: true,
  },
  {
    id: 'demo-canelo-pelea', category: 'deportes', categoryLabel: 'DEPORTES · BOX', icon: '🥊',
    title: '¿Canelo anuncia nueva pelea antes de fin de año?',
    title_en: 'Will Canelo announce a new fight before year end?',
    deadline: inDays(110),
    options: [{ label: 'Sí', pct: 68 }, { label: 'No', pct: 32 }],
    options_en: YES_NO_EN, volume: '1.94M', _source: 'local',
  },
  {
    id: 'demo-nba-mvp', category: 'deportes', categoryLabel: 'DEPORTES · NBA', icon: '🏀',
    title: '¿Gana un jugador del Oeste el MVP esta temporada?',
    title_en: 'Will a Western Conference player win MVP this season?',
    deadline: inDays(260),
    options: [{ label: 'Sí', pct: 64 }, { label: 'No', pct: 36 }],
    options_en: YES_NO_EN, volume: '3.31M', _source: 'local',
  },

  // ── México ────────────────────────────────────────────────────────────────
  {
    id: 'demo-sismo-cdmx', category: 'mexico', categoryLabel: 'MÉXICO & CDMX', icon: '🌎',
    title: '¿Sismo mayor a 5.0 en CDMX en los próximos 90 días?',
    title_en: 'Earthquake above 5.0 in Mexico City within 90 days?',
    deadline: inDays(90),
    options: [{ label: 'Sí', pct: 58 }, { label: 'No', pct: 42 }],
    options_en: YES_NO_EN, volume: '2.47M', _source: 'local', trending: true,
  },
  {
    id: 'demo-tren-maya', category: 'mexico', categoryLabel: 'MÉXICO & CDMX', icon: '🚂',
    title: '¿El Tren Maya supera un millón de pasajeros este trimestre?',
    title_en: 'Will Tren Maya top one million passengers this quarter?',
    deadline: inDays(65),
    options: [{ label: 'Sí', pct: 36 }, { label: 'No', pct: 64 }],
    options_en: YES_NO_EN, volume: '910K', _source: 'local',
  },
  {
    id: 'demo-mundial-sede-cdmx', category: 'mexico', categoryLabel: 'MÉXICO & CDMX', icon: '🏟️',
    title: '¿CDMX anuncia otro evento internacional en el Estadio Azteca este año?',
    title_en: 'Will Mexico City announce another international event at Estadio Azteca this year?',
    deadline: inDays(120),
    options: [{ label: 'Sí', pct: 49 }, { label: 'No', pct: 51 }],
    options_en: YES_NO_EN, volume: '640K', _source: 'local',
  },

  // ── Política ──────────────────────────────────────────────────────────────
  {
    id: 'demo-aprobacion-presidencial', category: 'politica', categoryLabel: 'POLÍTICA · MÉXICO', icon: '🇲🇽',
    title: '¿La aprobación presidencial cierra el año arriba de 60%?',
    title_en: 'Will presidential approval end the year above 60%?',
    deadline: inDays(115),
    options: [{ label: 'Sí', pct: 62 }, { label: 'No', pct: 38 }],
    options_en: YES_NO_EN, volume: '1.58M', _source: 'local', trending: true,
  },
  {
    id: 'demo-aranceles-eeuu', category: 'politica', categoryLabel: 'POLÍTICA INTERNACIONAL', icon: '🇺🇸',
    title: '¿EE.UU. anuncia nuevos aranceles a México antes de fin de año?',
    title_en: 'Will the US announce new tariffs on Mexico before year end?',
    deadline: inDays(115),
    options: [{ label: 'Sí', pct: 44 }, { label: 'No', pct: 56 }],
    options_en: YES_NO_EN, volume: '2.05M', _source: 'local',
  },
  {
    id: 'demo-venezuela-elecciones', category: 'politica', categoryLabel: 'POLÍTICA INTERNACIONAL', icon: '🗳️',
    title: '¿Venezuela celebra elecciones reconocidas por la OEA en los próximos 12 meses?',
    title_en: 'Will Venezuela hold OAS-recognized elections in the next 12 months?',
    deadline: inDays(365),
    options: [{ label: 'Sí', pct: 9 }, { label: 'No', pct: 91 }],
    options_en: YES_NO_EN, volume: '780K', _source: 'local',
  },

  // ── Finanzas ──────────────────────────────────────────────────────────────
  {
    id: 'demo-banxico-tasa', category: 'finanzas', categoryLabel: 'FINANZAS · BANXICO', icon: '🏦',
    title: '¿Banxico baja la tasa en su próxima reunión?',
    title_en: 'Will Banxico cut rates at its next meeting?',
    deadline: inDays(38),
    options: [{ label: 'Sí', pct: 73 }, { label: 'No', pct: 27 }],
    options_en: YES_NO_EN, volume: '5.22M', _source: 'local', trending: true,
  },
  {
    id: 'demo-dolar-peso', category: 'finanzas', categoryLabel: 'FINANZAS · FX', icon: '💵',
    title: '¿El dólar cierra el año arriba de $20 MXN?',
    title_en: 'Will USD close the year above $20 MXN?',
    deadline: inDays(115),
    options: [{ label: 'Sí', pct: 55 }, { label: 'No', pct: 45 }],
    options_en: YES_NO_EN, volume: '6.84M', _source: 'local',
  },
  {
    id: 'demo-bmv', category: 'finanzas', categoryLabel: 'FINANZAS · BMV', icon: '📈',
    title: '¿La BMV cierra el año arriba de los 60,000 puntos?',
    title_en: 'Will the Mexican Stock Exchange close the year above 60,000?',
    deadline: inDays(115),
    options: [{ label: 'Sí', pct: 47 }, { label: 'No', pct: 53 }],
    options_en: YES_NO_EN, volume: '1.36M', _source: 'local',
  },

  // ── Crypto ────────────────────────────────────────────────────────────────
  {
    id: 'demo-btc-150k', category: 'crypto', categoryLabel: 'CRYPTO · BITCOIN', icon: '₿',
    title: '¿Bitcoin supera los $150,000 USD antes de fin de año?',
    title_en: 'Will Bitcoin top $150,000 USD before year end?',
    deadline: inDays(115),
    options: [{ label: 'Sí', pct: 51 }, { label: 'No', pct: 49 }],
    options_en: YES_NO_EN, volume: '18.4M', _source: 'local', trending: true,
  },
  {
    id: 'demo-eth-6k', category: 'crypto', categoryLabel: 'CRYPTO · ETHEREUM', icon: '⟠',
    title: '¿Ethereum supera los $6,000 USD en los próximos 6 meses?',
    title_en: 'Will Ethereum top $6,000 USD in the next 6 months?',
    deadline: inDays(180),
    options: [{ label: 'Sí', pct: 33 }, { label: 'No', pct: 67 }],
    options_en: YES_NO_EN, volume: '7.15M', _source: 'local',
  },
  {
    id: 'demo-stablecoins-mx', category: 'crypto', categoryLabel: 'CRYPTO · LATAM', icon: '🪙',
    title: '¿El volumen de stablecoins en México crece más de 50% este año?',
    title_en: 'Will stablecoin volume in Mexico grow more than 50% this year?',
    deadline: inDays(115),
    options: [{ label: 'Sí', pct: 71 }, { label: 'No', pct: 29 }],
    options_en: YES_NO_EN, volume: '2.93M', _source: 'local',
  },

  // ── Música & farándula ────────────────────────────────────────────────────
  {
    id: 'demo-bad-bunny-gira', category: 'musica', categoryLabel: 'MÚSICA & FARÁNDULA', icon: '🎵',
    title: '¿Bad Bunny anuncia fechas en México antes de fin de año?',
    title_en: 'Will Bad Bunny announce Mexico dates before year end?',
    deadline: inDays(115),
    options: [{ label: 'Sí', pct: 59 }, { label: 'No', pct: 41 }],
    options_en: YES_NO_EN, volume: '3.77M', _source: 'local',
  },
  {
    id: 'demo-corridos-colab', category: 'musica', categoryLabel: 'MÚSICA & FARÁNDULA', icon: '🎤',
    title: '¿Peso Pluma y Nodal lanzan una colaboración en los próximos 6 meses?',
    title_en: 'Will Peso Pluma and Nodal drop a collab in the next 6 months?',
    deadline: inDays(180),
    options: [{ label: 'Sí', pct: 23 }, { label: 'No', pct: 77 }],
    options_en: YES_NO_EN, volume: '1.42M', _source: 'local',
  },

  // ── Resuelto ──────────────────────────────────────────────────────────────
  // Kept from lib/markets.js so the "Resueltos" tab has a real settled market
  // to show, with a real result rather than an invented one.
  {
    id: 'marco-verde-vs-alexander-moreno-mar-2026',
    category: 'deportes', categoryLabel: 'DEPORTES · BOX', icon: '🥊',
    title: '¿Marco Verde gana vs Alexander Moreno?',
    title_en: 'Will Marco Verde beat Alexander Moreno?',
    deadline: '14 Mar 2026',
    options: [{ label: 'Sí — Marco Verde', pct: 82 }, { label: 'No — Alexander Moreno', pct: 18 }],
    options_en: [{ label: 'Yes — Marco Verde' }, { label: 'No — Alexander Moreno' }],
    volume: '84K', _source: 'local',
    _resolved: true,
    _winner: 'Sí — Marco Verde',
    _winnerShort: 'Marco Verde',
    _resolvedDate: '14 Mar 2026',
    _resolvedBy: 'Decisión Unánime · 80–72',
    _description: 'Marco Verde (5-0, 4 KOs) venció a Alexander Moreno por decisión unánime en CODE Alcalde, Guadalajara. Los tres jueces marcaron 80-72 a favor del tapatío. Verde controló el combate a las 162 libras durante los 8 rounds.',
  },
];

export default DEMO_MARKETS;
