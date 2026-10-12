import { createHash, randomUUID } from 'node:crypto';
import { rows } from './stock-data.js';
import { applyStockFill, buildStockClosingFill, decimal, fixed, stockError } from './stock-math.js';
import { freezeStockCycleMarks, recordStockValuations } from './stock-marks.js';
import { configuredCycleWindowFromRow } from './points-tournament-config.js';

// Run in the caller's transaction: prices, wallet credits, audits and standings
// must either all commit or all roll back. User fills take the shared cycle lock.
export async function liquidateStockCyclePositions(db, cycle, { now = new Date(), data } = {}) {
  await db.query('SELECT id FROM points_cycles WHERE id=$1 FOR UPDATE', [cycle.id]);
  const window = configuredCycleWindowFromRow(cycle);
  if (!window) throw stockError('stock_cycle_closed', 409);
  const cutoffAt = new Date(Math.min(Date.parse(window.rankingCutoffAt), new Date(now).getTime())).toISOString();
  await freezeStockCycleMarks(db, cycle, { now, ...(data ? { data } : {}) });
  const wallets = await rows(db, `SELECT username,balance FROM points_balances WHERE username IN
    (SELECT username FROM points_stock_positions WHERE cycle_id=$1 AND quantity>0)
    ORDER BY username FOR UPDATE`, [cycle.id]);
  const balances = new Map(wallets.map(wallet => [wallet.username, fixed(wallet.balance)]));
  const positions = await rows(db, `SELECT p.*,m.price_usd,m.fx_rate,m.fx_date,m.priced_at,m.source,m.terminal
    FROM points_stock_positions p LEFT JOIN points_stock_cycle_marks m
      ON m.cycle_id=p.cycle_id AND m.ticker=p.ticker
    WHERE p.cycle_id=$1 AND p.quantity>0 ORDER BY p.username,p.ticker FOR UPDATE OF p`, [cycle.id]);
  for (const position of positions) {
    if (!position.terminal || !balances.has(position.username)) throw stockError('stock_cutoff_price_unavailable', 503);
    const fill = buildStockClosingFill(position.quantity, position);
    const updated = applyStockFill(position, fill);
    const balance = balances.get(position.username) + fixed(fill.total);
    balances.set(position.username, balance);
    const quoteId = randomUUID();
    const key = `stock_close_${cycle.id}_${position.ticker}`;
    const request = { ticker: position.ticker, side: 'sell', sellAll: true, origin: 'tournament_close', cutoffAt };
    const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const result = { ok: true, ...request, ...fill, balance: decimal(balance), position: updated,
      pricedAt: new Date(position.priced_at).toISOString(), priceSource: position.source };
    await db.query(`INSERT INTO points_stock_quotes(id,username,cycle_id,ticker,side,request,payload,expires_at,created_at)
      VALUES($1,$2,$3,$4,'sell',$5,$6,$7,$7)`, [quoteId, position.username, cycle.id, position.ticker,
      JSON.stringify(request), JSON.stringify({ fill, source: position.source }), cutoffAt]);
    const [trade] = await rows(db, `INSERT INTO points_stock_trades(username,cycle_id,ticker,side,quote_id,
      quantity,price_usd,fx_rate,fx_date,gross,fee,total,realized_pnl,idempotency_key,request_hash,result,origin,created_at)
      VALUES($1,$2,$3,'sell',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'tournament_close',$16) RETURNING id`,
    [position.username, cycle.id, position.ticker, quoteId, fill.quantity, fill.priceUsd, fill.fx.rate, fill.fx.date,
      fill.gross, fill.fee, fill.total, updated.tradePnl, key, hash, JSON.stringify(result), cutoffAt]);
    result.tradeId = trade.id;
    await db.query('UPDATE points_stock_trades SET result=$1 WHERE id=$2', [JSON.stringify(result), trade.id]);
    await db.query(`UPDATE points_stock_positions SET quantity=0,cost_basis=0,current_value=0,realized_pnl=$1,updated_at=NOW()
      WHERE username=$2 AND cycle_id=$3 AND ticker=$4`, [updated.realizedPnl, position.username, cycle.id, position.ticker]);
    await db.query(`INSERT INTO points_distributions(username,amount,kind,reference_id,reason)
      VALUES($1,$2,'stock_tournament_close',$3,$4)`, [position.username, fill.total, trade.id,
      `Simulated tournament closing sale ${position.ticker} at ${cutoffAt}`]);
  }
  for (const [username, balance] of balances) {
    await db.query('UPDATE points_balances SET balance=$1,updated_at=NOW() WHERE username=$2', [decimal(balance), username]);
  }
  await recordStockValuations(db, cycle.id, cutoffAt);
  return { cycleId: cycle.id, cutoffAt, closedPositions: positions.length };
}
