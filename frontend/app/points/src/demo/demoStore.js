/**
 * In-browser state for the video demo.
 *
 * Everything lives in localStorage so a shoot survives reloads and, more
 * importantly, so takes are repeatable: reset to the seed and take 7 looks
 * exactly like take 1.
 *
 * Two timers run while the demo is mounted:
 *   - drift: nudges every market's probability on a mean-reverting random
 *     walk, which is what makes the percentage move on camera (shot 1).
 *   - leaderboard shuffle: perturbs tournament scores so rows change rank,
 *     with a climb bias on the recording account (shot 2).
 */
import { buildSeedState, pricesFromReserves, rankLeaderboard } from './demoSeed.js';

// Read inline rather than importing demoFlag.js. That module lives in the main
// bundle (regular pages import it for the poll interval), so importing it here
// widens this chunk's dependency graph — which shows up as a bigger preload
// manifest inside PointsMarketDetail, a chunk every visitor downloads. Two
// lines of duplication is the cheaper trade.
function liveSeedDemo() {
  try {
    return window.sessionStorage.getItem('pronos-demo-live-seed') === '1';
  } catch {
    return false;
  }
}

// Namespaced per demo, because the two hold different boards: the video demo
// records against invented markets while the presentation demo runs on the
// real ones. A shared key would let whichever ran last hand the other its
// scenario. v2 because the shape gained userTrades — a v1 blob would
// short-circuit readStored() and serve a board with no trade history.
const STATE_VERSION = 2;
const STORAGE_KEY = liveSeedDemo()
  ? 'pronos-demo-live-v2'
  : 'pronos-video-demo-v2';
const HISTORY_POINT_SECONDS = 10;
const MAX_HISTORY_POINTS = 360;
// Sized for the presentation board (~90 markets), not the video demo's 22.
// At 600 the buffer turned over in seconds and per-market tapes came up empty.
const MAX_RECENT_TRADES = 3000;
const PERSIST_THROTTLE_MS = 3000;

let state = null;
let listeners = new Set();
let driftTimer = null;
let shuffleTimer = null;
let lastPersist = 0;
let lastHistoryAppend = 0;
// Which market is open on screen, so the simulated flow can favour it.
let focusedMarketId = null;

export function setFocusedMarket(id) {
  focusedMarketId = id == null ? null : Number(id);
}

// ─── Persistence ────────────────────────────────────────────────────────────

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== STATE_VERSION || !Array.isArray(parsed.markets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(force = false) {
  const now = Date.now();
  if (!force && now - lastPersist < PERSIST_THROTTLE_MS) return;
  lastPersist = now;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or private-mode failure. The demo keeps working from memory;
    // only reload-persistence is lost, which is not worth interrupting a
    // shoot over.
  }
}

// ─── Price history ──────────────────────────────────────────────────────────

/**
 * Backfills a plausible 24h series ending at the market's current price.
 *
 * Starts at the market's opening odds because that is what the real charts
 * do, and a series that starts anywhere else reads as wrong to anyone who
 * knows the product. For a binary market that's 50%; for a unified market
 * with N outcomes it's 100/N, since the pool opens with equal reserves.
 *
 * Volatility varies per market. With ~90 markets on the board, one shared
 * noise amplitude produced ninety charts with visibly the same silhouette —
 * which reads as generated the moment two cards sit side by side.
 */
function backfillHistory(market, now) {
  const points = 48;
  const stepSeconds = (24 * 60 * 60) / points;
  const target = (market.prices?.[0] ?? 0.5) * 100;
  const outcomeCount = Math.max(2, (market.outcomes || []).length);
  const series = [];
  let value = 100 / outcomeCount;

  // Seeded off the id so a market keeps the same chart shape between the
  // rehearsal and the stage.
  const idSeed = (Number(market.id) || 1) % 97;
  const volatility = 2.5 + (idSeed / 97) * 6.5;

  for (let i = 0; i < points; i += 1) {
    const progress = (i + 1) / points;
    // Pull toward the target while adding noise, so the line wanders but
    // still lands where the market actually is now.
    const pull = (target - value) * (0.08 + progress * 0.12);
    const noise = (Math.random() - 0.5) * volatility * (1 - progress * 0.6);
    value = Math.max(2, Math.min(98, value + pull + noise));
    series.push({
      t: Math.floor((now - (points - 1 - i) * stepSeconds * 1000) / 1000),
      ps: spreadRemainder(market, value),
    });
  }
  series[series.length - 1] = { t: Math.floor(now / 1000), ps: currentPercentages(market) };
  return series;
}

