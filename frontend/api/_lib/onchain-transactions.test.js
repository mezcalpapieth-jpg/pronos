import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { collectOnchainTransactions,transactionFilters } from './onchain-transactions.js';
import { onchainOperationsSettings } from './onchain-operations.js';
import { TRADE_REQUEST_SCHEMA } from './trade-request-store.js';
import { SEPOLIA_GAS_SCHEMA } from './sepolia-gas-store.js';
import { requirePointsAdmin } from './points-admin.js';
import { createSessionToken } from './session.js';
import { applyCors } from './cors.js';

const wallet=`0x${'1'.repeat(40)}`,other=`0x${'2'.repeat(40)}`,pool=`0x${'3'.repeat(40)}`,otherPool=`0x${'4'.repeat(40)}`;
const hash=n=>`0x${n.toString(16).padStart(64,'0')}`;
const now=Date.parse('2026-10-21T12:00:00.000Z'),at='2020-10-20T10:00:00.123456Z';
const env={ ONCHAIN_DURABLE_TRADES_ENABLED:'true',ONCHAIN_PREVIEW_APPROVALS_ENABLED:'true',VERCEL_ENV:'preview',
  VERCEL_GIT_COMMIT_REF:'onchain-sepolia',ONCHAIN_CHAIN_ID:'421614',ONCHAIN_RPC_URL:'http://never-called',
  DATABASE_URL:'postgresql://unused@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb' };

async function fixture(t) {
  const db=new PGlite();t.after(()=>db.close());
  for (const ddl of [...TRADE_REQUEST_SCHEMA,...SEPOLIA_GAS_SCHEMA]) await db.exec(ddl);
  await db.exec(`CREATE TABLE protocol_markets (id int PRIMARY KEY,chain_id int,question text,pool_address text);
    CREATE TABLE points_users (id serial PRIMARY KEY,username text,wallet_address text,email text);
    CREATE TABLE trades (id serial PRIMARY KEY,market_id int,trader text,side text,is_yes boolean,outcome_index int,
      collateral_amt numeric(20,6),shares_amt numeric(20,6),fee_amt numeric(20,6),tx_hash text,created_at timestamptz);
    CREATE TABLE redemptions (id serial PRIMARY KEY,market_id int,user_address text,outcome_index int,
      payout numeric(20,6),shares numeric(20,6),tx_hash text,created_at timestamptz);`);
  await db.query("INSERT INTO protocol_markets VALUES (1,421614,'Yes or no?', $1),(2,421614,'50%_literal', $2),(3,1,'Other chain', $2)",[pool,otherPool]);
  await db.query("INSERT INTO points_users (username,wallet_address,email) VALUES ('alice',$1,'private-email'),('bob',$2,'private-email')",[wallet,other]);
  const f={ db,env:{ ...env },queries:[],counter:0 };
  f.sql=async (parts,...values)=>{
    const query=parts.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,'');f.queries.push(query);
    return (await db.query(query,values)).rows;
  };
  f.read=query=>collectOnchainTransactions({ sql:f.sql,env:f.env,query,now });
  f.trade=async ({ action='buy',owner=wallet,market=1,txHash=hash(++f.counter),date=at }={})=>{
    await db.query('INSERT INTO trades (market_id,trader,side,is_yes,outcome_index,collateral_amt,shares_amt,fee_amt,tx_hash,created_at) VALUES ($1,$2,$3,true,0,5,9,0.25,$4,$5)',[market,owner,action,txHash,date]);
    return txHash;
  };
  f.request=async ({ status='pending',action='buy',owner=wallet,txHash=hash(++f.counter),steps=[],date=at,market=1 }={})=>{
    const id=randomUUID();
    await db.query(`INSERT INTO sepolia_trade_requests
      (id,chain_id,wallet_address,suborg_id,request_key,action,payload_hash,payload,plan,status,result,created_at,updated_at)
      VALUES ($1,421614,$2,'private-suborg',$3,$4,'private-hash',$5::jsonb,$6::jsonb,$7,'{"private":"result"}',$8,$8)`,
    [id,owner,`private-key-${id}`,action,JSON.stringify({ marketId:market,outcomeIndex:0,collateral:5,shares:2,amount:1,quoteReference:'private-quote' }),
      JSON.stringify({ market:{ chain_address:market===1?pool:otherPool },private:'private-plan' }),status,date]);
    for (const step of steps) {
      await db.query(`INSERT INTO sepolia_trade_transactions (request_id,step,chain_id,wallet_address,nonce,unsigned_tx,tx_hash,signed_tx,status,receipt)
        VALUES ($1,$2,421614,$3,$4,'private-unsigned',$5,$6,$7,$8::jsonb)`,
      [id,step.name||'trade',owner,++f.counter,step.status==='reserved'?null:step.hash||txHash,step.status==='reserved'?null:'private-signed',step.status||'confirmed',
        step.receipt===undefined?JSON.stringify({ blockNumber:100,gasUsed:{type:'BigNumber',hex:'0x5208'},effectiveGasPrice:{type:'BigNumber',hex:'0x05f5e100'},private:'private-receipt' }):JSON.stringify(step.receipt)]);
    }
    return { id,txHash };
  };
  f.gas=async ({ status='confirmed',owner=wallet }={})=>{
    await db.query(`INSERT INTO sepolia_gas_transfers VALUES ($1,421614,$2,$3,'private-suborg','private-signer',50000000000000,90000000000000,$4,'private-signed',$5,$6,$6)`,
      [hash(++f.counter),other,owner,f.counter,status,at]);
  };
  return f;
}

