import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../../../package.json',import.meta.url));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{parseHTML}=require('linkedom'),{buildSync}=require('esbuild');
const {outputFiles}=buildSync({entryPoints:[new URL('./AdminOnchainTransactions.jsx',import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'node',
  external:['react','@app/lib/pointsAuth.js','../lib/PointsExecution.jsx','../lib/pointsApi.js']});
let auth={authenticated:true,user:{username:'admin',suborgId:'owner-a'}},execution={enabled:true,durableTrades:true};
const requests=[],compiled={exports:{}};
const bindings={react:React,'@app/lib/pointsAuth.js':{usePointsAuth:()=>auth},'../lib/PointsExecution.jsx':{usePointsExecution:()=>execution},
  '../lib/pointsApi.js':{getJson:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject}))}};
new Function('require','module','exports',outputFiles[0].text)(name=>bindings[name]||require(name),compiled,compiled.exports);
const {TransactionsPresentation,default:AdminOnchainTransactions}=compiled.exports;
const filters={username:'',wallet:'',market:'',tx:'',action:'all',status:'all',from:'',to:''};
const item={id:'request:uuid',source:'request',occurredAt:'2020-10-20T10:00:00.123456Z',wallet:`0x${'1'.repeat(40)}`,username:'alice',action:'sell',status:'confirmed',requestState:'confirmed',
  market:{id:3,question:'Who wins?'},outcomeIndex:'0',requested:{amount:'10',unit:'shares'},executed:{collateral:'4.500000',shares:'10.000000',fee:'0.250000'},
  txHash:`0x${'2'.repeat(64)}`,indexed:true,receiptFeeEth:'0.0000042',steps:[{step:'share_approval',nonce:'0',status:'confirmed',txHash:`0x${'3'.repeat(64)}`,receiptFeeEth:'0.0000021'}]};
const report={asOf:'2026-10-21T12:00:00.000Z',items:[item],nextCursor:'page-2'};
const presentation=props=>renderToStaticMarkup(React.createElement(TransactionsPresentation,{filters,change(){},submit(){},refresh(){},next(){},previous(){},...props}));

test('history shows execution/indexing separately, net sell proceeds, approval links and distinct gas budget',()=>{
  const html=presentation({report});
  assert.match(html,/@alice/);assert.match(html,/Who wins/);assert.match(html,/Received: 4.500000 MXNP/);
  assert.match(html,/0.250000 MXNP/);assert.match(html,/0.0000042 ETH/);assert.match(html,/share_approval/);assert.match(html,/nonce 0/);
  assert.match(html,/https:\/\/sepolia.arbiscan.io\/tx\//);assert.match(html,/Snapshot started/);assert.match(html,/external wallet transfers/i);
  assert.doesNotMatch(html,/4.250000|Retry trade|Send ETH|Sign transaction/);
  const pending=presentation({report:{...report,items:[{...item,status:'confirmed',indexed:false,executed:null,receiptFeeEth:null}]}});
  assert.match(pending,/Awaiting indexing/);assert.match(pending,/Executed amount unavailable/);assert.doesNotMatch(pending,/Received:|0.250000 MXNP/);
  const gas=presentation({report:{...report,items:[{...item,action:'gas_topup',market:null,indexed:null,executed:null,requested:{amount:'0.00005',unit:'ETH'},budgetMaxCostEth:'0.00009',receiptFeeEth:null}]}});
  assert.match(gas,/Confirmed top-up: 0.00005 ETH/);assert.match(gas,/Maximum budget reservation: 0.00009 ETH/);assert.match(gas,/not gas spent/);
});

test('unavailable, empty and loading history have distinct states; provider errors are never displayed',()=>{
  assert.match(presentation({loading:true}),/role="status"/);
  const unavailable=presentation({error:'private-provider-url'});assert.match(unavailable,/role="alert"/);assert.doesNotMatch(unavailable,/private-provider-url|No activity matches/);
  assert.match(presentation({error:'invalid_transaction_filters'}),/Check the filters/);
  assert.match(presentation({report:{...report,items:[],nextCursor:null}}),/No activity matches/);
});

test('mounted history filters and paginates, isolates accounts and discards stale/error snapshots',async t=>{
  const {window,document}=parseHTML('<html><body><div id="root"></div></body></html>');
  const previous={window:global.window,document:global.document,act:global.IS_REACT_ACT_ENVIRONMENT};
  global.window=window;global.document=document;global.IS_REACT_ACT_ENVIRONMENT=true;
  const {createRoot}=require('react-dom/client');const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await React.act(async()=>root.unmount());global.window=previous.window;global.document=previous.document;global.IS_REACT_ACT_ENVIRONMENT=previous.act;});
  const mount=async(isAdmin=true)=>React.act(async()=>root.render(React.createElement(AdminOnchainTransactions,{isAdmin})));
  const click=async text=>React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent===text).click());
  await mount(false);assert.equal(requests.length,0);
  execution={enabled:true,durableTrades:false};await mount();assert.equal(requests.length,0);
  execution={enabled:true,durableTrades:true};await mount();assert.equal(requests.length,1);
  assert.equal(requests[0].url,'/api/points/admin/onchain-transactions');
  await React.act(async()=>requests.shift().resolve(report));assert.match(document.body.textContent,/@alice/);
  await click('Next page');assert.equal(new URL(requests[0].url,'https://preview').searchParams.get('cursor'),'page-2');
  assert.doesNotMatch(document.body.textContent,/@alice/);
  await React.act(async()=>requests.shift().resolve({...report,items:[{...item,username:'second-page'}],nextCursor:null}));
  assert.match(document.body.textContent,/@second-page/);
  await click('Previous page');assert.equal(requests[0].url,'/api/points/admin/onchain-transactions');
  await React.act(async()=>requests.shift().resolve(report));
  const input=document.querySelector('input[name="username"]');
  // Call React's input change listener directly: linkedom does not implement
  // the browser's native input setter used by React's value tracker.
  const propsKey=Object.keys(input).find(key=>key.startsWith('__reactProps$'));
  await React.act(async()=>input[propsKey].onChange({target:{value:'bob'}}));
  await React.act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(new URL(requests[0].url,'https://preview').searchParams.get('username'),'bob');
  assert.equal(new URL(requests[0].url,'https://preview').searchParams.has('cursor'),false);
  await React.act(async()=>requests.shift().reject(Object.assign(new Error('private-provider'),{code:'invalid_transaction_filters'})));
  assert.match(document.body.textContent,/Check the filters/);assert.doesNotMatch(document.body.textContent,/@alice|private-provider|No activity matches/);
  await click('Refresh history');const oldOwner=requests.shift();
  auth={authenticated:true,user:{username:'new-admin',suborgId:'owner-b'}};await mount();
  assert.equal(requests[0].url,'/api/points/admin/onchain-transactions');
  assert.equal(document.querySelector('input[name="username"]').value,'');
  await React.act(async()=>oldOwner.resolve(report));assert.doesNotMatch(document.body.textContent,/@alice/);
  await React.act(async()=>requests.shift().resolve({...report,items:[],nextCursor:null}));assert.match(document.body.textContent,/No activity matches/);
  auth={authenticated:false,user:null};await mount();assert.equal(document.getElementById('root').textContent,'');
});
