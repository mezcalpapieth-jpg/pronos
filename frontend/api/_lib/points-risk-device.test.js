import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {ensurePointsRiskDevice, pointsRiskSignals, capturePointsRiskEvent, sharedRiskSignalScore} from './points-risk.js';
import {createSessionToken, setSessionCookie, clearSessionCookie, readSession} from './session.js';
import {applyCors} from './cors.js';

process.env.POINTS_RISK_SALT = 'pointbreak-device-test-risk-secret';
process.env.POINTS_SESSION_SECRET = 'pointbreak-device-test-session-secret';
function response() {
 const headers = new Map();
 return {headers, getHeader: key => headers.get(key.toLowerCase()), setHeader: (key,value) => headers.set(key.toLowerCase(),value)};
}
function cookies(res) {const value=res.getHeader('Set-Cookie');return (Array.isArray(value)?value:value?[value]:[]);}
function deviceCookie(res) {return cookies(res).find(c=>c.includes('pronos_risk_device=')).split(';')[0];}

test('the server chooses distinct browser IDs and ignores client-selected IDs',()=>{
 const a={headers:{'x-pronos-device-id':'chosen-by-client',cookie:'pronos_device_id=chosen-by-client'}},b={headers:{'x-pronos-device-id':'chosen-by-client'}};
 const ra=response(),rb=response();
 const da=ensurePointsRiskDevice(a,ra),db=ensurePointsRiskDevice(b,rb);
 assert.notEqual(da.id,db.id);assert.equal(da.trust,'server_issued');
 assert.notEqual(pointsRiskSignals(a).deviceHash,pointsRiskSignals(b).deviceHash);
 assert.match(deviceCookie(ra),/^pronos_risk_device=v1\./);
 assert.match(cookies(ra)[0],/HttpOnly; SameSite=Lax/);
 assert.doesNotMatch(cookies(ra)[0],/Domain=/);
 assert.equal(ensurePointsRiskDevice(a,ra),da);assert.equal(cookies(ra).length,1);
});

test('a returned signed browser ID persists across IP, header, and account changes',()=>{
 const first=response();ensurePointsRiskDevice({headers:{}},first);
 const cookie=deviceCookie(first);
 const a={headers:{cookie,'x-forwarded-for':'203.0.113.1','x-pronos-device-id':'forged-a'}};
 const b={headers:{cookie,'x-forwarded-for':'198.51.100.8','x-pronos-device-id':'forged-b'}};
 assert.equal(pointsRiskSignals(a).deviceTrust,'server_verified');
 assert.equal(pointsRiskSignals(a).deviceHash,pointsRiskSignals(b).deviceHash);
 assert.notEqual(pointsRiskSignals(a).ipHash,pointsRiskSignals(b).ipHash);
 const res=response();assert.equal(ensurePointsRiskDevice(a,res).issued,false);assert.equal(cookies(res).length,0);
});

test('tampered, unsigned, malformed, expired, or future cookies are replaced',()=>{
 const originalNow=Date.now;
 try {
  const fixed=Date.parse('2026-11-03T12:00:00Z');Date.now=()=>fixed;
  const first=response();ensurePointsRiskDevice({headers:{}},first);
  const cookie=deviceCookie(first);const token=cookie.split('=')[1];
  const values=[token.replace('v1.','v2.'),token.replace(/v1\.[a-f0-9]/,'v1.f'),token.slice(0,-5)+'AAAAA','unsigned','%E0%A4%A'];
  // Mutate the ID without the chance of picking its original first character.
  values[1]=token.slice(0,3)+(token[3]==='f'?'a':'f')+token.slice(4);
  for(const bad of values){
   const req={headers:{cookie:'pronos_risk_device='+bad}},res=response();
   assert.equal(pointsRiskSignals(req).deviceHash,null);
   const device=ensurePointsRiskDevice(req,res);assert.equal(device.issued,true);assert.equal(device.cookieState,'invalid');
  }
  Date.now=()=>fixed+365*86400000;
  const expired=ensurePointsRiskDevice({headers:{cookie}},response());assert.equal(expired.issued,true);
  Date.now=()=>fixed-120000;
  assert.equal(ensurePointsRiskDevice({headers:{cookie}},response()).issued,true);
 } finally {Date.now=originalNow;}
});

