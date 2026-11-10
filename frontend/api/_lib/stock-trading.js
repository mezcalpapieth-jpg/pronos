import { createHash, randomUUID } from 'node:crypto';
import { stockAsset } from './stock-assets.js';
import { rows } from './stock-data.js';
import { applyStockFill, assertStockQuoteFresh, buildStockFill, decimal, fixed, stockError, stockPositionValue } from './stock-math.js';
import { configuredCycleWindowFromRow } from './points-tournament-config.js';
import { persistStockMarks, recordStockValuations } from './stock-marks.js';
import { readStockCycle, readStockCyclePhase, stockTradingIsPaused } from './stock-cycle.js';

async function tradingCycle(db, now) {
  // Same lock order as rollover: cycle, then wallet. A rollover cannot pass
  // this shared lock while a stock fill is debiting the old cycle's wallet.
  const cycle = await readStockCycle(db, { lock: true });
  const phase = await readStockCyclePhase(db, cycle, now);
  if (!phase || await stockTradingIsPaused(db)) throw stockError('stock_cycle_closed', 409);
  return { cycle, postCutoff: phase === 'post_cutoff' };
}

export function stockOrderRequest(body = {}) {
  const asset = stockAsset(body.ticker);
  if (!asset) throw stockError('stock_not_found', 404);
  if (!['buy', 'sell'].includes(body.side)) throw stockError('invalid_side');
  const hasAmount = body.amount != null;
  const hasQuantity = body.quantity != null;
  const sellAll = body.sellAll === true;
  if (Number(hasAmount) + Number(hasQuantity) + Number(sellAll) !== 1 || (body.side === 'buy' && sellAll)) throw stockError('invalid_amount');
  return { ticker: asset.ticker, side: body.side,
    ...(hasAmount ? { amount: decimal(fixed(body.amount)) } : {}),
    ...(hasQuantity ? { quantity: decimal(fixed(body.quantity, 18), 18) } : {}),
    ...(sellAll ? { sellAll: true } : {}) };
}

