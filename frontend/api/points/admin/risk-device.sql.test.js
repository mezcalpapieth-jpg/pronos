import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {sharedRiskSignalScore,capturePointsRiskEvent} from '../../_lib/points-risk.js';

test('real admin SQL keeps legacy IDs separate and shows a filtered, signed-browser activity timeline',async()=>{
 const source=await readFile(new URL('./risk.js',import.meta.url),'utf8');
 const list=source.slice(source.indexOf('async function handleList'),source.indexOf('async function handleReview'));
 const templates=[...list.matchAll(/sql`([\s\S]*?)`/g)].map(m=>m[1]);
 assert.equal(templates.length,6);
 const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE points_users(username text,created_at timestamptz,email text,phone_number text);
   CREATE TABLE points_balances(username text,balance numeric);
   CREATE TABLE points_account_reviews(username text,status text,reason text,updated_at timestamptz);
   CREATE TABLE points_markets(id int,question text,category text,status text,outcomes jsonb);
   CREATE TABLE points_trades(id int,username text,market_id int,side text,outcome_index int,shares numeric,collateral numeric,price_at_trade numeric,created_at timestamptz);
   CREATE TABLE points_risk_events(id int,username text,market_id int,event_type text,trade_side text,ip_hash text,device_hash text,session_hash text,metadata jsonb,created_at timestamptz);
   CREATE TABLE points_risk_flags(id int,username text,flag_type text,severity int,status text,market_id int,related_usernames text[],details jsonb,created_at timestamptz);
   INSERT INTO points_users SELECT x,now(),NULL,NULL FROM unnest(ARRAY['alice','bob','carol','dave','pronos_treasury']) x;
   INSERT INTO points_markets VALUES(1,'fixture','deportes','active','["Sí","No"]');
   INSERT INTO points_risk_events VALUES
   (1,'alice',1,'auth:verify_otp',NULL,'ip-a','signed-device',NULL,'{"deviceTrust":"server_issued"}',now()-interval '3 minutes'),
   (2,'bob',1,'trade:buy','buy','ip-b','signed-device',NULL,'{"deviceTrust":"server_verified"}',now()-interval '1 minute'),
   (3,'carol',1,'trade:buy','buy','ip-c','old-client-id','old-session','{}',now()),
   (4,'dave',1,'trade:buy','buy','ip-d','old-client-id','old-session','{}',now()),
   (5,'alice',1,'trade:buy','buy',NULL,'generic-platform',NULL,'{}',now()),
   (6,'carol',1,'trade:buy','buy',NULL,'generic-platform',NULL,'{}',now()),
   (7,'pronos_treasury',1,'trade:buy','buy',NULL,'signed-device',NULL,'{"deviceTrust":"server_verified"}',now());`);
  async function run(index,usernameFilter=null){
   const values=[];const args={usernameFilter,statusParam:null,PRONOS_TREASURY_USERNAME:'pronos_treasury',ignoredDeviceHashes:['generic-platform']};
   const sql=templates[index].replace(/\$\{([^}]+)\}/g,(_,key)=>{assert.ok(key in args,key);values.push(args[key]);return '$'+values.length;});
   return (await db.query(sql,values)).rows;
  }
  const accounts=await run(0);
  const alice=accounts.find(r=>r.username==='alice'),carol=accounts.find(r=>r.username==='carol');
  assert.deepEqual(alice.sharedSignals.map(s=>s.signalType),['device']);
  assert.deepEqual(alice.sharedSignals[0].linkedUsernames,['bob']);
  assert.equal(sharedRiskSignalScore(alice.sharedSignals),40);
  assert.equal(sharedRiskSignalScore(carol.sharedSignals),10);
  assert.equal(alice.riskScore,40);assert.equal(carol.riskScore,10);
  assert.deepEqual(new Set(accounts.slice(0,2).map(r=>r.username)),new Set(['alice','bob']));
  assert.ok(carol.sharedSignals.every(s=>s.signalType.endsWith('_unverified')));
  assert.deepEqual(await run(1),[]);
  const signals=await run(2);assert.equal(signals.length,3);
  assert.equal(signals.find(s=>s.signalType==='device').userCount,2);
  const pairs=await run(3);assert.ok(pairs.some(p=>p.signalType==='device'&&p.usernameA==='alice'&&p.usernameB==='bob'));
  assert.ok(!pairs.some(p=>p.usernameA==='pronos_treasury'||p.usernameB==='pronos_treasury'));
  assert.deepEqual(await run(4),[]);
  const timeline=await run(5,'alice');assert.deepEqual(timeline.map(e=>e.username),['bob','alice']);
  assert.ok(timeline.every(e=>e.signalKey==='signed-devic'));
  assert.deepEqual(await run(5,'carol'),[]);
 }finally{await db.close();}
});

test('auth and stock capture succeed against the real risk schema without a fabricated market ID',async()=>{
 const schema=await readFile(new URL('../../_lib/points-schema.js',import.meta.url),'utf8');
 const ddl=schema.match(/`(CREATE TABLE IF NOT EXISTS points_risk_events [\s\S]*?)`/)[1];
 const db=new PGlite();
 try{
  await db.exec('CREATE TABLE points_markets(id integer PRIMARY KEY); INSERT INTO points_markets VALUES(1)');
  await db.exec(ddl);
  await capturePointsRiskEvent(db,{headers:{}},{username:'alice',eventType:'auth:device_seen'});
  await capturePointsRiskEvent(db,{headers:{}},{username:'alice',eventType:'trade:stock_buy',amount:'10',metadata:{ticker:'NVDA'}});
  await capturePointsRiskEvent(db,{headers:{}},{username:'alice',eventType:'trade:buy',marketId:1,outcomeIndex:0,amount:0,shares:0});
  const rows=(await db.query('SELECT event_type,market_id,outcome_index,amount,shares FROM points_risk_events ORDER BY id')).rows;
  assert.equal(rows.length,3);
  assert.equal(rows[0].market_id,null);assert.equal(rows[1].market_id,null);
  assert.equal(rows[0].outcome_index,null);assert.equal(rows[0].amount,null);assert.equal(rows[0].shares,null);
  assert.equal(rows[2].market_id,1);assert.equal(rows[2].outcome_index,0);
  assert.equal(Number(rows[2].amount),0);assert.equal(Number(rows[2].shares),0);
 }finally{await db.close();}
});
