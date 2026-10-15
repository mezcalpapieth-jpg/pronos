import { readEspnEvent } from './sports-results.js';

const SINGLE_GAME_SHAPES = new Set(['binary', 'draw3', 'total-goals-over']);

function resolverConfig(market) {
  const value = market?.resolver_config;
  if (typeof value !== 'string') return value || {};
  try { return JSON.parse(value); } catch { return {}; }
}

export async function sportsTradeLock(market, { readEvent = readEspnEvent } = {}) {
  const cfg = resolverConfig(market);
  if (cfg.source !== 'espn' || !SINGLE_GAME_SHAPES.has(cfg.shape)) return null;
  try {
    // Rescheduled games can finish before the kickoff saved in our database.
    const result = await readEvent({ ...cfg, preferSummary: true });
    if (!result || result.notFound) throw new Error('missing event');
    if (result.completed || result.interrupted) {
      return { error: 'market_closed', status: 400, detail: 'The game has finished or is suspended. Trading is closed.' };
    }
    if (!['pre', 'in'].includes(result.state)) throw new Error('unverified game state');
    return null;
  } catch {
    // An unavailable scoreboard must not open a post-game trading window.
    return { error: 'sports_status_unavailable', status: 503, detail: 'Game status could not be verified. Please try again shortly.' };
  }
}

export async function assertSportsTradeAllowed(market, options) {
  const lock = await sportsTradeLock(market, options);
  if (!lock) return;
  const error = new Error(lock.error);
  Object.assign(error, { status: lock.status, detail: lock.detail });
  throw error;
}
