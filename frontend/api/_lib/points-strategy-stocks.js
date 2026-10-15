import { STOCK_MARK_MAX_AGE_MS } from './stock-marks.js';

const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = value => Math.round(n(value) * 100) / 100;
const treasury = () => process.env.POINTS_TREASURY_USERNAME || 'pronos_treasury';

export async function readStockStrategyAudit(client, { cycleId, startsAt, endsAt, limit = 40, now = new Date() }) {
  const schema = await client.query(`SELECT to_regclass('public.points_stock_trades') AS trades,
    to_regclass('public.points_stock_positions') AS positions, to_regclass('public.points_stock_cycle_marks') AS marks`);
  if (!schema.rows[0]?.trades || !schema.rows[0]?.positions || !schema.rows[0]?.marks) {
    return { available: false, summary: {}, users: [], assets: [], recentTrades: [] };
  }
  const params = [cycleId, treasury(), new Date(now).toISOString(), STOCK_MARK_MAX_AGE_MS];
  const { rows } = await client.query(`WITH position_values AS (
    SELECT p.username,p.ticker,p.quantity,p.cost_basis,p.realized_pnl,
      CASE WHEN p.quantity=0 THEN 0
        WHEN m.price_usd IS NOT NULL THEN TRUNC(p.quantity*m.price_usd*m.fx_rate,6)
        ELSE p.current_value END AS current_value,
      COALESCE(m.priced_at,p.marked_at) AS marked_at,
      p.quantity>0 AND NOT COALESCE(m.terminal,FALSE) AND (
        COALESCE(m.priced_at,p.marked_at) IS NULL OR COALESCE(m.priced_at,p.marked_at)>$3::timestamptz
        OR COALESCE(m.priced_at,p.marked_at)<$3::timestamptz-($4::int*INTERVAL '1 millisecond')) AS stale
    FROM points_stock_positions p LEFT JOIN points_stock_cycle_marks m
      ON m.cycle_id=p.cycle_id AND m.ticker=p.ticker
    WHERE p.cycle_id=$1 AND p.username<>$2
  ), trading AS (
    SELECT username,COUNT(*)::int AS trades,COUNT(*) FILTER(WHERE side='buy')::int AS buys,
      COUNT(*) FILTER(WHERE side='sell')::int AS sells,COUNT(DISTINCT ticker)::int AS tickers,
      COUNT(DISTINCT (created_at AT TIME ZONE 'America/Mexico_City')::date)::int AS active_days,
      SUM(gross) AS volume,SUM(fee) AS fees,
      COALESCE(SUM(total) FILTER(WHERE side='buy'),0) AS invested,
      COALESCE(SUM(total) FILTER(WHERE side='sell'),0) AS proceeds,
      MIN(created_at) AS first_trade,MAX(created_at) AS last_trade
    FROM points_stock_trades WHERE cycle_id=$1 AND username<>$2 AND origin='user' GROUP BY username
  ), holdings AS (
    SELECT username,COUNT(*) FILTER(WHERE quantity>0)::int AS open_positions,
      SUM(cost_basis) AS cost_basis,SUM(realized_pnl) AS realized_pnl,
      CASE WHEN COUNT(*) FILTER(WHERE quantity>0 AND current_value IS NULL)>0 THEN NULL
        ELSE SUM(current_value) END AS current_value,
      BOOL_OR(stale) AS stale,MIN(marked_at) FILTER(WHERE quantity>0) AS marked_at
    FROM position_values GROUP BY username
  ) SELECT COALESCE(t.username,p.username) AS username,t.trades,t.buys,t.sells,t.tickers,t.active_days,
      t.volume,t.fees,t.invested,t.proceeds,t.first_trade,t.last_trade,p.open_positions,
      p.cost_basis,p.realized_pnl,p.current_value,p.stale,p.marked_at,
      p.username IS NOT NULL AS has_positions
    FROM trading t FULL JOIN holdings p ON p.username=t.username ORDER BY t.volume DESC NULLS LAST`, params);
  const users = rows.map(row => ({
    username: row.username, trades: n(row.trades), buys: n(row.buys), sells: n(row.sells),
    tickers: n(row.tickers), activeDays: n(row.active_days), volume: money(row.volume),
    invested: money(row.invested), proceeds: money(row.proceeds), fees: money(row.fees),
    openPositions: n(row.open_positions), costBasis: money(row.cost_basis),
    currentValue: row.has_positions && row.current_value == null ? null : money(row.current_value),
    realizedPnl: money(row.realized_pnl),
    unrealizedPnl: row.has_positions && row.current_value == null ? null : money(n(row.current_value) - n(row.cost_basis)),
    stale: row.stale === true, markedAt: row.marked_at || null,
    firstTrade: row.first_trade || null, lastTrade: row.last_trade || null,
  }));
  const participants = await client.query(`SELECT COUNT(*)::int AS count FROM (
    SELECT username FROM points_trades WHERE created_at >= $2 AND created_at <= $3
    UNION SELECT username FROM points_parlay_tickets WHERE cycle_id=$1
    UNION SELECT username FROM points_stock_trades WHERE cycle_id=$1 AND origin='user'
  ) u WHERE username<>$4`, [cycleId, startsAt, endsAt, treasury()]);
  const assets = await client.query(`WITH trading AS (
    SELECT ticker,COUNT(DISTINCT username)::int AS investors,COUNT(*)::int AS trades,
      COUNT(*) FILTER(WHERE side='buy')::int AS buys,COUNT(*) FILTER(WHERE side='sell')::int AS sells,
      SUM(gross) AS volume,MAX(created_at) AS last_trade
    FROM points_stock_trades WHERE cycle_id=$1 AND username<>$2 AND origin='user' GROUP BY ticker
  ), holdings AS (
    SELECT p.ticker,COUNT(*) FILTER(WHERE p.quantity>0)::int AS holders,
      SUM(p.quantity) AS quantity,SUM(p.cost_basis) AS cost_basis,
      SUM(p.realized_pnl) AS realized_pnl,
      CASE WHEN COUNT(*) FILTER(WHERE p.quantity>0 AND m.price_usd IS NULL AND p.current_value IS NULL)>0 THEN NULL
        ELSE SUM(CASE WHEN p.quantity=0 THEN 0 WHEN m.price_usd IS NOT NULL
          THEN TRUNC(p.quantity*m.price_usd*m.fx_rate,6) ELSE p.current_value END) END AS current_value
    FROM points_stock_positions p LEFT JOIN points_stock_cycle_marks m ON m.cycle_id=p.cycle_id AND m.ticker=p.ticker
    WHERE p.cycle_id=$1 AND p.username<>$2 GROUP BY p.ticker
  ) SELECT COALESCE(t.ticker,h.ticker) AS ticker,t.investors,t.trades,t.buys,t.sells,t.volume,t.last_trade,
    h.holders,h.quantity,h.cost_basis,h.current_value,h.realized_pnl,h.ticker IS NOT NULL AS has_positions
    FROM trading t FULL JOIN holdings h ON h.ticker=t.ticker ORDER BY t.volume DESC NULLS LAST`, params.slice(0, 2));
  const recent = await client.query(`SELECT id,username,ticker,side,origin,quantity,gross,fee,total,realized_pnl,created_at
    FROM points_stock_trades WHERE cycle_id=$1 AND username<>$2 ORDER BY created_at DESC,id DESC LIMIT $3`,
  [cycleId, treasury(), limit]);
  const summary = {
    investors: users.filter(user => user.trades > 0).length,
    activeInvestors: users.filter(user => user.lastTrade && new Date(user.lastTrade) >= new Date(now).getTime() - 86400000).length,
    holders: users.filter(user => user.openPositions > 0).length,
    participants: n(participants.rows[0]?.count),
    trades: 0, buys: 0, sells: 0, volume: 0, invested: 0, proceeds: 0, fees: 0,
    currentValue: rows.some(row => row.has_positions && row.current_value == null) ? null : money(rows.reduce((sum, row) => sum + n(row.current_value), 0)),
    costBasis: money(rows.reduce((sum, row) => sum + n(row.cost_basis), 0)),
    realizedPnl: money(rows.reduce((sum, row) => sum + n(row.realized_pnl), 0)),
    staleHolders: users.filter(user => user.openPositions > 0 && user.stale).length,
  };
  for (const key of ['trades', 'buys', 'sells', 'volume', 'invested', 'proceeds', 'fees']) {
    summary[key] = money(rows.reduce((sum, row) => sum + n(row[key]), 0));
  }
  summary.adoptionPercent = summary.participants ? money(summary.investors / summary.participants * 100) : 0;
  summary.unrealizedPnl = summary.currentValue == null ? null : money(summary.currentValue - summary.costBasis);
  return {
    available: true, summary,
    users: users.slice(0, limit), userCount: users.length,
    assets: assets.rows.map(row => ({ ticker: row.ticker, investors: n(row.investors), trades: n(row.trades),
      buys: n(row.buys), sells: n(row.sells), volume: money(row.volume), holders: n(row.holders),
      quantity: row.quantity || '0', costBasis: money(row.cost_basis), realizedPnl: money(row.realized_pnl),
      currentValue: row.has_positions && row.current_value == null ? null : money(row.current_value), lastTrade: row.last_trade })),
    recentTrades: recent.rows.map(row => ({ id: Number(row.id), username: row.username, ticker: row.ticker,
      side: row.side, origin: row.origin, quantity: row.quantity, gross: money(row.gross), fee: money(row.fee),
      total: money(row.total), realizedPnl: money(row.realized_pnl), createdAt: row.created_at })),
  };
}