function currentPercentages(market) {
  return (market.prices || []).map(p => Number((p * 100).toFixed(1)));
}

/**
 * Given a value for outcome 0, splits the remaining probability across the
 * other outcomes in their current proportions. History points carry the full
 * vector because /api/points/price-history takes an `outcome` param and the
 * detail chart plots whichever outcome the viewer selected.
 */
function spreadRemainder(market, firstPercent) {
  const rest = (market.prices || []).slice(1);
  const restSum = rest.reduce((s, p) => s + p, 0);
  const remainder = 100 - firstPercent;
  if (!rest.length) return [Number(firstPercent.toFixed(1))];
  return [
    Number(firstPercent.toFixed(1)),
    ...rest.map(p => Number((remainder * (restSum ? p / restSum : 1 / rest.length)).toFixed(1))),
  ];
}

function ensureHistory(now) {
  if (!state.history) state.history = {};
  for (const market of state.markets) {
    if (!Array.isArray(state.history[market.id]) || state.history[market.id].length === 0) {
      state.history[market.id] = backfillHistory(market, now);
    }
  }
}

function appendHistory(now) {
  const t = Math.floor(now / 1000);
  for (const market of state.markets) {
    const series = state.history[market.id];
    if (!series) continue;
    series.push({ t, ps: currentPercentages(market) });
    if (series.length > MAX_HISTORY_POINTS) series.splice(0, series.length - MAX_HISTORY_POINTS);
  }
}

// ─── Drift ──────────────────────────────────────────────────────────────────

/**
 * Rewrites reserves so the market prices out at `probs`, holding pool depth
 * constant. Depth is preserved rather than recomputed so drifting a market
 * never silently changes how much a trade moves it.
 */
function applyProbabilities(market, probs) {
  const depth = market.reserves.reduce((s, r) => s + Number(r), 0);
  const clean = probs.map(p => Math.max(0.02, Math.min(0.98, p)));
  const total = clean.reduce((s, p) => s + p, 0) || 1;
  const normalized = clean.map(p => p / total);

  if (normalized.length === 2) {
    market.reserves = [normalized[1] * depth, normalized[0] * depth];
  } else {
    const invSum = normalized.reduce((s, p) => s + 1 / p, 0);
    market.reserves = normalized.map(p => (depth / p) / invSum * normalized.length);
  }
  market.prices = pricesFromReserves(market.reserves);
}

function driftPrices() {
  const speed = Number(state.settings.driftSpeed) || 3;

  // Calibrated against what the UI actually shows. Percentages render as
  // integers, so a walk of a few tenths of a point is invisible on camera
  // no matter how busy it looks in the data.
  //
  // Tuned for drama over realism: at speed 3 a market travels something like
  // 58% → 65% inside a single take instead of inching around one number. A
  // real prediction market does not swing like this, which is the point — a
  // truthful walk looks like a frozen page on camera.
  // applyProbabilities() clamps the extremes.
  const step = speed * 0.026;
  const reversion = 0.017;

  for (const market of state.markets) {
    if (market.status !== 'active') continue;
    if (!market.anchorProbs) market.anchorProbs = [...market.prices];
    const anchor = market.anchorProbs;

    const next = market.prices.map((p, i) => {
      const pull = (anchor[i] - p) * reversion;
      const noise = (Math.random() - 0.5) * step;
      return p + pull + noise;
    });
    applyProbabilities(market, next);
  }

}

// Prices and order flow are independently switchable, so they share one
// timer but each checks its own setting.
function liveTick() {
  if (state.settings.driftEnabled) driftPrices();
  if (state.settings.tradeFlowEnabled) tradeFlowTick();

  const now = Date.now();
  if (now - lastHistoryAppend >= HISTORY_POINT_SECONDS * 1000) {
    lastHistoryAppend = now;
    appendHistory(now);
  }
  persist();
  notify();
}

// ─── Simulated order flow ───────────────────────────────────────────────────