test('unified history includes successful, pending and failed requests, legacy trades/redemptions and top-ups once',async t=>{
  const f=await fixture(t),txHash=hash(100);
  await f.request({ status:'confirmed',txHash,steps:[{ name:'collateral_approval',hash:hash(101) },{ name:'trade' }] });
  await f.trade({ txHash });
  await f.request({ status:'pending',action:'sell',steps:[{status:'signed',receipt:null}] });
  await f.request({ status:'rejected',action:'redeem' });
  await f.trade({owner:other});
  await f.db.query('INSERT INTO redemptions (market_id,user_address,outcome_index,payout,shares,tx_hash,created_at) VALUES (1,$1,0,8,8,$2,$3)',[wallet,hash(150),at]);
  await f.gas();
  const report=await f.read();assert.equal(report.items.length,6);assert.equal(report.nextCursor,null);
  const done=report.items.find(r=>r.txHash===txHash);
  assert.equal(done.source,'request');assert.equal(done.username,'alice');assert.equal(done.indexed,true);
  assert.deepEqual(done.executed,{ collateral:'5.000000',shares:'9.000000',fee:'0.250000' });
  assert.equal(done.receiptFeeEth,'0.0000042');assert.equal(done.steps.length,2);
  const pending=report.items.find(r=>r.action==='sell');assert.equal(pending.status,'pending');assert.equal(pending.executed,null);assert.equal(pending.receiptFeeEth,null);
  const rejected=report.items.find(r=>r.requestState==='rejected');assert.equal(rejected.status,'failed');assert.equal(rejected.txHash,null);assert.equal(rejected.executed,null);
  const redemption=report.items.find(r=>r.id.startsWith('redemption:'));assert.equal(redemption.executed.collateral,'8.000000');assert.equal(redemption.executed.fee,null);
  const gas=report.items.find(r=>r.action==='gas_topup');assert.deepEqual(gas.requested,{amount:'0.00005',unit:'ETH'});assert.equal(gas.budgetMaxCostEth,'0.00009');assert.equal(gas.receiptFeeEth,null);
  assert.equal(gas.indexed,null);assert.equal(gas.steps[0].step,'gas_transfer');
  assert.ok(f.queries.every(q=>/^\s*WITH\b/.test(q)&&!/signed_tx|unsigned_tx|SELECT\s+\*/i.test(q)));
  assert.doesNotMatch(JSON.stringify(report),/private-|suborg|signer_key|quoteReference|payload_hash|unsigned_tx|signed_tx|email/);
});

