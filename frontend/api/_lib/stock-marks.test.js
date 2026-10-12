import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { STOCK_SCHEMA_MIGRATIONS } from './stock-schema.js';
import { persistStockMarks, snapshotStockValuations, freezeStockCycleMarks, readStockTournamentRows } from './stock-marks.js';
import { createStockQuote, executeStockTrade, stockOrderRequest } from './stock-trading.js';
import { readStockPortfolio } from './stock-portfolio.js';
import { configuredCycleWindowFromRow } from './points-tournament-config.js';
import { buildTournamentLeaderboardRows } from './points-tournament-leaderboard.js';
import { buildWalletLeaderboardRows } from './points-wallet-leaderboard.js';
import { snapshotCycleLeaderboard } from './points-cycle-snapshot.js';

async function setup(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`CREATE TABLE points_cycles(id SERIAL PRIMARY KEY,label TEXT,started_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,status TEXT,closed_at TIMESTAMPTZ);
    CREATE TABLE points_users(username TEXT PRIMARY KEY,created_at TIMESTAMPTZ,profile_image_url TEXT);
    CREATE TABLE points_app_settings(key TEXT PRIMARY KEY,value JSONB);
    CREATE TABLE points_balances(username TEXT PRIMARY KEY,balance NUMERIC(20,6),updated_at TIMESTAMPTZ);
    CREATE TABLE points_distributions(id SERIAL PRIMARY KEY,username TEXT,amount NUMERIC(20,6),kind TEXT,reference_id INTEGER,reason TEXT);
    INSERT INTO points_cycles(label,started_at,ends_at,status) VALUES('Test',NOW()-INTERVAL '60 days',NOW()+INTERVAL '1 day','active');
    INSERT INTO points_app_settings VALUES('points_cycles_paused','false');
    INSERT INTO points_users VALUES('holder',NOW(),NULL),('offline',NOW(),NULL);
    INSERT INTO points_balances VALUES('holder',10000,NOW()),('offline',10000,NOW());`);
  for (const statement of STOCK_SCHEMA_MIGRATIONS) await db.exec(statement);
  const cycle = (await db.query('SELECT * FROM points_cycles')).rows[0];
  const fx = { rate: '20', date: new Date().toISOString().slice(0,10) };
  const market = (price,at=Date.now()) => ({ assets:[{ticker:'AAPL',available:true,priceUsd:String(price)}],fx,fetchedAt:at,stale:false });
  const trade = async (request,price='100',username='holder') => {
    const now=Date.now();
    const book={ticker:'AAPL',szDecimals:3,markPriceUsd:price,bookTime:now,fetchedAt:now,fx,
      levels:[[{px:price,sz:'1000'}],[{px:price,sz:'1000'}]]};
    const quote=await db.transaction(tx=>createStockQuote(tx,{username,request:stockOrderRequest({ticker:'AAPL',...request}),book}));
    return db.transaction(tx=>executeStockTrade(tx,{username,side:request.side,quoteId:quote.quoteId,idempotencyKey:crypto.randomUUID()}));
  };
  const scores = () => readStockTournamentRows(db,{window:configuredCycleWindowFromRow(cycle),enabled:true});
  return {db,cycle,fx,market,trade,scores};
}

test('stock PnL follows holdings, partial sales, full sales and reinvestment exactly once after fees', async t => {
  const {db,trade,market,scores}=await setup(t);
  await trade({side:'buy',amount:'500'});
  assert.equal((await scores()).scores.get('holder').pnl,-0.498);
  await db.transaction(tx=>snapshotStockValuations(tx,{market:market('110')}));
  assert.equal((await scores()).scores.get('holder').pnl,49.302);
  await trade({side:'sell',quantity:'0.1'},'110');
  assert.equal((await scores()).scores.get('holder').pnl,49.082);
  await trade({side:'sell',sellAll:true},'110');
  let row=(await scores()).scores.get('holder');
  assert.equal(row.pnl,48.7542); assert.equal(row.currentValue,0);
  const wallet=(await db.query("SELECT balance FROM points_balances WHERE username='holder'")).rows[0];
  assert.equal(wallet.balance,'10048.754200');
  await trade({side:'buy',amount:'500'},'110');
  row=(await scores()).scores.get('holder');
  assert.equal(row.pnl,48.2548);
  const history=await db.transaction(tx=>readStockPortfolio(tx,{username:'holder',market:market('110')}));
  assert.equal(history.summary.pnl,48.2548);
  assert.equal(history.trades.length,4);
});