/**
 * Drips buys and sells into the markets.
 *
 * Without this the volume figures are frozen: the cards, the 24h stats and
 * the "flujo en vivo" panel all look busy but never move, which reads as a
 * screenshot rather than a live market. Each simulated trade bumps the
 * market's traded volume, stamps it as the latest trade, and lands in a
 * rolling buffer that the activity endpoint buckets up.
 *
 * Prices are left to the drift walk. Tying them to this flow as well would
 * compound two random walks on the same reserves and let a busy market run
 * away to 99% during a long take.
 */
// Rotates through the board so coverage is guaranteed rather than hoped for.
// Pure random targeting left most of a ~90-market board untouched for minutes
// at a time, which showed up as cards with a dead "hace 2 h" timestamp sitting
// next to live ones.
let flowCursor = 0;

function recordTrade(market, now, nowSec) {
  // Slight buy lean so the pressure bar sits believably above 50%.
  const side = Math.random() < 0.57 ? 'buy' : 'sell';

  // Two tiers, because a single curve gives either all pocket change or
  // all whales. Most orders are small the way real ones are; roughly one
  // in six is a big ticket that breaks up the rhythm on screen.
  const size = Math.random() < 0.84
    ? Math.round(2 + Math.pow(Math.random(), 2.2) * 450)
    : Math.round(300 + Math.pow(Math.random(), 1.6) * 2600);

  const outcomeIndex = Math.floor(Math.random() * market.outcomes.length);
  const price = Number(market.prices?.[outcomeIndex] ?? 0.5);

  market.tradeVolume = Number(market.tradeVolume || 0) + size;
  market.lastTradeAt = new Date(now).toISOString();

  // The trade tape and activity feed show a name against every fill, so the
  // trader is picked here rather than invented at render time — otherwise the
  // same order shows a different name each time the tape re-renders.
  const names = state.leaderboard;
  const username = names.length
    ? names[Math.floor(Math.random() * names.length)].username
    : 'anon';

  state.recentTrades.push({
    marketId: market.id,
    t: nowSec,
    side,
    size,
    outcomeIndex,
    username,
    price,
    shares: Number((size / Math.max(0.02, price)).toFixed(2)),
  });
}

function tradeFlowTick() {
  const intensity = Math.max(1, Number(state.settings.tradeFlowIntensity) || 3);
  const active = state.markets.filter(m => m.status === 'active');
  if (active.length === 0) return;

  const now = Date.now();
  const nowSec = Math.floor(now / 1000);

  // Scaled to the size of the board. A fixed count that looked busy across 22
  // markets leaves 90 markets looking abandoned; this keeps the per-market
  // rate roughly constant however many are on the board.
  const sweep = Math.max(1, Math.round(active.length / 6));
  const tradesThisTick = Math.max(1, Math.round(sweep * intensity / 3))
    + Math.floor(Math.random() * intensity);

  for (let i = 0; i < tradesThisTick; i += 1) {
    recordTrade(active[flowCursor % active.length], now, nowSec);
    flowCursor += 1;
  }

  // The market on screen gets extra flow layered on top of its turn in the
  // rotation, so the chart being demonstrated stays visibly busy without
  // starving the rest of the board.
  const focused = focusedMarketId
    ? active.find(m => m.id === Number(focusedMarketId))
    : null;
  if (focused) {
    const extra = 1 + Math.floor(Math.random() * intensity);
    for (let i = 0; i < extra; i += 1) recordTrade(focused, now, nowSec);
  }

  if (state.recentTrades.length > MAX_RECENT_TRADES) {
    state.recentTrades.splice(0, state.recentTrades.length - MAX_RECENT_TRADES);
  }
}

// ─── Leaderboard shuffle ────────────────────────────────────────────────────

function shuffleTick() {
  // Matched against the live account name, not the seed constant, so the
  // climb bias follows the username after Fabian renames himself.
  const me = state.leaderboard.find(row => row.username === state.user.username);

  // Once the recording account tops the table there is nothing left to
  // film, so drop it back to mid-pack and let it climb again. That turns
  // "usernames moving up the rankings" into a loop the videographer can
  // shoot as many times as they need instead of a one-shot event.
  if (me && me.rank === 1) {
    const scores = state.leaderboard.map(row => row.score).sort((a, b) => b - a);
    me.score = scores[Math.min(scores.length - 1, Math.floor(scores.length * 0.6))] - 40;
  }

  for (const row of state.leaderboard) {
    const bias = row.username === state.user.username ? 55 : -4;
    row.score = Math.max(0, Math.round(row.score + bias + (Math.random() - 0.5) * 120));
    row.cycleDelta = row.score;
    row.marketPnl = row.score;
  }
  state.leaderboard = rankLeaderboard(state.leaderboard);
  persist();
  notify();
}

