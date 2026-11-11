import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createApiCredentials, signApiRequest } from '../_lib/points-api-auth.js';
import { createApiRedemptionHandler } from '../_lib/points-api-redemption-http.js';
import { executeApiRedemption } from '../_lib/points-api-redemption.js';

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE points_cycles(id INT,label TEXT,started_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,status TEXT,closed_at TIMESTAMPTZ);
    INSERT INTO points_cycles VALUES(5,'Torneo Octubre 2026','2026-10-01T06:00Z','2026-11-02T05:59:59Z','active',NULL);
    CREATE TABLE points_cycle_snapshots(cycle_id INT,username TEXT,final_balance NUMERIC,rank INT);
    INSERT INTO points_cycle_snapshots VALUES(5,'alice',100,1);
    CREATE TABLE points_users(username TEXT PRIMARY KEY,api_blocked_at TIMESTAMPTZ);
    INSERT INTO points_users VALUES('alice',NULL),('bob',NULL);
    CREATE TABLE points_balances(username TEXT PRIMARY KEY,balance NUMERIC(20,6),updated_at TIMESTAMPTZ);
    INSERT INTO points_balances VALUES('alice',100,NOW()),('bob',200,NOW());
    CREATE TABLE points_markets(id INT PRIMARY KEY,question TEXT,status TEXT,outcome INT,outcomes JSONB DEFAULT '["Si","No"]',mode TEXT DEFAULT 'points');
    INSERT INTO points_markets(id,question,status,outcome) VALUES
      (1,'Winner','resolved',0),(2,'Pending','active',0),(3,'Losing','resolved',0),(4,'Canceled','canceled',NULL),
      (5,'Bob only','resolved',0),(6,'Onchain','resolved',0),(7,'Old cycle','resolved',0),
      (8,'Hidden tiny winner','resolved',0),(9,'Concurrent winner','resolved',0),(10,'Rollback winner','resolved',0);
    UPDATE points_markets SET mode='onchain' WHERE id=6;
    CREATE TABLE points_positions(market_id INT,username TEXT,outcome_index INT,shares NUMERIC(20,6),cost_basis NUMERIC(20,6),
      realized_pnl NUMERIC DEFAULT 0,dismissed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,PRIMARY KEY(market_id,username,outcome_index));
    INSERT INTO points_positions(market_id,username,outcome_index,shares,cost_basis) VALUES
      (1,'alice',0,200,100),(2,'alice',0,40,20),(3,'alice',1,40,20),(4,'alice',0,40,20),
      (5,'bob',0,50,25),(6,'alice',0,40,20),(7,'alice',0,40,20),(8,'alice',0,0.0025,0.001),
      (9,'alice',0,40,20),(10,'alice',0,50,25);
    UPDATE points_positions SET dismissed_at=NOW() WHERE market_id=8;
    CREATE TABLE points_trades(id SERIAL PRIMARY KEY,market_id INT,username TEXT,side TEXT,outcome_index INT,
      shares NUMERIC(20,6),collateral NUMERIC(20,6),fee NUMERIC DEFAULT 0,price_at_trade NUMERIC,source TEXT,
      api_key_id BIGINT,created_at TIMESTAMPTZ DEFAULT NOW());
    INSERT INTO points_trades(market_id,username,side,outcome_index,shares,created_at)
      SELECT market_id,username,'buy',outcome_index,shares,'2026-11-03T06:00Z' FROM points_positions WHERE market_id NOT IN (1,7);
    INSERT INTO points_trades(market_id,username,side,outcome_index,shares,created_at) VALUES
      (1,'alice','buy',0,74.876544,'2026-09-30T06:00Z'),(1,'alice','buy',0,150.123456,'2026-11-03T06:00Z'),
      (1,'alice','sell',0,25,'2026-11-03T07:00Z'),(7,'alice','buy',0,40,'2026-09-30T06:00Z');
    CREATE TABLE points_distributions(id SERIAL PRIMARY KEY,username TEXT,amount NUMERIC(20,6),kind TEXT,reference_id INT,reason TEXT);
    CREATE TABLE points_api_keys(id INT PRIMARY KEY,username TEXT,user_sub TEXT,key_prefix TEXT,key_hash TEXT,secret_ciphertext TEXT,
      permissions JSONB,revoked_at TIMESTAMPTZ,expires_at TIMESTAMPTZ,last_used_at TIMESTAMPTZ,last_used_ip_hash TEXT);
    CREATE TABLE points_api_idempotency_keys(api_key_id INT,idempotency_key TEXT,request_hash TEXT,status_code INT,
      response_body JSONB,expires_at TIMESTAMPTZ,UNIQUE(api_key_id,idempotency_key));
    CREATE TABLE points_api_request_logs(request_id TEXT,api_key_id INT,username TEXT,method TEXT,endpoint TEXT,result TEXT,
      status_code INT,error_code TEXT,ip_hash TEXT,user_agent_hash TEXT,metadata JSONB);
  `);
  const keys = {};
  for (const [id, name, username, permissions] of [[1,'trade','alice',['READ','TRADE']],[2,'read','alice',['READ']],[3,'bob','bob',['READ','TRADE']]]) {
    const credentials = createApiCredentials(); keys[name] = credentials;
    await db.query(`INSERT INTO points_api_keys(id,username,user_sub,key_prefix,key_hash,secret_ciphertext,permissions)
      VALUES($1,$2,$2,$3,$4,$5,$6)`,[id,username,credentials.keyPrefix,credentials.keyHash,credentials.secretCiphertext,JSON.stringify(permissions)]);
  }
  const sql = async (strings, ...values) => (await db.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
  sql.query = async (text, values) => (await db.query(text,values)).rows; // Neon HTTP's array shape.
  const risk = [];
  let failLedger = false;
  const deps = { getSql: () => sql, ensureSchema: async () => {}, captureRisk: async (_db,_req,event) => risk.push(event),
    transaction: callback => db.transaction(tx => callback({ query(text,values) {
      if (failLedger && text.includes('INSERT INTO points_distributions')) throw new Error('simulated ledger outage');
      return tx.query(text,values);
    } })) };
  const handlers = { '/api/v1/redeem': createApiRedemptionHandler('redeem',deps), '/api/v1/claimable': createApiRedemptionHandler('claimable',deps) };
  const server = createServer(async (req,res) => {
    res.status = code => { res.statusCode=code;return res; };
    res.json = body => { res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return res; };
    const url = new URL(req.url,'http://localhost');req.query=Object.fromEntries(url.searchParams);
    await handlers[url.pathname](req,res);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections();server.close(resolve); }));
  async function request(path='/api/v1/redeem', { method=path.includes('claimable')?'GET':'POST', body, key='trade', idem='claim-test-0001', headers={}, signBody }={}) {
    const raw = body == null ? '' : typeof body==='string'?body:JSON.stringify(body);
    const timestamp=Date.now().toString();
    const auth = key ? { 'X-PRONOS-API-KEY':keys[key].apiKey,'X-PRONOS-TIMESTAMP':timestamp,
      'X-PRONOS-SIGNATURE':signApiRequest({timestamp,method,path,body:signBody??raw,secret:keys[key].apiSecret}) } : {};
    const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{
      'Content-Type':'application/json',...auth,...(idem?{'Idempotency-Key':idem}:{}),...headers,
    },...(raw?{body:raw}:{})});
    return { status:response.status,headers:response.headers,body:await response.json() };
  }
  const balance=async username=>Number((await db.query('SELECT balance FROM points_balances WHERE username=$1',[username])).rows[0].balance);
  return { db,keys,request,risk,balance,baseUrl: `http://127.0.0.1:${server.address().port}`,failLedger: value => { failLedger=value; } };
}