test('matching requires chain, pool, wallet and action; confirmed-unindexed stays explicit',async t=>{
  const f=await fixture(t),txHash=hash(100);
  await f.request({status:'confirmed',txHash,steps:[{}]});
  await f.trade({txHash,owner:other});await f.trade({txHash,market:2});await f.trade({txHash,action:'sell'});await f.trade({txHash,market:3});
  let report=await f.read();assert.equal(report.items.length,4);assert.equal(report.items.find(r=>r.source==='request').indexed,false);
  assert.equal((await f.read({status:'awaiting_indexing'})).items.length,1);
  await f.trade({txHash});report=await f.read();assert.equal(report.items.length,4);assert.equal(report.items.find(r=>r.source==='request').indexed,true);
  assert.equal((await f.read({status:'awaiting_indexing'})).items.length,0);
  assert.ok(report.items.every(r=>r.market?.id!==3));
});

test('all filters are applied before pagination, SQL wildcards are literal, UTC date endpoints are inclusive days',async t=>{
  const f=await fixture(t);
  await f.trade({date:'2020-10-20T23:59:59.999999Z'});await f.trade({date:'2020-10-21T00:00:00.000000Z'});
  const tx=await f.trade({owner:other,market:2,action:'sell'});await f.gas({status:'reverted'});
  await f.db.exec("SET TIME ZONE 'America/Mexico_City'");
  assert.equal((await f.read({username:'@ALICE',from:'2020-10-20',to:'2020-10-20',action:'buy'})).items.length,1);
  assert.equal((await f.read({wallet:other.toUpperCase().replace('0X','0x'),market:'50%_literal',action:'sell',status:'indexed',tx})).items.length,1);
  assert.equal((await f.read({market:'%_'})).items.length,1);
  assert.equal((await f.read({market:'2'})).items.length,1);
  assert.equal((await f.read({status:'failed',action:'gas_topup'})).items[0].requestState,'reverted');
  assert.equal((await f.read({username:"x' OR 1=1 --"})).items.length,0);
  assert.equal((await f.read({wallet:pool})).items.length,0);
});

test('approval hashes are searchable and nonce conflicts outrank a stored pending state',async t=>{
  const f=await fixture(t),approval=hash(100);
  await f.request({steps:[{name:'share_approval',hash:approval,status:'needs_reconciliation'}]});
  const report=await f.read({tx:approval,status:'needs_reconciliation'});
  assert.equal(report.items.length,1);assert.equal(report.items[0].status,'needs_reconciliation');assert.equal(report.items[0].requestState,'pending');
});

test('stable keyset pagination retains timestamp microseconds, has no duplicates and binds cursors to filters',async t=>{
  const f=await fixture(t);
  for(let i=0;i<61;i++) await f.trade({date:i%2?at:'2020-10-20T10:00:00.123457Z'});
  const ids=[],pages=[];let cursor;
  do { const page=await f.read(cursor?{cursor}:{});pages.push(page);ids.push(...page.items.map(r=>r.id));cursor=page.nextCursor; } while(cursor);
  assert.deepEqual(pages.map(p=>p.items.length),[25,25,11]);assert.equal(new Set(ids).size,61);
  assert.match(pages[0].items[0].occurredAt,/\.123457Z$/);
  assert.ok(pages.every(p=>p.asOf===pages[0].asOf));
  assert.throws(()=>transactionFilters({cursor:pages[0].nextCursor},now+16*60*1000),/invalid_transaction_filters/);
  await assert.rejects(f.read({cursor:pages[0].nextCursor,username:'bob'}),/invalid_transaction_filters/);
  const future=JSON.parse(Buffer.from(pages[0].nextCursor,'base64url').toString());future.asOf='2099-01-01T00:00:00.000Z';
  assert.throws(()=>transactionFilters({cursor:Buffer.from(JSON.stringify(future)).toString('base64url')},now),/invalid_transaction_filters/);
  await f.trade({date:'2026-10-21T12:01:00.000Z'});
  assert.equal((await f.read({cursor:pages[1].nextCursor})).items.length,11);
});

