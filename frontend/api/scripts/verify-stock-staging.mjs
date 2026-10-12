// Multi-connection integration checks. Run only on an explicit disposable staging branch.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { withTransaction } from '../_lib/db-tx.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { ensureStockSchema } from '../_lib/stock-schema.js';
import { createStockData } from '../_lib/stock-data.js';
import { createStockQuote, executeStockTrade, stockOrderRequest } from '../_lib/stock-trading.js';
import { readStockTournamentRows, snapshotStockValuations } from '../_lib/stock-marks.js';
import { readStockPortfolio } from '../_lib/stock-portfolio.js';
import { liquidateStockCyclePositions } from '../_lib/stock-liquidation.js';
import { configuredCycleWindowFromRow } from '../_lib/points-tournament-config.js';
import { decimal, fixed, parseSignedMoney } from '../_lib/stock-math.js';

const host=new URL(process.env.DATABASE_URL).hostname;
if (!process.env.STOCK_STAGING_BRANCH_ID || !process.env.STOCK_STAGING_HOST || host!==process.env.STOCK_STAGING_HOST
    || process.env.VERCEL_ENV || process.env.POINTS_STOCKS_ENABLED!=='true') throw new Error('Explicit isolated staging configuration required.');
const sql=neon(process.env.DATABASE_URL); await ensurePointsSchema(sql); await ensureStockSchema(withTransaction);
const data=createStockData(sql);
const prefix=`stockcheck_${randomUUID().slice(0,8)}`;
process.env.POINTS_TREASURY_USERNAME=`${prefix}_treasury`;
const {executePointsBuy}=await import('../_lib/points-trading-service.js');
const names=['budget','mixed','retry','flow','reset'].map(suffix=>`${prefix}_${suffix}`);
const [budget,mixed,retry,flow,reset]=names;
const cycleIds=[]; let marketId; let checked=0;
const pids=new Set();
async function transaction(fn) { return withTransaction(async db=>{
  pids.add((await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  return fn(db);
}); }
async function quote(username,request) {
  const book=await data.book('NVDA', { fresh: true });
  return transaction(db=>createStockQuote(db,{username,request:stockOrderRequest({ticker:'NVDA',...request}),book}));
}
const trade=(username,q,key=randomUUID())=>transaction(db=>executeStockTrade(db,{username,side:q.side,quoteId:q.quoteId,idempotencyKey:key}));
const balance=async username=>fixed((await sql.query('SELECT balance FROM points_balances WHERE username=$1',[username]))[0].balance);
function oneWinner(results) {
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const rejected=results.find(r=>r.status==='rejected').reason;
  assert.equal(rejected.code||rejected.message,'insufficient_balance');
}
try {
  const [cycle]=await sql.query(`INSERT INTO points_cycles(label,started_at,ends_at,status)
    SELECT $1,NOW()-INTERVAL '60 days',GREATEST(MAX(ends_at),NOW())+INTERVAL '40 days','active' FROM points_cycles RETURNING *`,[prefix]);
  cycleIds.push(cycle.id);
  for (const name of names) {
    await sql.query('INSERT INTO points_users(turnkey_sub_org_id,username,email) VALUES($1,$2,$3)',[name,name,`${name}@example.invalid`]);
    await sql.query('INSERT INTO points_balances(username,balance) VALUES($1,$2)',[name,['retry','flow','reset'].some(s=>name.endsWith(s))?1000:500]);
  }
  [ {id:marketId} ]=await sql.query(`INSERT INTO points_markets(question,outcomes,reserves,seed_liquidity,end_time,start_time,created_by,tournament_featured,is_test_market)
    VALUES($1,'["Sí","No"]','[500,500]',500,NOW()+INTERVAL '1 hour',NOW()-INTERVAL '1 hour',$2,TRUE,TRUE) RETURNING id`,[`${prefix} concurrency fixture`,prefix]);
  const [q1,q2]=await Promise.all([quote(budget,{side:'buy',amount:'400'}),quote(budget,{side:'buy',amount:'400'})]);
  oneWinner(await Promise.allSettled([trade(budget,q1),trade(budget,q2)]));
  assert.ok(await balance(budget)>=0n); checked++; console.log('PASS competing stock purchases');

  const qMixed=await quote(mixed,{side:'buy',amount:'400'});
  oneWinner(await Promise.allSettled([trade(mixed,qMixed),transaction(db=>executePointsBuy(db,{username:mixed,marketId,outcomeIndex:0,collateral:400}))]));
  assert.ok(await balance(mixed)>=0n); checked++; console.log('PASS stock versus prediction purchase');

  const qRetry=await quote(retry,{side:'buy',amount:'400'}), key=randomUUID();
  const duplicates=await Promise.all([trade(retry,qRetry,key),trade(retry,qRetry,key)]);
  assert.equal(duplicates[0].tradeId,duplicates[1].tradeId);
  assert.equal(duplicates.filter(r=>r.replayed).length,1); console.log('PASS duplicate retry');
  const [s1,s2]=await Promise.all([quote(retry,{side:'sell',sellAll:true}),quote(retry,{side:'sell',sellAll:true})]);
  const sales=await Promise.allSettled([trade(retry,s1),trade(retry,s2)]);
  assert.equal(sales.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(['insufficient_stock_quantity','stock_position_changed'].includes(sales.find(r=>r.status==='rejected').reason.code));
  assert.equal((await sql.query('SELECT COUNT(*)::int n FROM points_stock_trades WHERE username=$1',[retry]))[0].n,2); checked+=2; console.log('PASS simultaneous sell-all');

  const initial=await balance(flow),purchase=await trade(flow,await quote(flow,{side:'buy',amount:'400'}));
  const book=await data.book('NVDA');
  const partial=decimal(fixed(purchase.quantity,book.szDecimals)/2n,book.szDecimals);
  await trade(flow,await quote(flow,{side:'sell',quantity:partial}));
  await trade(flow,await quote(flow,{side:'sell',sellAll:true}));
  const portfolio=await transaction(db=>readStockPortfolio(db,{username:flow,market:null}));
  const scores=await readStockTournamentRows(sql,{window:configuredCycleWindowFromRow(cycle),enabled:true});
  assert.equal(portfolio.positions.length,0); assert.equal(portfolio.trades.length,3);
  assert.equal(fixed(portfolio.summary.realizedPnl<0?-portfolio.summary.realizedPnl:portfolio.summary.realizedPnl),
    (await balance(flow)-initial)<0n?initial-await balance(flow):await balance(flow)-initial);
  assert.equal(scores.scores.get(flow).pnl,portfolio.summary.realizedPnl); checked++; console.log('PASS partial/full sale accounting');

  await trade(reset,await quote(reset,{side:'buy',amount:'400'}));
  const pending=await quote(reset,{side:'sell',sellAll:true});
  let locked,waiting;
  const lockedPromise=new Promise(resolve=>{locked=resolve;});
  const waitingPromise=new Promise(resolve=>{waiting=resolve;});
  const rollover=transaction(async db=>{
    await db.query('SELECT id FROM points_cycles WHERE id=$1 FOR UPDATE',[cycle.id]); locked();
    await waitingPromise;
    const closing=await liquidateStockCyclePositions(db,cycle,{data});
    assert.ok(closing.closedPositions>0);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_stock_positions WHERE cycle_id=$1 AND quantity>0',[cycle.id])).rows[0].n,0);
    const [settled]=(await db.query('SELECT SUM(realized_pnl)::text AS pnl FROM points_stock_positions WHERE username=$1 AND cycle_id=$2',[reset,cycle.id])).rows;
    const [cash]=(await db.query('SELECT balance FROM points_balances WHERE username=$1',[reset])).rows;
    const delta=fixed(cash.balance)-1000000000n;
    assert.equal(parseSignedMoney(settled.pnl),delta);
    const activity=await readStockTournamentRows(db,{window:configuredCycleWindowFromRow(cycle),enabled:true});
    assert.equal(activity.activity.get(reset).total_actions,1);
    assert.equal(activity.activity.get(reset).active_day_keys.length,1);
    assert.equal((await liquidateStockCyclePositions(db,cycle,{data})).closedPositions,0);
    await db.query("UPDATE points_cycles SET status='closed',closed_at=NOW() WHERE id=$1",[cycle.id]);
    const next=(await db.query(`INSERT INTO points_cycles(label,started_at,ends_at,status) VALUES($1,NOW(),$2,'active') RETURNING id`,[`${prefix}_next`,new Date(new Date(cycle.ends_at).getTime()+86400000)])).rows[0];
    cycleIds.push(next.id);
    await db.query('UPDATE points_balances SET balance=500 WHERE username=$1',[reset]);
  });
  await lockedPromise;
  const queued=transaction(db=>executeStockTrade({query:(text,params)=>{
    if(text.includes('FROM points_cycles')) waiting();
    return db.query(text,params);
  }},{username:reset,side:'sell',quoteId:pending.quoteId,idempotencyKey:randomUUID()}));
  await rollover;
  await assert.rejects(queued,error=>['invalid_quote','stock_cycle_closed'].includes(error.code));
  assert.equal(await balance(reset),500000000n);
  const fresh=await transaction(db=>readStockPortfolio(db,{username:reset,market:null}));
  assert.equal(fresh.positions.length,0);assert.equal(fresh.summary.tournamentPnl,0);
  assert.equal((await trade(retry,qRetry,key)).tradeId,duplicates[0].tradeId); checked++; console.log('PASS automatic liquidation, reset contention and committed retry');
  await transaction(db=>snapshotStockValuations(db,{market:{...book,assets:[{ticker:'NVDA',available:true,priceUsd:book.markPriceUsd}],stale:false}}));
  assert.ok(pids.size>=2,'checks must use independent Postgres connections');
  console.log(JSON.stringify({ok:true,checks:checked,independentConnections:pids.size,branchId:process.env.STOCK_STAGING_BRANCH_ID,
    cases:['competing stock buys','stock versus prediction buy','duplicate retry','simultaneous sell-all','partial/full sell PnL and audit','automatic liquidation, cycle-lock/reset contention and no carried holdings']}));
} catch(error) {
  console.error('FAIL staging check',{completed:checked,code:error.code,message:error.message}); throw error;
} finally {
  // Only remove identifiers created by this run; cloned production rows are untouched.
  await withTransaction(async db=>{
    await db.query('SELECT id FROM points_cycles WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',[cycleIds]);
    for(const table of ['points_stock_trades','points_stock_quotes','points_stock_positions','points_stock_valuations','points_distributions','points_trades','points_positions','points_balances','points_users']) {
      await db.query(`DELETE FROM ${table} WHERE username=ANY($1::text[])`,[[...names,`${prefix}_treasury`]]);
    }
    if(marketId){await db.query('DELETE FROM points_price_snapshots WHERE market_id=$1',[marketId]);await db.query('DELETE FROM points_markets WHERE id=$1 AND created_by=$2',[marketId,prefix]);}
    await db.query('DELETE FROM points_stock_cycle_marks WHERE cycle_id=ANY($1::int[])',[cycleIds]);
    await db.query('DELETE FROM points_stock_valuations WHERE cycle_id=ANY($1::int[])',[cycleIds]);
    await db.query('DELETE FROM points_cycles WHERE id=ANY($1::int[]) AND label LIKE $2',[cycleIds,`${prefix}%`]);
  });
}
process.exit(0);
