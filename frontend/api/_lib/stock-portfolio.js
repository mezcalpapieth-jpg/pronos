import { rows } from './stock-data.js';
import { stockAsset } from './stock-assets.js';
import { decimal, fixed, parseSignedMoney, stockPositionValue } from './stock-math.js';
import { configuredCycleWindowFromRow } from './points-tournament-config.js';
import { persistStockMarks, STOCK_MARK_MAX_AGE_MS } from './stock-marks.js';
import { readStockCyclePhase, stockValuationMinute } from './stock-cycle.js';

export async function readStockPortfolio(db, { username, scope = 'current', market = null, now = Date.now(), includeHistory = true }) {
  const [cycle] = await rows(db, scope === 'previous'
    ? `SELECT * FROM points_cycles WHERE status='closed' ORDER BY closed_at DESC NULLS LAST,ends_at DESC LIMIT 1 FOR SHARE`
    : `SELECT * FROM points_cycles WHERE status='active' ORDER BY ends_at DESC LIMIT 1 FOR SHARE`);
  const empty = { positions: [], trades: [], series: [], summary: { currentValue: 0, costBasis: 0, unrealizedPnl: 0, realizedPnl: 0, tournamentPnl: 0, pnl: 0 }, cycle: null };
  if (!cycle) return empty;
  // Synchronize with fills to avoid recording a position from one transaction
  // and its wallet/cost basis from another. Never hold this while fetching data.
  await db.query('SELECT balance FROM points_balances WHERE username=$1 FOR SHARE', [username]);
  const phase = scope === 'current' ? await readStockCyclePhase(db, cycle, now) : null;
  const postCutoff = phase === 'post_cutoff';
  const isLive = position => Boolean(phase) && position.post_cutoff === postCutoff;
  const readPositions = () => rows(db, `SELECT p.*,m.price_usd AS shared_price,m.fx_rate AS shared_fx,m.priced_at AS shared_at,m.terminal
    FROM points_stock_positions p LEFT JOIN points_stock_cycle_marks m ON m.cycle_id=p.cycle_id AND m.ticker=p.ticker
      AND m.post_cutoff=p.post_cutoff
    WHERE p.username=$1 AND p.cycle_id=$2 ORDER BY p.ticker`, [username, cycle.id]);
  let positions = await readPositions();
  const heldTickers = new Set(positions.filter(p => isLive(p) && fixed(p.quantity, 18) > 0n).map(p => p.ticker));
  if (heldTickers.size && market && !market.stale && Number.isFinite(market.fetchedAt)) {
    // A portfolio poll only refreshes its own holdings. The minute collector
    // maintains the common marks for offline users and all other instruments.
    await persistStockMarks(db, { cycleId: cycle.id, postCutoff, market: { ...market, assets: market.assets.filter(a=>heldTickers.has(a.ticker)) }, now });
    positions = await readPositions();
  }
  let totalValue = 0n;
  let totalBasis = 0n;
  let totalRealized = 0n;
  let tournamentRealized = 0n;
  let complete = true;
  let marksFresh = true;
  const displayed = [];
  for (const position of positions) {
    const live = isLive(position);
    const asset = stockAsset(position.ticker);
    const price = market?.assets.find(item => item.ticker === position.ticker)?.priceUsd;
    let value = position.current_value;
    if (position.shared_price) {
      value = stockPositionValue(position.quantity, position.shared_price, position.shared_fx);
      position.mark_price_usd = position.shared_price;
      position.marked_at = position.shared_at;
    } else if (live && price && market?.fx && !market.stale) {
      value = stockPositionValue(position.quantity, price, market.fx.rate);
      position.mark_price_usd = price;
      position.marked_at = new Date(now).toISOString();
      await db.query(`UPDATE points_stock_positions SET current_value=$1,mark_price_usd=$2,marked_at=$3
        WHERE username=$4 AND cycle_id=$5 AND ticker=$6 AND post_cutoff=$7`,
      [value, price, position.marked_at, username, cycle.id, position.ticker, position.post_cutoff]);
    }
    if (fixed(position.quantity, 18) === 0n) value = '0';
    if (value == null) complete = false;
    else totalValue += fixed(value);
    totalBasis += fixed(position.cost_basis);
    const realized = parseSignedMoney(position.realized_pnl);
    totalRealized += realized;
    if (!position.post_cutoff) tournamentRealized += realized;
    const held = fixed(position.quantity, 18) > 0n;
    const markAge = now - new Date(position.marked_at).getTime();
    const stale = held && !position.terminal && (!live || Boolean(market?.stale || !price)
      || !position.marked_at || !Number.isFinite(markAge) || markAge < 0 || markAge > STOCK_MARK_MAX_AGE_MS);
    if (stale || (held && value == null)) marksFresh = false;
    if (held) displayed.push({ ...asset, quantity: position.quantity,
      costBasis: position.cost_basis, currentValue: value, priceUsd: position.mark_price_usd,
      markedAt: position.marked_at, unrealizedPnl: value == null ? null : decimal(fixed(value) - fixed(position.cost_basis)),
      realizedPnl: position.realized_pnl, archived: !live, stale, terminal: position.terminal === true });
  }
  if (phase && complete && marksFresh && (!postCutoff || positions.some(isLive))) {
    const cutoff = postCutoff ? configuredCycleWindowFromRow(cycle).rankingCutoffAt : null;
    await db.query(`INSERT INTO points_stock_valuations(username,cycle_id,sampled_at,current_value,cost_basis,realized_pnl)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(username,cycle_id,sampled_at) DO UPDATE SET current_value=EXCLUDED.current_value,
      cost_basis=EXCLUDED.cost_basis,realized_pnl=EXCLUDED.realized_pnl`,
    [username, cycle.id, stockValuationMinute(now, cutoff), decimal(totalValue), decimal(totalBasis), decimal(totalRealized)]);
  }
  const trades = includeHistory ? await rows(db, `SELECT id,ticker,side,origin,post_cutoff,quantity,price_usd,fx_rate,fx_date,gross,fee,total,realized_pnl,created_at
    FROM points_stock_trades WHERE username=$1 AND cycle_id=$2 ORDER BY created_at DESC,id DESC LIMIT 201`, [username, cycle.id]) : [];
  const series = includeHistory ? await rows(db, `SELECT EXTRACT(EPOCH FROM sampled_at)::bigint AS t,
    (current_value-cost_basis+realized_pnl)::float8 AS v FROM points_stock_valuations
    WHERE username=$1 AND cycle_id=$2 ORDER BY sampled_at DESC LIMIT 50000`, [username, cycle.id]) : [];
  return { positions: displayed, trades: trades.slice(0, 200), hasMoreTrades: trades.length > 200,
    series: series.reverse().map(point => ({ t: Number(point.t), v: Number(point.v) })), cycle: { id: cycle.id, label: cycle.label, scope },
    stale: !marksFresh, summary: { currentValue: complete ? Number(decimal(totalValue)) : null,
      costBasis: Number(decimal(totalBasis)), realizedPnl: Number(decimal(totalRealized)), tournamentPnl: Number(decimal(tournamentRealized)),
      unrealizedPnl: complete ? Number(decimal(totalValue - totalBasis)) : null,
      pnl: complete ? Number(decimal(totalValue - totalBasis + totalRealized)) : null } };
}
