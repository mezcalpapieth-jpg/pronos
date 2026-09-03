/**
 * Builds the demo dataset from the REAL backend instead of invented specs.
 *
 * This is what separates /points-demo from /points/video. The video demo
 * fabricates 22 questions by hand; the presentation demo shows the markets
 * Pronos actually has, with simulated activity on top — so what the audience
 * reads is true even though the movement is not.
 *
 * One network round-trip at boot, then nothing. After the snapshot loads the
 * demo runs entirely offline, which matters on a conference stage: the WiFi
 * dying mid-talk must not blank the page. A live proxy would also make price
 * drift impossible — every poll would overwrite the drifted price with the
 * real one and the chart would sit frozen.
 *
 * Why resolved markets get revived: production carries ~11 active markets and
 * ~1000 resolved ones. Eleven cards is an empty-looking grid, and nine of the
 * eleven are binary. Reviving a curated slice of the resolved archive fills
 * the grid with real Pronos questions across every category.
 */
import {
  buildSeedState,
  buildStartingPortfolio,
  pricesFromReserves,
  rankLeaderboard,
  reservesForProbabilities,
} from './demoSeed.js';

const DAY = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const REVIVED_TARGET = 80;
const MIN_USABLE_MARKETS = 5;

// Display volume band, in MXNP. The floor is what makes a market read as
// "someone is actually trading here"; the ceiling keeps the biggest market
// from dwarfing the rest into unreadable rounding.
const MIN_VOLUME = 26_000;
const MAX_VOLUME = 620_000;

/**
 * Deterministic per-market randomness.
 *
 * Seeded off the market id so a market gets the same volume and the same
 * probability every time the demo is rebuilt. Rehearsing and then presenting
 * should show the same numbers — a grid that reshuffles itself between the
 * run-through and the stage is a needless surprise.
 */