test('invalid/expired cursors and filters cannot reach the database',async()=>{
  for(const query of [{wallet:'bad'}, {tx:'0x123'}, {action:'approve'}, {status:'ok'}, {username:['alice','bob']},
    {from:'2026-02-30'}, {from:'0000-01-01'}, {market:'\u0000'}, {from:'2026-10-22',to:'2026-10-21'}, {chainId:'1'}, {limit:'100000'}, {cursor:'broken'}, {market:'x'.repeat(121)}]) {
    await assert.rejects(collectOnchainTransactions({env,query,now,sql:()=>assert.fail('invalid query reached SQL')}),/invalid_transaction_filters/);
  }
  for(const patch of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'pointbreak'},{ONCHAIN_CHAIN_ID:'1'},
    {DATABASE_URL:'postgres://unused@production/neondb'},{ONCHAIN_DURABLE_TRADES_ENABLED:'false'}]) {
    await assert.rejects(collectOnchainTransactions({env:{...env,...patch},sql:()=>assert.fail('wrong database touched')}),/onchain_transactions_unavailable/);
  }
});

test('history preserves database contents, reports missing receipt cost as unavailable and never fabricates an empty success',async t=>{
  const f=await fixture(t);
  await f.request({status:'confirmed',steps:[{receipt:{gasUsed:'21000'}}]});await f.gas();
  const snapshot=async()=> (await f.db.query(`SELECT row_to_json(r) FROM sepolia_trade_requests r UNION ALL SELECT row_to_json(t) FROM sepolia_trade_transactions t UNION ALL SELECT row_to_json(g) FROM sepolia_gas_transfers g`)).rows;
  const before=await snapshot(),report=await f.read();assert.equal(report.items.find(r=>r.source==='request').receiptFeeEth,null);
  assert.deepEqual(await snapshot(),before);
  await f.db.exec('DROP TABLE redemptions');await assert.rejects(f.read());
});

test('HTTP history uses real local admin auth, strict filters and private GET-only responses without RPC',async t=>{
  const f=await fixture(t),saved={...process.env};
  process.env.POINTS_SESSION_SECRET='local-history-fixture-secret-only';process.env.POINTS_ADMIN_USERNAMES='operator';
  t.after(()=>{for(const key of ['POINTS_SESSION_SECRET','POINTS_ADMIN_USERNAMES']) { if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]; }});
  const source=(await readFile(new URL('../points/admin/onchain-transactions.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?;\n/gm,'').replace('export default ','');
  let connects=0,limited=false;
  const bindings={applyCors,requirePointsAdmin,onchainOperationsSettings:()=>onchainOperationsSettings(f.env),transactionFilters,
    rateLimit:(req,res)=>{if(limited){res.status(429).json({error:'rate_limited'});return true;}return false;},clientIp:()=> 'fixture',
    neon:url=>{assert.equal(url,env.DATABASE_URL);connects++;return f.sql;},process:{env:f.env},collectOnchainTransactions:args=>collectOnchainTransactions({...args,env:f.env})};
  const handler=new Function(...Object.keys(bindings),`${source}\nreturn handler;`)(...Object.values(bindings));
  const request=async({method='GET',username='operator',query={}}={})=>{
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},end(){return this;}};
    await handler({method,query,headers:username?{cookie:`pronos_points_session=${createSessionToken({suborgId:'fixture-owner',username})}`} :{}},res);return res;
  };
  assert.equal((await request({method:'OPTIONS'})).code,200);assert.equal((await request({method:'POST'})).code,405);
  assert.equal((await request({username:null})).code,401);assert.equal((await request({username:'other'})).code,403);
  assert.equal((await request({query:{chainId:'1'}})).code,400);
  f.env.VERCEL_GIT_COMMIT_REF='pointbreak';assert.equal((await request()).code,403);f.env.VERCEL_GIT_COMMIT_REF='onchain-sepolia';
  f.env.ONCHAIN_RPC_URL='';assert.equal((await request()).code,503);f.env.ONCHAIN_RPC_URL=env.ONCHAIN_RPC_URL;
  limited=true;assert.equal((await request()).code,429);limited=false;assert.equal(connects,0);
  const good=await request();assert.equal(good.code,200);assert.equal(good.headers['Cache-Control'],'private, no-store');assert.equal(good.body.readOnly,true);
  await f.db.exec('DROP TABLE trades');const bad=await request();assert.equal(bad.code,503);assert.deepEqual(bad.body,{error:'onchain_transactions_unavailable'});
});