test('scheduled marks value offline holders consistently and wallet rank includes their holdings', async t => {
  const {db,cycle,market,trade,scores}=await setup(t);
  await trade({side:'buy',amount:'500'});
  await trade({side:'buy',amount:'500'},'100','offline');
  const at=Date.now();
  await db.transaction(tx=>snapshotStockValuations(tx,{market:market('110',at),now:at}));
  const {scores:rows}=await scores();
  assert.equal(rows.get('holder').pnl,rows.get('offline').pnl);
  assert.equal(rows.get('offline').currentValue,547.8);
  assert.equal(rows.get('offline').stale,false);
  const samples=(await db.query('SELECT username,current_value FROM points_stock_valuations WHERE sampled_at=date_trunc(\'minute\',$1::timestamptz) ORDER BY username',[new Date(at).toISOString()])).rows;
  assert.deepEqual(samples.map(row=>row.current_value),['547.800000','547.800000']);
  const wallet=await buildWalletLeaderboardRows(db,{stockCycleId:cycle.id});
  assert.equal(wallet[0].walletEquity,10049.3);
  assert.equal(wallet[0].balance,9501.5);
  const delayed=await readStockTournamentRows(db,{window:configuredCycleWindowFromRow(cycle),enabled:true,now:at+90001});
  assert.equal(delayed.scores.get('offline').stale,true);
});

test('stocks add to tournament score and activity but do not replace prediction qualification', async t => {
  const {db,cycle,market,trade}=await setup(t);
  await trade({side:'buy',amount:'500'});
  await db.transaction(tx=>snapshotStockValuations(tx,{market:market('110')}));
  const old=process.env.POINTS_STOCKS_ENABLED; process.env.POINTS_STOCKS_ENABLED='true';
  t.after(()=>{if(old==null)delete process.env.POINTS_STOCKS_ENABLED;else process.env.POINTS_STOCKS_ENABLED=old;});
  // Stock accounting uses real SQL; empty prediction fixtures isolate its score contribution.
  const adapter={query:(sql,params)=> /FROM points_(?:trades|positions|parlay_tickets|distributions)\b/.test(sql)
    ? Promise.resolve({rows:[]}) : db.query(sql,params)};
  const ranked=await buildTournamentLeaderboardRows(adapter,{window:configuredCycleWindowFromRow(cycle),now:new Date(Date.now()+86400000)});
  const holder=ranked.find(row=>row.username==='holder');
  assert.equal(holder.stockPnl,49.3); assert.equal(holder.tradingPnl,49.3);
  assert.equal(holder.score,Number((holder.stockPnl-holder.inactivityPenalty).toFixed(2)));
  assert.equal(holder.totalActions,1); assert.equal(holder.activeDays,1);
  assert.equal(holder.qualifyingMarkets,0); assert.equal(holder.qualified,false);
  assert.equal(holder.convictionBonus,0);
});

test('cutoff marks are immutable, previous holdings are frozen and another cycle cannot inherit their PnL', async t => {
  const {db,cycle,fx,trade,scores}=await setup(t);
  await trade({side:'buy',amount:'500'});
  const at=Date.now();
  await db.transaction(tx=>freezeStockCycleMarks(tx,cycle,{now:new Date(at),data:{cutoff:async()=>({
    assets:[{ticker:'AAPL',available:true,priceUsd:'120',pricedAt:at-1}],fx,stale:false,fetchedAt:at,
  })}}));
  await db.transaction(tx=>persistStockMarks(tx,{cycleId:cycle.id,market:{assets:[{ticker:'AAPL',available:true,priceUsd:'999'}],fx,stale:false,fetchedAt:at+1},now:at+1}));
  assert.equal((await scores()).scores.get('holder').pnl,99.102);
  await db.exec("UPDATE points_cycles SET status='closed',closed_at=NOW(); INSERT INTO points_cycles(label,started_at,ends_at,status) VALUES('Next',NOW(),NOW()+INTERVAL '30 days','active');");
  const previous=await db.transaction(tx=>readStockPortfolio(tx,{username:'holder',scope:'previous'}));
  assert.equal(previous.stale,false); assert.equal(previous.positions[0].terminal,true);
  assert.equal(previous.summary.pnl,99.102);
  const current=(await db.query("SELECT * FROM points_cycles WHERE status='active'")).rows[0];
  assert.equal((await readStockTournamentRows(db,{window:configuredCycleWindowFromRow(current),enabled:true})).scores.size,0);
});