test('signed requests discover eligible winnings and claim without a session, retaining accounting and frozen standings',async t=>{
  const {db,request,risk,balance}=await fixture(t);
  const original=(await db.query('SELECT * FROM points_trades ORDER BY id')).rows;
  const photo=(await db.query('SELECT * FROM points_cycle_snapshots')).rows;
  const first=await request('/api/v1/claimable?limit=1');
  assert.equal(first.status,200);assert.equal(first.body.cycleId,5);assert.equal(first.body.nextCursor,'1');
  assert.deepEqual(first.body.claims,[{marketId:'1',outcomeIndex:0,question:'Winner',shares:125.123456,payout:125.123456}]);
  assert.match(first.headers.get('cache-control'),/no-store/);
  const page=await request('/api/v1/claimable?afterMarketId=1&limit=200');
  assert.deepEqual(page.body.claims.map(c=>c.marketId),['8','9','10']);assert.equal(page.body.nextCursor,null);
  assert.equal(page.body.claims[0].payout,0.0025);
  const result=await request('/api/v1/redeem',{body:'{ "marketId": 1, "outcomeIndex": 0, "username": "bob" }'});
  assert.equal(result.status,200);assert.equal(result.body.redemption.payout,125.123456);
  assert.equal(result.body.balance,225.123456);assert.equal(await balance('bob'),200);
  assert.equal(result.headers.get('set-cookie'),null);
  assert.deepEqual((await db.query("SELECT username,source,api_key_id,shares,collateral FROM points_trades WHERE side='redeem'")).rows,
    [{username:'alice',source:'api',api_key_id:1,shares:'125.123456',collateral:'125.123456'}]);
  assert.deepEqual((await db.query('SELECT username,amount,kind FROM points_distributions')).rows,
    [{username:'alice',amount:'125.123456',kind:'redemption'}]);
  const position=(await db.query("SELECT shares,cost_basis,realized_pnl,dismissed_at FROM points_positions WHERE market_id=1")).rows[0];
  assert.equal(position.shares,'74.876544');assert.equal(position.cost_basis,'37.438272');assert.ok(position.dismissed_at);
  assert.equal(Number(position.realized_pnl),62.561728);
  assert.deepEqual((await db.query('SELECT * FROM points_trades WHERE id <= $1 ORDER BY id',[original.at(-1).id])).rows,original);
  assert.deepEqual((await db.query('SELECT * FROM points_cycle_snapshots')).rows,photo);
  assert.equal(risk.length,1);assert.equal(risk[0].metadata.apiKeyId,1);
  assert.deepEqual((await request('/api/v1/claimable?marketId=1')).body.claims,[]);
});

