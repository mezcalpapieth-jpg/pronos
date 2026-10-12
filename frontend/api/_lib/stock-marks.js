import { rows, createStockData, validateFx } from './stock-data.js';
import { decimal, fixed, parseSignedMoney, stockError, stockPositionValue } from './stock-math.js';
import { stockAsset } from './stock-assets.js';
import { configuredCycleWindowFromRow } from './points-tournament-config.js';

export const stocksAreEnabled = () => process.env.POINTS_STOCKS_ENABLED === 'true';
export const STOCK_MARK_MAX_AGE_MS = 90_000;

// One shared price per asset/cycle keeps rankings independent of who opens Portfolio.
// A terminal price can never be replaced by a live quote or a later cron run.
export async function persistStockMarks(db, { cycleId, market, now = Date.now(), terminal = false, cutoffAt = null }) {
  if (!market || market.stale || !market.fx || !Array.isArray(market.assets)) throw stockError('stock_price_unavailable', 503);
  validateFx(market.fx, terminal ? new Date(cutoffAt).getTime() : now);
  for (const asset of [...market.assets].sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    if (!asset.available || !stockAsset(asset.ticker) || fixed(asset.priceUsd, 8) <= 0n) continue;
    const pricedAt = asset.pricedAt ?? market.fetchedAt;
    if (!Number.isFinite(pricedAt) || pricedAt > now || (terminal && (!cutoffAt || pricedAt >= new Date(cutoffAt).getTime()))
        || (!terminal && now - pricedAt > STOCK_MARK_MAX_AGE_MS)) throw stockError('stock_price_unavailable', 503);
    await db.query(`INSERT INTO points_stock_cycle_marks(cycle_id,ticker,price_usd,fx_rate,fx_date,priced_at,cutoff_at,terminal,source)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(cycle_id,ticker) DO UPDATE SET price_usd=EXCLUDED.price_usd,fx_rate=EXCLUDED.fx_rate,
      fx_date=EXCLUDED.fx_date,priced_at=EXCLUDED.priced_at,cutoff_at=EXCLUDED.cutoff_at,terminal=EXCLUDED.terminal,source=EXCLUDED.source
      WHERE NOT points_stock_cycle_marks.terminal
        AND (EXCLUDED.terminal OR EXCLUDED.priced_at >= points_stock_cycle_marks.priced_at)`,
    [cycleId, asset.ticker, asset.priceUsd, market.fx.rate, market.fx.date, new Date(pricedAt).toISOString(), cutoffAt, terminal,
      terminal ? 'Hyperliquid xyz completed 1m candle / Banxico FIX' : 'Hyperliquid xyz mark / Banxico FIX']);
  }
}

export async function freezeStockCycleMarks(db, cycle, { now = new Date(), data = createStockData(db) } = {}) {
  const window = configuredCycleWindowFromRow(cycle);
  if (!window) throw stockError('stock_cycle_closed', 409);
  const cutoff = Math.min(new Date(window.rankingCutoffAt).getTime(), new Date(now).getTime());
  const held = await rows(db, `SELECT DISTINCT p.ticker,m.terminal FROM points_stock_positions p
    LEFT JOIN points_stock_cycle_marks m ON m.cycle_id=p.cycle_id AND m.ticker=p.ticker
    WHERE p.cycle_id=$1 AND p.quantity>0 ORDER BY p.ticker`, [cycle.id]);
  if (!held.length || held.every(row => row.terminal === true)) return;
  // Snapshot callers hold the exclusive cycle lock. The bounded provider reads
  // cannot race fills, and any unavailable cutoff price aborts the entire photo.
  const market = await data.cutoff(held.map(row => row.ticker), cutoff);
  const prices = new Set(market.assets.filter(asset => asset.available).map(asset => asset.ticker));
  if (held.some(row => !prices.has(row.ticker))) throw stockError('stock_cutoff_price_unavailable', 503);
  await persistStockMarks(db, { cycleId: cycle.id, market, now: new Date(now).getTime(), terminal: true, cutoffAt: new Date(cutoff).toISOString() });
  await updateStockPositionMarks(db, cycle.id);
  await recordStockValuations(db, cycle.id, new Date(cutoff).toISOString());
}

async function updateStockPositionMarks(db, cycleId) {
  await db.query(`UPDATE points_stock_positions p SET current_value=TRUNC(p.quantity*m.price_usd*m.fx_rate,6),
    mark_price_usd=m.price_usd,marked_at=m.priced_at
    FROM points_stock_cycle_marks m WHERE p.cycle_id=$1 AND m.cycle_id=p.cycle_id AND m.ticker=p.ticker`, [cycleId]);
}