test('a missing cutoff price aborts without freezing prices or losing open holdings', async t => {
  const {db,cycle,trade}=await setup(t); await trade({side:'buy',amount:'500'});
  await assert.rejects(db.transaction(tx=>freezeStockCycleMarks(tx,cycle,{data:{cutoff:async()=>{throw Object.assign(new Error('outage'),{code:'stock_cutoff_price_unavailable'});}}})),{code:'stock_cutoff_price_unavailable'});
  assert.equal((await db.query('SELECT terminal FROM points_stock_cycle_marks')).rows[0].terminal,false);
  assert.equal((await db.query('SELECT quantity FROM points_stock_positions')).rows[0].quantity,'0.249000000000000000');
});

test('the tournament photo saves stock breakdowns once and reuses them after holdings change', async t => {
  const {db,cycle,fx,trade}=await setup(t); await trade({side:'buy',amount:'500'});
  await db.exec(`CREATE TABLE points_cycle_snapshots (
    cycle_id INTEGER,username TEXT,final_balance NUMERIC,final_pnl NUMERIC,rank INTEGER,
    tournament_score NUMERIC,market_pnl NUMERIC,current_position_value NUMERIC,hold_bonus NUMERIC,
    liquidity_reward NUMERIC,parlay_pnl NUMERIC,parlay_tickets INTEGER,parlay_wins INTEGER,
    conviction_bonus_gross NUMERIC,conviction_bonus_cap_applied NUMERIC,conviction_eligible_profit NUMERIC,
    conviction_markets INTEGER,conviction_lots INTEGER,inactivity_penalty NUMERIC,inactive_days INTEGER,
    active_days INTEGER,qualifying_markets INTEGER,qualified BOOLEAN,PRIMARY KEY(cycle_id,username));`);
  for(const statement of STOCK_SCHEMA_MIGRATIONS.filter(s=>s.startsWith('ALTER TABLE')))await db.exec(statement);
  const at=Date.now();
  await db.transaction(tx=>freezeStockCycleMarks(tx,cycle,{now:new Date(at),data:{cutoff:async()=>({
    assets:[{ticker:'AAPL',available:true,priceUsd:'120',pricedAt:at-1}],fx,stale:false,fetchedAt:at,
  })}}));
  const old=process.env.POINTS_STOCKS_ENABLED;process.env.POINTS_STOCKS_ENABLED='true';
  t.after(()=>{if(old==null)delete process.env.POINTS_STOCKS_ENABLED;else process.env.POINTS_STOCKS_ENABLED=old;});
  const adapter=tx=>({query:(sql,params)=>/FROM points_(?:trades|positions|parlay_tickets|distributions)\b/.test(sql)?Promise.resolve({rows:[]}):tx.query(sql,params)});
  const first=await db.transaction(tx=>snapshotCycleLeaderboard(adapter(tx),cycle,{now:new Date(at)}));
  const holder=first.find(row=>row.username==='holder');
  assert.equal(holder.stockPnl,99.1);assert.equal(holder.stockPositionValue,597.6);
  assert.equal(holder.stockStale,false);assert.equal(holder.tradingPnl,99.1);
  await db.query("UPDATE points_stock_positions SET quantity=0,cost_basis=0,realized_pnl=0 WHERE username='holder'");
  const second=await db.transaction(tx=>snapshotCycleLeaderboard(adapter(tx),cycle));
  assert.deepEqual(second,first);
});

test('an unknown holding value fails scoring instead of fabricating zero PnL',async t=>{
  const {db,scores}=await setup(t);
  await db.query("INSERT INTO points_stock_positions(username,cycle_id,ticker,quantity,cost_basis) VALUES('holder',1,'AAPL',1,100)");
  await assert.rejects(scores(),{code:'stock_valuation_unavailable',status:503});
});