test('simultaneous retries share one durable receipt and never pay twice, even with a new key or another API credential',async t=>{
  const {db,request,balance,risk}=await fixture(t);
  const options={body:{marketId:9,outcomeIndex:0},idem:'concurrent-claim-9'};
  const results=await Promise.all([request('/api/v1/redeem',options),request('/api/v1/redeem',options)]);
  assert.ok(results.every(r=>r.status===200));assert.equal(results.filter(r=>r.body.idempotentReplay).length,1);
  assert.equal(results[0].body.requestId,results[1].body.requestId);
  assert.equal(await balance('alice'),140);assert.equal(risk.length,1);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_distributions')).rows[0].n,1);
  assert.equal((await request('/api/v1/redeem',{body:options.body,idem:'another-new-key'})).body.error.code,'no_shares_to_redeem');
  const credentials=createApiCredentials();
  await db.query("INSERT INTO points_api_keys(id,username,key_hash,key_prefix,secret_ciphertext,permissions) VALUES(4,'alice',$1,$2,$3,'[\"READ\",\"TRADE\"]')",[credentials.keyHash,credentials.keyPrefix,credentials.secretCiphertext]);
  // A second key is still bounded by the same canonical position and trade locks.
  const req={method:'POST',url:'/api/v1/redeem',headers:{'idempotency-key':'another-api-key'},body:options.body};
  await assert.rejects(db.transaction(tx=>executeApiRedemption(tx,{req,auth:{apiKeyId:4,username:'alice'},requestId:'req-test'})),{message:'no_shares_to_redeem'});
  assert.equal(await balance('alice'),140);
  const conflict=await request('/api/v1/redeem',{...options,body:{marketId:10,outcomeIndex:0}});
  assert.equal(conflict.status,409);assert.equal(conflict.body.error.code,'idempotency_conflict');
});

test('session cookies, read-only keys, invalid signatures and blocked, expired or revoked credentials cannot claim',async t=>{
  const {db,request,balance}=await fixture(t);
  const body={marketId:9,outcomeIndex:0};
  assert.equal((await request('/api/v1/redeem',{body,key:null,headers:{cookie:'pronos_points_session=fake'}})).status,401);
  assert.equal((await request('/api/v1/redeem',{body,key:'read'})).status,403);
  assert.equal((await request('/api/v1/claimable',{key:'read'})).status,200);
  assert.equal((await request('/api/v1/redeem',{body,signBody:'{}'})).body.error.code,'invalid_api_signature');
  await db.exec("UPDATE points_users SET api_blocked_at=NOW() WHERE username='alice'");
  assert.equal((await request('/api/v1/redeem',{body})).body.error.code,'api_access_blocked');
  await db.exec("UPDATE points_users SET api_blocked_at=NULL;UPDATE points_api_keys SET expires_at=NOW()-INTERVAL '1 second' WHERE id=1");
  assert.equal((await request('/api/v1/redeem',{body})).body.error.code,'invalid_api_key');
  await db.exec('UPDATE points_api_keys SET expires_at=NULL,revoked_at=NOW() WHERE id=1');
  assert.equal((await request('/api/v1/redeem',{body})).body.error.code,'invalid_api_key');
  assert.equal(await balance('alice'),100);assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_distributions')).rows[0].n,0);
});