function seededRandom(seed) {
  let s = (Number(seed) || 1) >>> 0;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

async function fetchJson(fetchImpl, url, timeoutMs) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      credentials: 'same-origin',
      signal: controller?.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Probabilities for a market about to go back on the board.
 *
 * A resolved market's stored price is its settled one — 93.6% for something
 * that ended up happening. Putting that straight back on the grid gives a
 * wall of cards reading 95% / 3%, which looks like a dead book rather than a
 * live one. So each price is pulled toward the middle and jittered: the
 * market keeps the *direction* of its real consensus, but lands somewhere a
 * trader would still find worth a bet.
 */
function reviveProbabilities(market, rand) {
  const raw = (market.prices || []).map(p => Number(p) || 0);
  if (raw.length < 2) return [0.5, 0.5];

  if (raw.length === 2) {
    const centered = 0.5 + (raw[0] - 0.5) * 0.45;
    const jittered = clamp(centered + (rand() - 0.5) * 0.16, 0.12, 0.88);
    return [jittered, 1 - jittered];
  }

  // Multi-outcome. Parallel markets carry independent per-leg binary prices
  // that don't sum to 1, so normalizing is required, not cosmetic. Then blend
  // toward uniform so no single outcome sits at 97% and flattens the rest.
  const total = raw.reduce((s, p) => s + p, 0) || 1;
  const uniform = 1 / raw.length;
  const blended = raw.map(p => 0.6 * (p / total) + 0.4 * uniform);
  const jittered = blended.map(p => Math.max(0.01, p * (0.85 + rand() * 0.3)));
  const sum = jittered.reduce((s, p) => s + p, 0) || 1;
  return jittered.map(p => p / sum);
}

/**
 * Display volume, and the pool depth that has to go with it.
 *
 * Depth is the part that's easy to get wrong. Real markets carry small
 * reserves (often [1000, 1000]), so a 500 MXNP buy against them moves the
 * price by ~25 points — which looks obviously fake the moment anyone trades
 * on stage. Sizing depth against the displayed volume keeps a normal buy at
 * one to three points, the way a market with that much volume would behave.
 */
function volumeAndDepth(market, rand) {
  const outcomeBonus = market.outcomes.length > 2 ? 1.3 : 1;
  const featuredBonus = market.featured ? 1.12 : 1;
  // Skewed hard toward the low end so a handful of markets stand out as the
  // busy ones. Applied to the fraction rather than the result, so the bonuses
  // shift a market up the distribution instead of pinning it to the ceiling.
  const fraction = clamp(Math.pow(rand(), 2.6) * outcomeBonus * featuredBonus, 0, 1);
  const volume = Math.round(MIN_VOLUME + (MAX_VOLUME - MIN_VOLUME) * fraction);
  // Depth is what keeps a live buy believable: a 500 MXNP order should move
  // the price a point or two, not fifteen. Tuned against binaryBuyQuote —
  // at volume/8 a 500 buy lands around 1-2pp across the whole board.
  const depth = clamp(Math.round(volume / 8), 14_000, 190_000);
  return { volume, depth };
}

/**
 * Rebuilds one API market row into a demo market.
 *
 * The output shape has to match GET /api/points/markets field-for-field,
 * because the demo backend serves it straight back to the same components.
 */
function toDemoMarket(market, { now, revived, index, rand }) {
  const probs = reviveProbabilities(market, rand);
  const { volume, depth } = volumeAndDepth(market, rand);
  const reserves = reservesForProbabilities(probs, depth);

  // The card sums volume + tradeVolume while the detail page shows
  // tradeVolume alone; splitting the target across both keeps the two
  // screens within a believable distance of each other.
  const seedLiquidity = Math.round(volume * 0.35);
  const tradeVolume = volume - seedLiquidity;

  // Staggered so the "closes soon" ordering has something to sort by and the
  // grid isn't a wall of identical dates.
  const endsInDays = revived
    ? 2 + (index % 9) * 3 + rand() * 8
    : Math.max(1, (new Date(market.endTime).getTime() - now) / DAY);

  return {
    ...market,
    // Parallel markets have no unified pool of their own — their liquidity
    // lives in per-leg binary pools the demo backend doesn't model. Folding
    // them into one unified pool keeps the two flagship F1 markets (13 and 11
    // outcomes, with driver imagery) on the board instead of dropping them.
    ammMode: 'unified',
    reserves,
    prices: pricesFromReserves(reserves),
    seedLiquidity,
    volume: seedLiquidity,
    tradeVolume,
    status: 'active',
    outcome: null,
    resolvedAt: null,
    finalScore: null,
    archivedAt: null,
    endTime: new Date(now + endsInDays * DAY).toISOString(),
    hiddenFromHome: false,
    featured: true,
    live: false,
    lastTradeAt: new Date(now - Math.round(rand() * 40) * 60 * 1000).toISOString(),
    // Crypto 5-min ticks run on their own price feed and settlement clock;
    // revived as a normal market they'd show a countdown that never fires.
    crypto5min: false,
    cryptoIntervalMinutes: null,
    cryptoWindowMinutes: null,
    // Parallel leftovers — leaving these would make the detail page look for
    // legs the demo backend never produces.
    legIds: undefined,
    legStatuses: undefined,
    legOutcomes: undefined,
    activeOutcomeIndexes: undefined,
    seriesLocked: undefined,
    seriesLockReason: undefined,
    actualStatus: undefined,
    anchorProbs: undefined,
  };
}

function usable(market) {
  if (!market || typeof market !== 'object') return false;
  if (!Array.isArray(market.outcomes) || market.outcomes.length < 2) return false;
  if (!Array.isArray(market.prices) || market.prices.length !== market.outcomes.length) return false;
  // 64-outcome markets exist in the archive and render as an unreadable card.
  if (market.outcomes.length > 16) return false;
  return true;
}

/**
 * Picks the resolved markets worth putting back on the board.
 *
 * Round-robins across categories rather than taking the most recent N, because
 * the archive is 60% deportes — a straight slice would produce a grid of
 * nothing but soccer fixtures. Crypto 5-minute ticks are dropped outright:
 * there are ~52 of them and they're near-identical Bitcoin rows.
 */
function curateRevived(resolved, target) {
  const seen = new Set();
  const byCategory = new Map();

  for (const market of resolved) {
    if (!usable(market)) continue;
    if (market.crypto5min) continue;
    // Recurring markets ("América vs Toluca") repeat across seasons.
    const key = market.question.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const category = market.category || 'general';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(market);
  }

  // Multi-outcome cards carry more visual weight, so they go first within
  // each category rather than being crowded out by binary fixtures.
  for (const list of byCategory.values()) {
    list.sort((a, b) => {
      const spread = (b.outcomes.length > 2 ? 1 : 0) - (a.outcomes.length > 2 ? 1 : 0);
      if (spread !== 0) return spread;
      return new Date(b.resolvedAt || 0) - new Date(a.resolvedAt || 0);
    });
  }

  const queues = [...byCategory.values()];
  const picked = [];
  let round = 0;
  while (picked.length < target && queues.some(q => q.length > round)) {
    for (const queue of queues) {
      if (picked.length >= target) break;
      if (queue.length > round) picked.push(queue[round]);
    }
    round += 1;
  }
  return picked;
}

/**
 * Fetches the live market board and turns it into a demo state.
 *
 * Returns null on any failure so the caller can fall back to the invented
 * seed — a demo that boots with the wrong markets beats one that boots blank.
 */
export async function buildLiveSeedState({
  fetchImpl = fetch,
  now = Date.now(),
  timeoutMs = FETCH_TIMEOUT_MS,
  revivedTarget = REVIVED_TARGET,
} = {}) {
  const [activeRes, resolvedRes] = await Promise.all([
    fetchJson(fetchImpl, '/api/points/markets?status=active&featured=all&limit=2000', timeoutMs),
    fetchJson(fetchImpl, '/api/points/markets?status=resolved&featured=all&limit=2000', timeoutMs),
  ]);

  // Crypto 5-minute ticks are dropped from the board entirely. Their question
  // text is pinned to a five-minute window ("¿sube o baja a las 14:00?"), so
  // there is no honest end date to give them, and the demo backend has no
  // price feed behind the countdown they'd otherwise render.
  const active = (activeRes?.markets || []).filter(m => usable(m) && !m.crypto5min);
  const resolved = resolvedRes?.markets || [];
  if (active.length + resolved.length < MIN_USABLE_MARKETS) return null;

  const revived = curateRevived(resolved, revivedTarget);

  const markets = [
    ...active.map((m, i) => toDemoMarket(m, {
      now, revived: false, index: i, rand: seededRandom(m.id * 7 + 13),
    })),
    ...revived.map((m, i) => toDemoMarket(m, {
      now, revived: true, index: i, rand: seededRandom(m.id * 7 + 13),
    })),
  ];

  if (markets.length < MIN_USABLE_MARKETS) return null;

  // Everything that isn't the market board — leaderboard, the signed-in demo
  // user, simulation settings — is identical to the invented seed, so it is
  // reused rather than duplicated.
  const base = buildSeedState(now);
  const { positions, userTrades } = buildStartingPortfolio(markets, now);
  return {
    ...base,
    markets,
    positions,
    userTrades,
    leaderboard: rankLeaderboard(base.leaderboard),
    settings: {
      ...base.settings,
      // The video demo runs drift at 3, tuned so a market visibly travels
      // inside a 30-second take. A presentation is watched for minutes at a
      // time and often on a projector next to the real product, where that
      // speed reads as a random number generator — a market swinging 20
      // points in 20 seconds is not a market. At 1 the percentage still
      // ticks every few seconds, which is all the movement needs to do.
      driftSpeed: 1,
    },
    liveSeed: true,
    liveSeedAt: new Date(now).toISOString(),
  };
}