// ─── Timers ─────────────────────────────────────────────────────────────────

function startTimers() {
  stopTimers();
  if (state.settings.driftEnabled || state.settings.tradeFlowEnabled) {
    driftTimer = window.setInterval(liveTick, 1000);
  }
  if (state.settings.leaderboardShuffleEnabled) {
    const seconds = Math.max(1, Number(state.settings.leaderboardShuffleSeconds) || 4);
    shuffleTimer = window.setInterval(shuffleTick, seconds * 1000);
  }
}

function stopTimers() {
  if (driftTimer) { window.clearInterval(driftTimer); driftTimer = null; }
  if (shuffleTimer) { window.clearInterval(shuffleTimer); shuffleTimer = null; }
}

// ─── Public surface ─────────────────────────────────────────────────────────

function notify() {
  for (const fn of listeners) {
    try { fn(state); } catch { /* a broken panel listener must not stop the demo */ }
  }
}

/**
 * @param {object} [seedState] a pre-built seed (the presentation demo passes
 *   the live backend snapshot). A saved scenario still wins over it, so a
 *   reload mid-presentation resumes where it left off instead of re-fetching
 *   and re-randomising the board.
 */
export function initDemoStore(seedState = null) {
  if (state) return state;
  const now = Date.now();
  state = readStored() || seedState || buildSeedState(now);
  // A scenario saved before a setting existed still has to boot.
  const defaults = buildSeedState(now);
  state.settings = { ...defaults.settings, ...(state.settings || {}) };
  if (!Array.isArray(state.recentTrades)) state.recentTrades = [];
  if (!Array.isArray(state.userTrades)) state.userTrades = [];
  ensureHistory(now);
  lastHistoryAppend = now;
  persist(true);
  startTimers();
  return state;
}

export function getDemoState() {
  return state || initDemoStore();
}

export function updateDemoState(mutator) {
  const next = getDemoState();
  mutator(next);
  persist(true);
  notify();
  return next;
}

export function updateDemoSettings(patch) {
  updateDemoState(s => Object.assign(s.settings, patch));
  startTimers();
}

/**
 * Renames the recording account.
 *
 * The name lives in two places that have to move together: the signed-in
 * user and that user's row in the tournament table. Renaming only the first
 * would leave the leaderboard highlighting nobody and the climb bias chasing
 * a name that no longer exists.
 */
export function renameDemoUser(nextName) {
  const name = String(nextName || '').trim().replace(/^@/, '');
  if (!name) return { ok: false, error: 'Escribe un nombre de usuario.' };

  const current = getDemoState().user.username;
  if (name === current) return { ok: true };

  const taken = getDemoState().leaderboard
    .some(row => row.username !== current && row.username.toLowerCase() === name.toLowerCase());
  if (taken) return { ok: false, error: 'Ese nombre ya lo usa otro competidor.' };

  updateDemoState(s => {
    const row = s.leaderboard.find(item => item.username === current);
    if (row) row.username = name;
    s.user.username = name;
  });
  return { ok: true };
}

/**
 * @param {object} [seedState] replace the board with this snapshot instead of
 *   the invented seed — how "Recargar del backend" in the control panel picks
 *   up markets published after the demo was already open.
 */
export function resetDemoState(seedState = null) {
  const now = Date.now();
  state = seedState || buildSeedState(now);
  ensureHistory(now);
  lastHistoryAppend = now;
  persist(true);
  startTimers();
  notify();
  return state;
}

export function subscribeDemoState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function exportDemoState() {
  return JSON.stringify(getDemoState(), null, 2);
}

export function importDemoState(json) {
  const parsed = JSON.parse(json);
  if (!parsed || !Array.isArray(parsed.markets)) throw new Error('El archivo no tiene mercados.');
  state = parsed;
  const defaults = buildSeedState(Date.now());
  state.settings = { ...defaults.settings, ...(state.settings || {}) };
  if (!Array.isArray(state.recentTrades)) state.recentTrades = [];
  if (!Array.isArray(state.userTrades)) state.userTrades = [];
  ensureHistory(Date.now());
  persist(true);
  startTimers();
  notify();
  return state;
}

export { applyProbabilities, STORAGE_KEY };