test('only resolved winning points positions belonging to the key owner can be claimed',async t=>{
  const {db,request,balance}=await fixture(t);
  for(const [marketId,outcomeIndex,code] of [[2,0,'market_not_resolved'],[3,1,'losing_outcome'],[4,0,'market_not_resolved'],
    [5,0,'no_shares_to_redeem'],[6,0,'market_mode_not_supported'],[7,0,'position_outside_current_cycle'],[999,0,'market_not_found']]) {
    const response=await request('/api/v1/redeem',{body:{marketId,outcomeIndex}});
    assert.equal(response.body.error.code,code);
  }
  assert.equal(await balance('alice'),100);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_api_idempotency_keys')).rows[0].n,0);
  const tiny=await request('/api/v1/redeem',{body:{marketId:8,outcomeIndex:0}});
  assert.equal(tiny.body.redemption.payout,0.0025);assert.equal(await balance('alice'),100.0025);
});

test('failed claims roll back payout, shares, trades, audits and idempotency receipt; a retry can then succeed',async t=>{
  const {db,request,balance,failLedger}=await fixture(t);
  const options={body:{marketId:10,outcomeIndex:0},idem:'ledger-failure-retry'};
  failLedger(true);
  assert.equal((await request('/api/v1/redeem',options)).status,500);
  assert.equal(await balance('alice'),100);
  assert.equal((await db.query('SELECT shares FROM points_positions WHERE market_id=10')).rows[0].shares,'50.000000');
  for(const table of ['points_distributions','points_api_idempotency_keys']) assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n,0);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM points_trades WHERE side='redeem'")).rows[0].n,0);
  failLedger(false);assert.equal((await request('/api/v1/redeem',options)).status,200);assert.equal(await balance('alice'),150);
});

test('strict request validation rejects truncated IDs and missing idempotency; rollover prevents stale claims',async t=>{
  const {db,request}=await fixture(t);
  for (const body of [{marketId:'1oops',outcomeIndex:0},{marketId:true,outcomeIndex:0},{marketId:1,outcomeIndex:'0oops'},
    {marketId:1,outcomeIndex:-1},{marketId:2147483648,outcomeIndex:0},[],null]) {
    const response=await request('/api/v1/redeem',{body});assert.equal(response.status,400);
  }
  assert.equal((await request('/api/v1/redeem',{body:{marketId:9,outcomeIndex:0},idem:''})).body.error.code,'missing_idempotency_key');
  assert.equal((await request('/api/v1/claimable?marketId=1oops')).status,400);
  assert.equal((await request('/api/v1/claimable?limit=0')).status,400);
  await db.exec("UPDATE points_cycles SET status='closed';INSERT INTO points_cycles VALUES(6,'Next cycle','2026-11-04T06:00Z','2026-11-20T06:00Z','active',NULL)");
  assert.deepEqual((await request('/api/v1/claimable')).body.claims,[]);
  assert.equal((await request('/api/v1/redeem',{body:{marketId:9,outcomeIndex:0}})).body.error.code,'position_outside_current_cycle');
  await db.exec("UPDATE points_cycles SET status='closed'");
  assert.equal((await request('/api/v1/redeem',{body:{marketId:9,outcomeIndex:0}})).body.error.code,'no_active_cycle');
  assert.equal((await request('/api/v1/claimable')).body.cycleId,null);
});


test('the Developer page bot example signs real HTTP claims and releases every discovered payout',async t=>{
  const {db,keys,baseUrl,balance}=await fixture(t);
  const source=await readFile(new URL('../../app/points/src/pages/PointsDeveloper.jsx',import.meta.url),'utf8');
  const exampleFunction=source.slice(source.indexOf('function claimCodeSample()'),source.indexOf('function CopyButton'));
  const example=new Function(`${exampleFunction}; return claimCodeSample();`)();
  const outputs=[];
  const localFetch=(url,options)=>{
    const parsed=new URL(url);
    assert.equal(parsed.origin,'https://pronos.io');
    return fetch(baseUrl+parsed.pathname+parsed.search,options);
  };
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('fetch','process','console',example.replace("import crypto from 'node:crypto';","const crypto=await import('node:crypto');"))(
    localFetch,{env:{PRONOS_API_KEY:keys.trade.apiKey,PRONOS_API_SECRET:keys.trade.apiSecret}},
    {log:(...values)=>outputs.push(values)},
  );
  assert.deepEqual(outputs,[[125.123456,'MXNP'],[0.0025,'MXNP'],[40,'MXNP'],[50,'MXNP']]);
  assert.equal(await balance('alice'),315.125956);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_distributions')).rows[0].n,4);
});