async function recordStockValuations(db, cycleId, sampledAt) {
  await db.query(`INSERT INTO points_stock_valuations(username,cycle_id,sampled_at,current_value,cost_basis,realized_pnl)
    SELECT username,cycle_id,$2,SUM(CASE WHEN quantity=0 THEN 0 ELSE current_value END),SUM(cost_basis),SUM(realized_pnl)
    FROM points_stock_positions WHERE cycle_id=$1 GROUP BY username,cycle_id
    HAVING COUNT(*) FILTER(WHERE quantity>0 AND current_value IS NULL)=0
    ON CONFLICT(username,cycle_id,sampled_at) DO UPDATE SET current_value=EXCLUDED.current_value,
    cost_basis=EXCLUDED.cost_basis,realized_pnl=EXCLUDED.realized_pnl`, [cycleId, sampledAt]);
}

export async function snapshotStockValuations(db, { market, now = Date.now() }) {
  const [cycle] = await rows(db, `SELECT * FROM points_cycles WHERE status='active' ORDER BY ends_at DESC LIMIT 1 FOR SHARE`);
  const window = configuredCycleWindowFromRow(cycle);
  if (!window) return { skipped: 'no_active_cycle' };
  if (now >= new Date(window.rankingCutoffAt).getTime()) return { skipped: 'cutoff_passed', cycleId: cycle.id };
  // Follow fill lock order: cycle, wallets in stable order, marks, positions.
  await db.query(`SELECT b.username FROM points_balances b WHERE b.username IN
    (SELECT username FROM points_stock_positions WHERE cycle_id=$1) ORDER BY b.username FOR UPDATE`, [cycle.id]);
  await persistStockMarks(db, { cycleId: cycle.id, market, now });
  await updateStockPositionMarks(db, cycle.id);
  await recordStockValuations(db, cycle.id, new Date(Math.floor(now / 60000) * 60000).toISOString());
  return { ok: true, cycleId: cycle.id, sampledAt: new Date(now).toISOString() };
}

export async function readStockTournamentRows(db, { window, now = Date.now(), enabled = stocksAreEnabled() }) {
  if (!enabled || !window?.id) return { scores: new Map(), activity: new Map() };
  const positions = await rows(db, `SELECT p.*,m.price_usd AS shared_price,m.fx_rate AS shared_fx,
    m.priced_at AS shared_at,m.terminal FROM points_stock_positions p
    LEFT JOIN points_stock_cycle_marks m ON m.cycle_id=p.cycle_id AND m.ticker=p.ticker WHERE p.cycle_id=$1`, [window.id]);
  const scores = new Map();
  for (const position of positions) {
    const score = scores.get(position.username) || { pnl: 0n, currentValue: 0n, stale: false, markedAt: null };
    const held = fixed(position.quantity, 18) > 0n;
    const value = !held ? '0' : position.shared_price
      ? stockPositionValue(position.quantity, position.shared_price, position.shared_fx) : position.current_value;
    if (value == null) throw stockError('stock_valuation_unavailable', 503);
    score.currentValue += fixed(value);
    score.pnl += fixed(value) - fixed(position.cost_basis) + parseSignedMoney(position.realized_pnl);
    if (held) {
      const markedAt = position.shared_at || position.marked_at;
      const age = now - new Date(markedAt).getTime();
      score.stale ||= !position.terminal && (!markedAt || !Number.isFinite(age) || age < 0 || age > STOCK_MARK_MAX_AGE_MS);
      if (markedAt && (!score.markedAt || new Date(markedAt) < new Date(score.markedAt))) score.markedAt = new Date(markedAt).toISOString();
    }
    scores.set(position.username, score);
  }
  for (const score of scores.values()) { score.pnl = Number(decimal(score.pnl)); score.currentValue = Number(decimal(score.currentValue)); }
  const activity = await rows(db, `SELECT username,COUNT(*)::int AS total_actions,
    COUNT(*) FILTER(WHERE side='buy')::int AS buy_count,
    ARRAY_AGG(DISTINCT ((created_at AT TIME ZONE 'America/Mexico_City')::date)::text) AS active_day_keys
    FROM points_stock_trades WHERE cycle_id=$1 AND created_at>=$2 AND created_at<=$3 GROUP BY username`,
  [window.id, window.startsAt, window.rankingCutoffAt]);
  return { scores, activity: new Map(activity.map(row => [row.username, row])) };
}
