/**
 * Seed data for the video-recording demo (/points/video).
 *
 * Everything here is invented. It exists so a videographer can record a
 * full-looking Pronos without touching the database.
 *
 * Why invented and not a copy of production: production currently holds
 * four live markets — two Bitcoin 5-minute ticks plus two México markets —
 * and a resolved history that is 100% crypto ticks, with no market anywhere
 * above 1000 MXNP of volume. Inflating that snapshot would have produced a
 * hundred identical Bitcoin rows. So the questions below are written fresh,
 * but the object shape is cloned field-for-field from the real
 * GET /api/points/markets response so the UI renders them identically.
 *
 * Two of the four real production markets are kept verbatim (the alerta
 * sísmica and inflación ones) so the set is anchored to something true.
 */

// Binary CPMM pricing is pYes = r1 / (r0 + r1) — see binaryPrices() in
// api/_lib/amm-math.js. Inverting it for a target probability with a chosen
// pool depth: r1 = p·T, r0 = (1−p)·T. Multi-outcome unified pools use the
// factor trick instead, p_i = (1/r_i) / Σ(1/r_k), which inverts to r_i = k/p_i.
export function reservesForProbabilities(probs, depth = 2000) {
  const clean = probs.map(p => Math.max(0.01, Math.min(0.99, Number(p) || 0)));
  const total = clean.reduce((s, p) => s + p, 0) || 1;
  const normalized = clean.map(p => p / total);

  if (normalized.length === 2) {
    return [normalized[1] * depth, normalized[0] * depth];
  }
  return normalized.map(p => depth / p / normalized.length);
}

