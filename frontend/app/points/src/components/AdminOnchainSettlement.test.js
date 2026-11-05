import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../package.json',import.meta.url));
const React=require('react'),{parseHTML}=require('linkedom'),{buildSync}=require('esbuild');
const {outputFiles}=buildSync({entryPoints:[new URL('./AdminOnchainSettlement.jsx',import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'node',external:['react','@app/lib/pointsAuth.js','../lib/PointsExecution.jsx','../lib/pointsApi.js']});
let auth={authenticated:true,user:{username:'admin',suborgId:'ops'}},execution={enabled:true,durableTrades:true};
const requests=[],posts=[],stored=new Map();let failStorage=false;
const storage={getItem:k=>stored.get(k),setItem(k,v){if(failStorage)throw Error('storage full');stored.set(k,v);},removeItem:k=>stored.delete(k)};
const api={getJson:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),postJson:(url,body)=>new Promise((resolve,reject)=>{assert.equal(JSON.parse([...stored.values()][0]).requestId,body.requestId);posts.push({url,body,resolve,reject});})};
const bindings={react:React,'@app/lib/pointsAuth.js':{usePointsAuth:()=>auth},'../lib/PointsExecution.jsx':{usePointsExecution:()=>execution},'../lib/pointsApi.js':api},compiled={exports:{}};
new Function('require','module','exports',outputFiles[0].text)(name=>bindings[name]||require(name),compiled,compiled.exports);
const {SettlementPanel,default:AdminOnchainSettlement}=compiled.exports;
const report={markets:[{id:42,question:'Fixture market',status:'active',outcomes:['Yes','No'],settlementReady:true}],requests:[],scheduler:{enabled:false}};
test('mounted settlement persists before sending, resumes a lost response with the same key and waits for indexing',async t=>{
  const {window,document}=parseHTML('<html><body><div id="root"></div></body></html>');
  const previous={window:global.window,document:global.document,act:global.IS_REACT_ACT_ENVIRONMENT,storage:global.localStorage};
  global.window=window;global.document=document;global.localStorage=storage;global.IS_REACT_ACT_ENVIRONMENT=true;window.confirm=()=>true;
  const {createRoot}=require('react-dom/client'),root=createRoot(document.getElementById('root'));
  t.after(async()=>{await React.act(async()=>root.unmount());global.window=previous.window;global.document=previous.document;global.localStorage=previous.storage;global.IS_REACT_ACT_ENVIRONMENT=previous.act;});
  const mount=element=>React.act(async()=>root.render(element));
  const click=label=>React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent===label).click());
  await mount(React.createElement(AdminOnchainSettlement,{isAdmin:false}));assert.equal(requests.length,0);
  execution={enabled:true,durableTrades:false};await mount(React.createElement(AdminOnchainSettlement,{isAdmin:true}));assert.equal(requests.length,0);
  execution={enabled:true,durableTrades:true};await mount(React.createElement(AdminOnchainSettlement,{isAdmin:true}));assert.equal(requests[0].url,'/api/points/admin/onchain-settlement');
  await React.act(async()=>requests.shift().resolve(report));
  const input=document.querySelector('input'),props=Object.keys(input).find(k=>k.startsWith('__reactProps$'));
  await React.act(async()=>input[props].onChange({target:{value:'Verified fixture evidence'}}));
  const submit=()=>React.act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  failStorage=true;await submit();assert.equal(posts.length,0);assert.match(document.body.textContent,/almacenamiento local/);failStorage=false;
  await submit();const first=posts.shift();assert.equal(first.url,'/api/points/admin/onchain-settlement');assert.equal(first.body.marketId,42);assert.equal(stored.size,1);
  await React.act(async()=>first.reject(Error('network timeout')));assert.equal(stored.size,1);
  await click('Continuar solicitud guardada');const resumed=posts.shift();assert.equal(resumed.body.requestId,first.body.requestId);
  await React.act(async()=>resumed.resolve({status:'confirmed',ok:true,txHash:'0xfixture'}));assert.equal(stored.size,0);assert.match(document.body.textContent,/Esperando la actualización del indexador/);
  await React.act(async()=>requests.shift().resolve({...report,requests:[{requestId:first.body.requestId,marketId:42,action:'resolve',status:'confirmed',txHash:'0xfixture',indexingStatus:'pending_or_superseded',awaitingIndexing:true}]}));
  assert.match(document.body.textContent,/pending_or_superseded/);assert.equal(document.querySelector('h3').textContent,'#42 · Fixture market');assert.match(document.body.textContent,/active/);
  assert.equal(document.querySelector('form select').disabled,true);
  await click('Actualizar liquidaciones');const stale=requests.shift();
  auth={authenticated:true,user:{username:'other-admin',suborgId:'other'}};await mount(React.createElement(AdminOnchainSettlement,{isAdmin:true}));
  await React.act(async()=>stale.resolve(report));assert.doesNotMatch(document.body.textContent,/Fixture market/);
  await React.act(async()=>requests.shift().resolve({...report,markets:[]}));
  auth={authenticated:false,user:null};await mount(React.createElement(AdminOnchainSettlement,{isAdmin:true}));assert.equal(document.getElementById('root').textContent,'');
});

