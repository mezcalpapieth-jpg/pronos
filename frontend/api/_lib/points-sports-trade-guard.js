import { readEspnEvent } from './sports-results.js';
import { buildFootballDataEspnFallbackConfig } from './sports-resolver-fallback.js';

const SINGLE_GAME_SHAPES = new Set(['binary', 'draw3', 'total-goals-over']);

function resolverConfig(market) {
  const value = market?.resolver_config;
  if (typeof value !== 'string') return value || {};
  try { return JSON.parse(value); } catch { return {}; }
}

export async function sportsTradeLock(market, { readEvent = readEspnEvent, db } = {}) {
  const cfg = resolverConfig(market);
  if (!['espn', 'football-data'].includes(cfg.source) || !SINGLE_GAME_SHAPES.has(cfg.shape)) return null;
  try {
    let lookup = cfg;
    if (cfg.source === 'football-data') {
      let metadata = market;
      if (!cfg.espnFallback && db) {
        const result = await db.query(`
          SELECT m.sport, m.league, m.start_time, pm.source_data AS pending_source_data
          FROM points_markets m
          LEFT JOIN points_pending_markets pm ON pm.approved_market_id = COALESCE(m.parent_id, m.id)
          WHERE m.id = $1
        `, [market.id]);
        metadata = (Array.isArray(result) ? result : result.rows)?.[0] || market;
      }
      lookup = buildFootballDataEspnFallbackConfig({ resolverConfig: cfg,
        sourceData: metadata.pending_source_data, sport: metadata.sport,
        league: metadata.league, startTime: metadata.start_time });
      if (!lookup) throw new Error('missing football event lookup');
    }
    // Rescheduled games can finish before the kickoff saved in our database.
    const result = await readEvent({ ...lookup, preferSummary: true });
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