export function pricesFromReserves(reserves) {
  if (!Array.isArray(reserves) || reserves.length === 0) return [0.5, 0.5];
  if (reserves.length === 2) {
    const total = Number(reserves[0]) + Number(reserves[1]);
    if (!total) return [0.5, 0.5];
    const yes = Number(reserves[1]) / total;
    return [yes, 1 - yes];
  }
  const invs = reserves.map(r => (Number(r) > 0 ? 1 / Number(r) : 0));
  const sum = invs.reduce((s, v) => s + v, 0) || 1;
  return invs.map(v => v / sum);
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Compact specs. `volume` is the total the market card should read — the card
 * renders volume + tradeVolume, so the builder splits it across both fields
 * and the detail page's tradeVolume-only line stays in the same ballpark.
 */
const MARKET_SPECS = [
  {
    question: '¿Ganará el América el Clausura 2026?',
    category: 'deportes', outcomes: ['Sí', 'No'], probs: [0.62, 0.38],
    volume: 2_450_000, endsInDays: 47, featured: true, trending: true,
    sport: 'soccer', league: 'liga-mx', topicTags: ['deportes'],
  },
  {
    question: 'Clásico Nacional: ¿quién gana América vs Chivas?',
    category: 'deportes', outcomes: ['América', 'Empate', 'Chivas'], probs: [0.48, 0.27, 0.25],
    volume: 1_890_000, endsInDays: 6, featured: true, trending: true,
    sport: 'soccer', league: 'liga-mx', topicTags: ['deportes'],
  },
  {
    question: '¿Llegará México a cuartos de final en el Mundial 2026?',
    category: 'world-cup', outcomes: ['Sí', 'No'], probs: [0.41, 0.59],
    volume: 3_120_000, endsInDays: 120, featured: true, trending: true,
    sport: 'soccer', league: 'world-cup', topicTags: ['world-cup', 'deportes'],
  },
  {
    question: '¿En qué rango cerrará el dólar frente al peso en diciembre?',
    category: 'finanzas', outcomes: ['Menos de $17', '$17 – $18.50', 'Más de $18.50'],
    probs: [0.22, 0.54, 0.24],
    volume: 1_240_000, endsInDays: 82, featured: true, trending: false,
    topicTags: ['finanzas'],
  },
  {
    question: '¿Bajará Banxico la tasa de interés en su próxima reunión?',
    category: 'finanzas', outcomes: ['Sí', 'No'], probs: [0.71, 0.29],
    volume: 860_000, endsInDays: 24, featured: false, trending: true,
    topicTags: ['finanzas'],
  },
  {
    question: '¿Bitcoin cerrará el año arriba de 100 mil dólares?',
    category: 'crypto', outcomes: ['Sí', 'No'], probs: [0.57, 0.43],
    volume: 2_780_000, endsInDays: 144, featured: true, trending: true,
    topicTags: ['crypto'],
  },
  {
    question: '¿Ganará Canelo su próxima pelea por nocaut?',
    category: 'deportes', outcomes: ['Sí', 'No'], probs: [0.44, 0.56],
    volume: 1_560_000, endsInDays: 38, featured: true, trending: true,
    sport: 'boxing', topicTags: ['deportes'],
  },
  {
    question: '¿Terminará Checo Pérez la temporada en el top 5?',
    category: 'deportes', outcomes: ['Sí', 'No'], probs: [0.35, 0.65],
    volume: 720_000, endsInDays: 96, featured: false, trending: true,
    sport: 'f1', topicTags: ['deportes'],
  },
  {
    question: '¿Superará la Selección Mexicana los 3 goles en su próximo partido?',
    category: 'deportes', outcomes: ['Sí', 'No'], probs: [0.28, 0.72],
    volume: 495_000, endsInDays: 11, featured: false, trending: true,
    sport: 'soccer', topicTags: ['deportes'],
  },
  {
    question: '¿Quién ganará la Champions League?',
    category: 'deportes', outcomes: ['Real Madrid', 'Manchester City', 'Bayern', 'Otro'],
    probs: [0.31, 0.27, 0.18, 0.24],
    volume: 1_980_000, endsInDays: 74, featured: true, trending: false,
    sport: 'soccer', league: 'uefa-cl', topicTags: ['deportes'],
  },
  {
    question: '¿Superará la aprobación presidencial el 60% en la próxima encuesta?',
    category: 'politica', outcomes: ['Sí', 'No'], probs: [0.66, 0.34],
    volume: 1_120_000, endsInDays: 29, featured: false, trending: true,
    topicTags: ['politica'],
  },
  {
    question: '¿Habrá acuerdo comercial con Estados Unidos antes de junio?',
    category: 'politica', outcomes: ['Sí', 'No'], probs: [0.39, 0.61],
    volume: 640_000, endsInDays: 61, featured: false, trending: false,
    topicTags: ['politica'],
  },
  {
    question: '¿Será mexicana la canción más escuchada del año en Spotify México?',
    category: 'musica', outcomes: ['Sí', 'No'], probs: [0.73, 0.27],
    volume: 385_000, endsInDays: 133, featured: false, trending: true,
    topicTags: ['musica'],
  },
  {
    question: '¿Anunciará Bad Bunny fecha en el Estadio GNP este año?',
    category: 'musica', outcomes: ['Sí', 'No'], probs: [0.52, 0.48],
    volume: 910_000, endsInDays: 55, featured: true, trending: true,
    topicTags: ['musica', 'farandula'],
  },
  {
    question: '¿Ganará una película mexicana algún premio en Cannes?',
    category: 'general', outcomes: ['Sí', 'No'], probs: [0.31, 0.69],
    volume: 268_000, endsInDays: 88, featured: false, trending: false,
    topicTags: ['cine'],
  },
  {
    question: '¿Lloverá en la Ciudad de México el día del desfile?',
    category: 'mexico', outcomes: ['Sí', 'No'], probs: [0.58, 0.42],
    volume: 174_000, endsInDays: 19, featured: false, trending: false,
    topicTags: ['weather'],
  },
  {
    question: '¿Superará el Metro de la CDMX los 5 millones de viajes en un día?',
    category: 'mexico', outcomes: ['Sí', 'No'], probs: [0.46, 0.54],
    volume: 232_000, endsInDays: 42, featured: false, trending: false,
    topicTags: ['general'],
  },
  {
    question: '¿Cuántos goles meterá la Liga MX esta jornada?',
    category: 'deportes', outcomes: ['Menos de 20', '20 – 29', '30 o más'],
    probs: [0.19, 0.53, 0.28],
    volume: 588_000, endsInDays: 4, featured: false, trending: true,
    sport: 'soccer', league: 'liga-mx', topicTags: ['deportes'],
  },
  {
    question: '¿Ethereum superará los 5 mil dólares antes de que acabe el trimestre?',
    category: 'crypto', outcomes: ['Sí', 'No'], probs: [0.33, 0.67],
    volume: 1_340_000, endsInDays: 67, featured: false, trending: true,
    topicTags: ['crypto'],
  },
  {
    question: '¿Se estrenará la segunda temporada antes de septiembre?',
    category: 'general', outcomes: ['Sí', 'No'], probs: [0.64, 0.36],
    volume: 156_000, endsInDays: 51, featured: false, trending: false,
    topicTags: ['tv'],
  },
  // ── The two real production markets, kept verbatim ────────────────────────
  {
    question: 'Se activará la alerta sísmica en la Ciudad de México durante el mes de septiembre de 2026?',
    category: 'mexico', outcomes: ['Sí', 'No'], probs: [0.89, 0.11],
    volume: 412_000, endsInDays: 52, featured: false, trending: false,
    topicTags: ['general'],
  },
  {
    question: '¿En qué rango cerrará la inflación anual de México en 2026?',
    category: 'mexico', outcomes: ['Menos de 3.5%', '3.5% – 4.5%', 'Más de 4.5%'],
    probs: [0.26, 0.49, 0.25],
    volume: 534_000, endsInDays: 143, featured: false, trending: false,
    topicTags: ['finanzas'],
  },
];

const FIRST_DEMO_MARKET_ID = 900_001;

function buildMarket(spec, index, now) {
  const id = FIRST_DEMO_MARKET_ID + index;
  const depth = Math.max(500, Math.round(spec.volume / 900));
  const reserves = reservesForProbabilities(spec.probs, depth);
  const prices = pricesFromReserves(reserves);

  // The card sums volume + tradeVolume; the detail page shows tradeVolume
  // alone. Splitting the target across both keeps the two screens within a
  // believable distance of each other instead of one reading 8x the other.
  const seedLiquidity = Math.round(spec.volume * 0.35);
  const tradeVolume = spec.volume - seedLiquidity;

  return {
    id,
    ammMode: 'unified',
    question: spec.question,
    category: spec.category,
    icon: null,
    outcomes: spec.outcomes,
    reserves,
    prices,
    seedLiquidity,
    volume: seedLiquidity,
    tradeVolume,
    lastTradeAt: new Date(now - Math.round(Math.random() * 90) * 60 * 1000).toISOString(),
    startTime: null,
    endTime: new Date(now + spec.endsInDays * DAY).toISOString(),
    live: false,
    featured: !!spec.featured,
    trending: !!spec.trending,
    crypto5min: false,
    cryptoIntervalMinutes: null,
    cryptoWindowMinutes: null,
    status: 'active',
    outcome: null,
    resolvedAt: null,
    finalScore: null,
    seriesMeta: null,
    createdAt: new Date(now - (30 + index) * DAY).toISOString(),
    source: null,
    sourceEventId: null,
    resolverType: null,
    resolverSource: null,
    resolverConfig: null,
    liveScoreConfig: null,
    cryptoMeta: null,
    sport: spec.sport || null,
    league: spec.league || null,
    categoryTags: [spec.category],
    geoTags: spec.geoTags || ['mexico'],
    topicTags: spec.topicTags || ['general'],
    outcomeImages: null,
    outcomeCountryLabels: null,
    mode: 'points',
    chainId: null,
    chainMarketId: null,
    chainAddress: null,
    archivedAt: null,
  };
}

/**
 * Leaderboard names. Deliberately handle-shaped rather than real-person
 * names — this ends up on camera, and no invented row should read as a
 * specific identifiable person.
 */
const LEADERBOARD_HANDLES = [
  'elmatador', 'chaparrita22', 'norteno_mx', 'pumafan98', 'laloco',
  'tijuanakid', 'sonora7', 'doncangrejo', 'chilangaboss', 'vikingo_gdl',
  'monterrey_x', 'lachikis', 'tepito99', 'oaxacastyle', 'brujo_mx',
  'quinceletras', 'pescadito', 'cometa44', 'lamera_mera', 'chamuco',
];

export const DEMO_USERNAME = 'fabian';

function buildLeaderboard(now) {
  const rows = LEADERBOARD_HANDLES.map((username, i) => {
    const score = Math.round(4200 - i * 145 + (Math.random() - 0.5) * 90);
    return {
      username,
      createdAt: new Date(now - (60 + i) * DAY).toISOString(),
      balance: Math.round(500 + Math.max(0, score) * 0.8),
      score,
      cycleDelta: score,
      marketPnl: score,
      currentPositionValue: Math.round(Math.max(0, score) * 0.4),
      inactivityPenalty: 0,
      inactiveDays: 0,
      activeDays: 12 + (i % 3),
      qualifyingMarkets: 10 + (i % 5),
      qualified: true,
      totalActions: 40 - i,
      buyCount: 30 - i,
      rank: 0,
    };
  });

  // Drop the recording account into the middle of the pack so there is room
  // to climb on camera.
  rows.push({
    username: DEMO_USERNAME,
    createdAt: new Date(now - 20 * DAY).toISOString(),
    balance: 2500,
    score: 2260,
    cycleDelta: 2260,
    marketPnl: 2260,
    currentPositionValue: 900,
    inactivityPenalty: 0,
    inactiveDays: 0,
    activeDays: 13,
    qualifyingMarkets: 12,
    qualified: true,
    totalActions: 34,
    buyCount: 26,
    rank: 0,
  });

  return rankLeaderboard(rows);
}

export function rankLeaderboard(rows) {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  sorted.forEach((row, i) => { row.rank = i + 1; });
  return sorted;
}

const DAYS_OF_TRADING_HISTORY = 21;

/**
 * Gives the demo account a portfolio it already holds.
 *
 * Signing in to an empty portfolio, an empty history and a flat P&L chart is
 * the fastest way to make a working product look unfinished — three of the
 * screens most likely to get clicked during a demo would be blank. So the
 * account arrives mid-story: a handful of open positions, most of them up,
 * and three weeks of trades behind them for the history tab and P&L curve to
 * be built from.
 *
 * Positions are entered at a price below the current one so the portfolio
 * opens showing a gain — the demo should show the product working, and a
 * losing book invites a conversation about risk rather than about Pronos.
 */
export function buildStartingPortfolio(markets, now = Date.now()) {
  const tradable = markets.filter(m => m.status === 'active' && m.outcomes.length >= 2);
  const positions = [];
  const userTrades = [];
  if (tradable.length === 0) return { positions, userTrades };

  // Spread across the board rather than the first N, so the portfolio isn't
  // six variations of the same category.
  const step = Math.max(1, Math.floor(tradable.length / 7));
  for (let i = 0; i < 7 && i * step < tradable.length; i += 1) {
    const market = tradable[i * step];
    const outcomeIndex = i % market.outcomes.length;
    const price = Number(market.prices?.[outcomeIndex] ?? 0.5);

    const collateral = [250, 500, 300, 800, 150, 450, 600][i];
    // Entered 6-18% below the current price, so the position shows a gain.
    const entryPrice = Math.max(0.02, price * (0.82 + (i % 4) * 0.04));
    const shares = Number((collateral / entryPrice).toFixed(2));
    const createdAt = new Date(now - (2 + i * 2.5) * 24 * 60 * 60 * 1000).toISOString();

    positions.push({ marketId: market.id, outcomeIndex, shares, costBasis: collateral });
    userTrades.push({
      marketId: market.id,
      outcomeIndex,
      side: 'buy',
      shares,
      collateral,
      price: entryPrice,
      createdAt,
    });
  }

  // A few closed round-trips so the history tab has settled rows and the P&L
  // curve has realised steps rather than being pure mark-to-market drift.
  for (let i = 0; i < 5; i += 1) {
    const market = tradable[(i * step + 3) % tradable.length];
    const outcomeIndex = i % market.outcomes.length;
    const price = Number(market.prices?.[outcomeIndex] ?? 0.5);
    const entryPrice = Math.max(0.02, price * 0.88);
    const collateral = [200, 350, 500, 275, 400][i];
    const shares = Number((collateral / entryPrice).toFixed(2));
    const openedAt = now - (DAYS_OF_TRADING_HISTORY - i * 2) * 24 * 60 * 60 * 1000;

    userTrades.push({
      marketId: market.id, outcomeIndex, side: 'buy', shares, collateral,
      price: entryPrice, createdAt: new Date(openedAt).toISOString(),
    });
    // Closed a day or two later, up ~14%.
    userTrades.push({
      marketId: market.id,
      outcomeIndex,
      side: 'sell',
      shares,
      collateral: Number((collateral * 1.14).toFixed(2)),
      price: entryPrice * 1.14,
      createdAt: new Date(openedAt + 1.5 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  userTrades.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return { positions, userTrades };
}

export function buildSeedState(now = Date.now()) {
  const markets = MARKET_SPECS.map((spec, i) => buildMarket(spec, i, now));
  const { positions, userTrades } = buildStartingPortfolio(markets, now);
  return {
    version: 2,
    markets,
    leaderboard: buildLeaderboard(now),
    positions,
    userTrades,
    user: {
      authenticated: true,
      suborgId: 'demo-suborg',
      username: DEMO_USERNAME,
      email: 'fabian@pronos.io',
      walletAddress: '0xDEM0000000000000000000000000000000000000',
      balance: 2500,
      needsUsername: false,
    },
    recentTrades: [],
    settings: {
      driftEnabled: true,
      driftSpeed: 3,
      leaderboardShuffleEnabled: true,
      leaderboardShuffleSeconds: 4,
      tradeFlowEnabled: true,
      tradeFlowIntensity: 3,
    },
  };
}