test('refund review shows server amounts and blocks a shortfall before explicit confirmation',async t=>{
  const {window,document}=parseHTML('<html><body><div id="refund-root"></div></body></html>');
  const previous={window:global.window,document:global.document,act:global.IS_REACT_ACT_ENVIRONMENT};
  global.window=window;global.document=document;global.IS_REACT_ACT_ENVIRONMENT=true;
  const {createRoot}=require('react-dom/client'),root=createRoot(document.getElementById('refund-root'));
  t.after(async()=>{await React.act(async()=>root.unmount());Object.assign(global,{window:previous.window,document:previous.document,IS_REACT_ACT_ENVIRONMENT:previous.act});});
  const holder='0x'+'5'.repeat(40),submissions=[],calls=[];
  let shortfall='1';
  const api={getJson:async()=>({holders:[holder],nextCursor:null}),postJson:async(_url,b)=>{calls.push(b);return {
    marketId:42,holders:[holder],blockNumber:10,blockHash:'0x'+'ab'.repeat(32),planHash:'a'.repeat(64),payoutUnits:'9000000',shortfallUnits:shortfall,
    refunds:[{holder,payout:'9000000'}],skipped:[]};}};
  await React.act(async()=>root.render(React.createElement(compiled.exports.RefundReview,{market:{id:42},api,busy:false,onSubmit:r=>submissions.push(r)})));
  const click=label=>React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent===label).click());
  await click('Cargar siguientes titulares');await click('Previsualizar reembolsos');
  assert.equal(calls[0].operation,'preview');assert.equal(submissions.length,0);assert.match(document.body.textContent,/9.000000 MXNP/);
  const input=document.querySelector('input'),props=Object.keys(input).find(k=>k.startsWith('__reactProps$'));
  await React.act(async()=>input[props].onChange({target:{value:'Reviewed native costs'}}));
  assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar reembolsos revisados').disabled,true);
  shortfall='0';await click('Previsualizar reembolsos');await click('Confirmar reembolsos revisados');
  assert.equal(submissions.length,1);assert.equal(submissions[0].action,'cancel_refund');assert.equal(submissions[0].planHash,'a'.repeat(64));assert.equal(submissions[0].payout,undefined);
});

test('a saved refund resumes through the durable refund endpoint with its original review and key',async t=>{
  const {window,document}=parseHTML('<html><body><div id="resume-root"></div></body></html>');
  const previous={window:global.window,document:global.document,act:global.IS_REACT_ACT_ENVIRONMENT};
  global.window=window;global.document=document;global.IS_REACT_ACT_ENVIRONMENT=true;
  const {createRoot}=require('react-dom/client'),root=createRoot(document.getElementById('resume-root'));
  t.after(async()=>{await React.act(async()=>root.unmount());Object.assign(global,{window:previous.window,document:previous.document,IS_REACT_ACT_ENVIRONMENT:previous.act});});
  const record={action:'cancel_refund',marketId:42,holders:['0x'+'5'.repeat(40)],blockNumber:10,
    blockHash:'0x'+'ab'.repeat(32),planHash:'a'.repeat(64),reason:'Reviewed refund',requestId:'refund_saved_123'};
  const saved=new Map([['pronos:admin-settlement:refund-admin',JSON.stringify(record)]]),posts=[];
  const storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
  const api={getJson:async()=>({...report,markets:[]}),postJson:async(url,body)=>{
    assert.equal(JSON.parse([...saved.values()][0]).requestId,record.requestId);posts.push({url,body});
    if(posts.length===1)throw Error('lost response');return {ok:true,status:'confirmed'};
  }};
  await React.act(async()=>root.render(React.createElement(SettlementPanel,{owner:'refund-admin',api,storage,confirm:()=>{throw Error('existing review must resume');}})));
  const resume=()=>React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Continuar solicitud guardada').click());
  await resume();assert.equal(saved.size,1);await resume();assert.equal(saved.size,0);
  assert.deepEqual(posts[0],posts[1]);assert.equal(posts[0].url,'/api/points/admin/onchain-refunds');
  const {action,...expected}=record;assert.deepEqual(posts[0].body,{...expected,operation:'execute'});
});