test('clearing cookies starts a new browser identity instead of claiming continuity',()=>{
 const a={headers:{}},b={headers:{'x-pronos-device-id':'same-legacy-id'}},ra=response(),rb=response();
 ensurePointsRiskDevice(a,ra);ensurePointsRiskDevice(b,rb);
 assert.notEqual(pointsRiskSignals(a).deviceHash,pointsRiskSignals(b).deviceHash);
 assert.equal(pointsRiskSignals(b).deviceCookieState,'missing');
});

test('production uses a Secure HttpOnly host-only cookie and rejects development cookies',()=>{
 const previous=process.env.VERCEL_ENV;
 try {
  delete process.env.VERCEL_ENV;
  const local=response();ensurePointsRiskDevice({headers:{}},local);
  process.env.VERCEL_ENV='production';
  const req={headers:{cookie:deviceCookie(local)}},res=response();
  ensurePointsRiskDevice(req,res);
  assert.match(cookies(res)[0],/^__Host-pronos_risk_device=/);
  assert.match(cookies(res)[0],/HttpOnly; SameSite=Lax; Secure$/);
  assert.equal(pointsRiskSignals({headers:{cookie:deviceCookie(res)}}).deviceTrust,'server_verified');
 } finally {if(previous===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=previous;}
});

test('issuing, rotating, or clearing sessions preserves the risk cookie in either order',()=>{
 for(const firstSession of [false,true]){
  const res=response(),req={headers:{}};
  const token=createSessionToken({suborgId:'a',username:'alice'});
  if(firstSession)setSessionCookie(res,token);
  ensurePointsRiskDevice(req,res);
  if(!firstSession)setSessionCookie(res,token);
  const device=deviceCookie(res);
  assert.equal(cookies(res).length,2);
  setSessionCookie(res,createSessionToken({suborgId:'b',username:'bob'}));
  assert.equal(cookies(res).length,2);assert.equal(deviceCookie(res),device);
  clearSessionCookie(res);assert.equal(deviceCookie(res),device);assert.equal(cookies(res).length,2);
  assert.ok(cookies(res).some(c=>c.startsWith('pronos_points_session=;')&&c.includes('Max-Age=0')));
 }
});

test('capture records server provenance, rejects forged provenance, and never stores raw identifiers',async()=>{
 const rows=[];const db={query:async(sql,values)=>{rows.push(values);return{rows:[]};}};
 const req={headers:{'x-pronos-device-id':'raw-client-id'}},res=response();
 await capturePointsRiskEvent(db,req,{res,username:'alice',eventType:'trade:buy',metadata:{deviceTrust:'server_verified',deviceId:'raw-id',deviceToken:'raw-token',priceAfter:0.6}});
 assert.equal(rows.length,1);assert.match(rows[0][10],/^[a-f0-9]{64}$/);
 const meta=JSON.parse(rows[0][12]);assert.equal(meta.deviceTrust,'server_issued');assert.equal(meta.priceAfter,0.6);
 assert.doesNotMatch(rows[0][12],/raw-id|raw-token|raw-client-id|v1\./);
 const cookie=deviceCookie(res);
 await capturePointsRiskEvent(db,{headers:{cookie}},{res:response(),username:'bob',eventType:'trade:sell'});
 assert.equal(rows[1][10],rows[0][10]);assert.equal(JSON.parse(rows[1][12]).deviceTrust,'server_verified');
});

test('auth and stock events preserve absent market fields and provenance through metadata truncation',async()=>{
 const events=[];const db={query:async(sql,values)=>{events.push(values);return{rows:[]};}};
 for(const metadata of [{detail:'x'.repeat(3900)}, {['x'.repeat(5000)]:true}]) {
  await capturePointsRiskEvent(db,{headers:{}},{res:response(),username:'alice',eventType:'auth:device_seen',metadata});
 }
 for(const values of events) {
  assert.equal(values[3],null);assert.equal(values[5],null);assert.equal(values[6],null);assert.equal(values[7],null);
  assert.equal(JSON.parse(values[12]).deviceTrust,'server_issued');
  assert.ok(Buffer.byteLength(values[12])<=4096);
 }
});

test('only valid signed sessions become verified session evidence',()=>{
 const token=createSessionToken({suborgId:'a',username:'alice'});
 assert.equal(pointsRiskSignals({headers:{cookie:'pronos_points_session='+token}}).sessionTrust,'server_verified');
 const forged=pointsRiskSignals({headers:{cookie:'pronos_points_session=attacker-chosen'}});
 assert.equal(forged.sessionHash,null);assert.equal(forged.sessionTrust,'none');
});

test('missing production signing configuration does not block an action or log secrets',()=>{
 const keys=['POINTS_RISK_SALT','POINTS_SESSION_SECRET','MVP_ACCESS_SECRET','CLOB_SESSION_SECRET','VERCEL_ENV'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const warn=console.warn;const logs=[];
 try{
  keys.forEach(k=>delete process.env[k]);process.env.VERCEL_ENV='production';console.warn=(...x)=>logs.push(x);
  assert.equal(ensurePointsRiskDevice({headers:{}},response()).trust,'none');
  assert.deepEqual(logs,[['[points-risk] browser cookie unavailable']]);
 }finally{console.warn=warn;for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});

test('verified browser links outweigh a shared network or old unverified identifiers',()=>{
 assert.equal(sharedRiskSignalScore([{signalType:'device'}]),40);
 assert.equal(sharedRiskSignalScore([{signalType:'ip'}]),10);
 assert.equal(sharedRiskSignalScore([{signalType:'device_unverified'}]),5);
 assert.equal(sharedRiskSignalScore([{signalType:'device'},{signalType:'session'},{signalType:'ip'},{signalType:'made-up'}]),90);
});

test('HTTP login, trade, logout and second login retain one browser without affecting session authorization',async()=>{
 const events=[];const db={query:async(sql,values)=>{events.push(values);return{rows:[]};}};
 const server=createServer(async(req,res)=>{
  res.status=code=>{res.statusCode=code;return res;};res.json=body=>res.end(JSON.stringify(body));
  if(applyCors(req,res,{credentials:true}))return;
  if(req.url==='/bootstrap'){ensurePointsRiskDevice(req,res);return res.json({ok:true});}
  if(req.url.startsWith('/login/')){
   const username=req.url.split('/').at(-1);
   setSessionCookie(res,createSessionToken({suborgId:username,username}));
   await capturePointsRiskEvent(db,req,{res,username,eventType:'auth:verify_otp'});return res.json({ok:true});
  }
  const session=readSession(req,res);if(!session)return res.status(401).json({error:'not_authenticated'});
  if(req.url==='/logout'){clearSessionCookie(res);return res.json({ok:true});}
  await capturePointsRiskEvent(db,req,{res,username:session.username,eventType:'trade:buy'});res.json({ok:true});
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const url=`http://127.0.0.1:${server.address().port}`,jar=new Map();
 async function request(path,extra={}){
  const result=await fetch(url+path,{method:path==='/bootstrap'?'GET':'POST',headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...extra}});
  for(const c of result.headers.getSetCookie()){const [pair]=c.split(';');const at=pair.indexOf('=');if(c.includes('Max-Age=0'))jar.delete(pair.slice(0,at));else jar.set(pair.slice(0,at),pair.slice(at+1));}
  await result.text();return result;
 }
 try{
  assert.equal((await request('/trade')).status,401);
  await request('/bootstrap');await request('/login/alice');await request('/trade',{'x-forwarded-for':'203.0.113.1'});
  await request('/logout');assert.equal((await request('/trade')).status,401);
  await request('/login/bob');await request('/trade',{'x-forwarded-for':'198.51.100.8','x-pronos-device-id':'forged'});
  assert.deepEqual(events.map(e=>e[0]),['alice','alice','bob','bob']);
  assert.equal(new Set(events.map(e=>e[10])).size,1);
  assert.ok(events.every(e=>JSON.parse(e[12]).deviceTrust==='server_verified'));
  assert.equal((await request('/trade',{origin:'https://evil.example'})).status,403);assert.equal(events.length,4);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