export async function createStockQuote(db, { username, request, book, now = Date.now() }) {
  if (!stockAsset(request.ticker)) throw stockError('stock_not_found', 404);
  const { cycle, postCutoff } = await tradingCycle(db, now);
  assertStockQuoteFresh(book, now);
  if (book.ticker !== request.ticker) throw stockError('invalid_quote');
  const [position] = await rows(db, `SELECT quantity FROM points_stock_positions
    WHERE username=$1 AND cycle_id=$2 AND ticker=$3 AND post_cutoff=$4`, [username, cycle.id, request.ticker, postCutoff]);
  const fill = buildStockFill({ ...request, positionQuantity: position?.quantity || '0', quote: book });
  const expiresAt = Math.min(book.bookTime, book.fetchedAt) + 10000;
  const id = randomUUID();
  await db.query(`INSERT INTO points_stock_quotes(id,username,cycle_id,ticker,side,request,payload,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, username, cycle.id, request.ticker, request.side,
    JSON.stringify(request), JSON.stringify({ book, fill, postCutoff }), new Date(expiresAt).toISOString()]);
  // Bounded maintenance; never delete quotes referenced by an audit trade.
  await db.query(`DELETE FROM points_stock_quotes WHERE id IN (
    SELECT q.id FROM points_stock_quotes q WHERE q.expires_at < NOW() - INTERVAL '1 day'
    AND NOT EXISTS(SELECT 1 FROM points_stock_trades t WHERE t.quote_id=q.id) LIMIT 100)`);
  return { quoteId: id, ticker: request.ticker, ...fill, expiresAt, bookTime: book.bookTime };
}

export async function executeStockTrade(db, { username, side, quoteId, idempotencyKey, now = Date.now() }) {
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(String(quoteId))) throw stockError('invalid_quote');
  if (!/^[a-z\d_-]{16,100}$/i.test(String(idempotencyKey))) throw stockError('invalid_idempotency_key');
  const hash = createHash('sha256').update(JSON.stringify({ side, quoteId })).digest('hex');
  async function replay() {
    const [trade] = await rows(db, `SELECT request_hash,result FROM points_stock_trades
      WHERE username=$1 AND idempotency_key=$2`, [username, idempotencyKey]);
    if (!trade) return null;
    if (trade.request_hash !== hash) throw stockError('idempotency_conflict', 409);
    return { ...trade.result, replayed: true };
  }
  const previous = await replay();
  if (previous) return previous;
  const { cycle, postCutoff } = await tradingCycle(db, now);
  const [wallet] = await rows(db, 'SELECT balance FROM points_balances WHERE username=$1 FOR UPDATE', [username]);
  if (!wallet) throw stockError('insufficient_balance');
  const retry = await replay();
  if (retry) return retry;
  const [quote] = await rows(db, 'SELECT * FROM points_stock_quotes WHERE id=$1 FOR UPDATE', [quoteId]);
  if (!quote || quote.username !== username || quote.side !== side || quote.cycle_id !== cycle.id
    || (quote.payload.postCutoff === true) !== postCutoff) throw stockError('invalid_quote', 409);
  const [used] = await rows(db, 'SELECT id FROM points_stock_trades WHERE quote_id=$1', [quoteId]);
  if (used) throw stockError('stock_quote_used', 409);
  // Recheck after lock waits, using elapsed wall time even if a test supplies now.
  const executionNow = Math.max(now, Date.now());
  const window = configuredCycleWindowFromRow(cycle);
  if (!postCutoff && executionNow >= new Date(window.operationCloseAt).getTime()) throw stockError('stock_cycle_closed', 409);
  if (executionNow >= new Date(quote.expires_at).getTime()) throw stockError('stock_quote_expired', 409);
  assertStockQuoteFresh(quote.payload.book, executionNow);
  await persistStockMarks(db, { cycleId: cycle.id, postCutoff, now: executionNow, market: {
    assets: [{ ...stockAsset(quote.ticker), available: true, priceUsd: quote.payload.book.markPriceUsd || quote.payload.fill.priceUsd }],
    fx: quote.payload.book.fx, fetchedAt: quote.payload.book.markFetchedAt || quote.payload.book.fetchedAt, stale: false,
  } });
  await db.query(`INSERT INTO points_stock_positions(username,cycle_id,ticker,post_cutoff) VALUES($1,$2,$3,$4)
    ON CONFLICT DO NOTHING`, [username, cycle.id, quote.ticker, postCutoff]);
  const [position] = await rows(db, `SELECT * FROM points_stock_positions
    WHERE username=$1 AND cycle_id=$2 AND ticker=$3 AND post_cutoff=$4 FOR UPDATE`, [username, cycle.id, quote.ticker, postCutoff]);
  const fill = buildStockFill({ ...quote.request, quote: quote.payload.book, positionQuantity: position.quantity });
  if (fill.quantity !== quote.payload.fill.quantity || fill.total !== quote.payload.fill.total) throw stockError('stock_position_changed', 409);
  const updated = applyStockFill(position, fill);
  const balance = fixed(wallet.balance) + (side === 'buy' ? -fixed(fill.total) : fixed(fill.total));
  if (balance < 0n) throw stockError('insufficient_balance');
  const result = { ok: true, ticker: quote.ticker, ...fill, balance: decimal(balance), position: updated };
  await db.query(`UPDATE points_balances SET balance=$1,updated_at=NOW() WHERE username=$2`, [result.balance, username]);
  await db.query(`UPDATE points_stock_positions SET quantity=$1,cost_basis=$2,realized_pnl=$3,updated_at=NOW()
    WHERE username=$4 AND cycle_id=$5 AND ticker=$6 AND post_cutoff=$7`, [updated.quantity, updated.costBasis, updated.realizedPnl, username, cycle.id, quote.ticker, postCutoff]);
  const markPrice = quote.payload.book.markPriceUsd || fill.priceUsd;
  await db.query(`UPDATE points_stock_positions SET current_value=$1,mark_price_usd=$2,marked_at=$3
    WHERE username=$4 AND cycle_id=$5 AND ticker=$6 AND post_cutoff=$7`,
  [stockPositionValue(updated.quantity, markPrice, fill.fx.rate), markPrice, new Date(executionNow).toISOString(), username, cycle.id, quote.ticker, postCutoff]);
  if (!postCutoff) {
    await db.query(`INSERT INTO points_stock_valuations(username,cycle_id,sampled_at,current_value,cost_basis,realized_pnl)
      VALUES($1,$2,$3,0,0,0) ON CONFLICT DO NOTHING`, [username, cycle.id, cycle.started_at]);
  }
  await recordStockValuations(db, cycle.id, new Date(executionNow).toISOString(), { postCutoff, username });
  const [trade] = await rows(db, `INSERT INTO points_stock_trades(username,cycle_id,ticker,side,quote_id,
    quantity,price_usd,fx_rate,fx_date,gross,fee,total,realized_pnl,idempotency_key,request_hash,result,post_cutoff,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
  [username, cycle.id, quote.ticker, side, quoteId, fill.quantity, fill.priceUsd, fill.fx.rate, fill.fx.date,
    fill.gross, fill.fee, fill.total, updated.tradePnl, idempotencyKey, hash, JSON.stringify(result), postCutoff, new Date(executionNow).toISOString()]);
  result.tradeId = trade.id;
  await db.query('UPDATE points_stock_trades SET result=$1 WHERE id=$2', [JSON.stringify(result), trade.id]);
  await db.query(`INSERT INTO points_distributions(username,amount,kind,reference_id,reason)
    VALUES($1,$2,$3,$4,$5)`, [username, updated.balanceDelta, `stock_${side}`, trade.id, `Simulated ${side} ${quote.ticker}`]);
  return result;
}
