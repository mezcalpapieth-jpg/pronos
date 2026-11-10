import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { ethers } from 'ethers';
import { SETTLEMENT_MIGRATION, settlementSettings, settlementInput, assertSettlementMarket, settleOnchainMarket,
  loadSettlementMarket, loadPublishedResolution, settlementQueueReviewHash, settlementSourceHash } from './onchain-admin-settlement.js';
import { REVIEW_EVENT_ABI } from './protocol-resolution-review.js';
import { TRADE_REQUEST_SCHEMA } from './trade-request-store.js';
import { tradePayloadHash } from './trade-requests.js';

const wallet=new ethers.Wallet(`0x${'12'.repeat(32)}`),addr=n=>`0x${String(n).repeat(40)}`;
import {preview} from './test-support/sepolia-settlement.mjs';

const iface=new ethers.utils.Interface([...REVIEW_EVENT_ABI, 'function proposeResolution(uint256,uint8,bytes32)','function resolveMarket(uint256,uint8)','function cancelMarket(uint256)',
  'function openResolutionDispute(uint256)','function clearResolutionDispute(uint256)','function correctResolution(uint256,uint8)',
  'event MarketResolved(uint256 indexed marketId,uint8 outcome)','event MarketCanceled(uint256 indexed marketId)',
  'event ResolutionDisputeOpened(uint256 indexed marketId)','event ResolutionDisputeCleared(uint256 indexed marketId)',
  'event MarketResolutionCorrected(uint256 indexed marketId,uint8 oldOutcome,uint8 newOutcome)']);
async function fixture(t,{variant='v1',timeout=false,status='active'}={}) {
  const db=new PGlite();t.after(()=>db.close());
  for(const ddl of TRADE_REQUEST_SCHEMA)await db.exec(ddl);
  for(const ddl of SETTLEMENT_MIGRATION)await db.exec(ddl);
  await db.exec(`CREATE TABLE points_markets(id int,mode text,chain_id int,chain_address text,chain_market_id text,parent_id int,amm_mode text,question text,
      resolver_type text,resolver_config jsonb,outcomes jsonb,start_time timestamptz,end_time timestamptz,sport text,league text,status text);
    CREATE TABLE points_pending_markets(id int,approved_market_id int,source_data jsonb);
    CREATE TABLE protocol_markets(id int,chain_id int,factory_address text,pool_address text,market_id bigint,protocol_version text,outcome_count int,status text,outcome int,resolver_config jsonb,resolver_type text,outcomes jsonb,tx_hash text, resolution_review jsonb);
    INSERT INTO points_markets VALUES(42,'onchain',421614,'${addr(4)}','0',null,'unified','Fixture',
      'sports_api','{}','["Yes","No"]',null,now()-interval '1 hour',null,null,'active');
    INSERT INTO protocol_markets VALUES(99,421614,'${addr(variant==='v2'?2:1)}','${addr(4)}',0,'${variant}',${variant==='v2'?3:2},'${status}',null,'{}','sports_api','["Yes","No"]',null,null);`);
  const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
  let nonce=0,receipt=null,receiptReady=!timeout,fee='10000000',balance=ethers.utils.parseEther('1'),chain=421614,binding=addr(4);
  const signed=[],sent=[];
  const provider={call:async()=> '0x',getNetwork:async()=>({chainId:chain}),getGasPrice:async()=>ethers.BigNumber.from(fee),getBalance:async()=>balance,
    getTransactionCount:async(_wallet,tag)=>nonce+(tag==='pending'&&sent.length&&!receipt?1:0),
    getTransactionReceipt:async()=>receiptReady?receipt:null,
    waitForTransaction:async()=>receiptReady?receipt:null,
    sendTransaction:async raw=>{
      sent.push(raw);const tx=ethers.utils.parseTransaction(raw),decoded=iface.parseTransaction(tx);let name,args;
      const functions={resolveMarket:'MarketResolved',cancelMarket:'MarketCanceled',openResolutionDispute:'ResolutionDisputeOpened',clearResolutionDispute:'ResolutionDisputeCleared',correctResolution:'MarketResolutionCorrected'};
      name=functions[decoded.name];args=decoded.name==='correctResolution'?[decoded.args[0],1,decoded.args[1]]:[...decoded.args];
      if (decoded.name === 'proposeResolution') {
        name = 'ResolutionProposed';
        args = [decoded.args[0], ethers.utils.id('proposal'), wallet.address, decoded.args[1], decoded.args[2], 1, 100000];
      }
      const log=iface.encodeEventLog(iface.getEvent(name),args);
      receipt={transactionHash:tx.hash,status:1,blockNumber:10,logs:[{address:tx.to,...log}]};if(receiptReady)nonce=tx.nonce+1;
    }};
  const sign=async({unsignedTx})=>{signed.push(unsignedTx);return wallet.signTransaction(ethers.utils.parseTransaction(unsignedTx));};
  const dispatch={
    resolveMarketOnChain:async a=>{const receipt=a.execution.receipt||await a.execution.send({suborgId:a.resolverSuborgId,from:a.resolverAddr,to:a.factoryAddress,
      data:iface.encodeFunctionData('resolveMarket',[a.marketId,a.outcome+(variant==='v1'?1:0)]),gasLimit:250000,step:'trade'});return {txHash:receipt.transactionHash,blockNumber:receipt.blockNumber};},
    lifecycleMarketOnChain:async a=>{const fn={cancel:'cancelMarket',dispute:'openResolutionDispute',clear_dispute:'clearResolutionDispute',correct_resolution:'correctResolution'}[a.action];
      const args=a.action==='correct_resolution'?[a.marketId,a.outcome+(variant==='v1'?1:0)]:[a.marketId];
      const receipt=a.execution.receipt||await a.execution.send({suborgId:a.ownerSuborgId,from:a.ownerAddr,to:a.factoryAddress,
        data:iface.encodeFunctionData(fn,args),gasLimit:a.action==='cancel'?350000:250000,step:'trade'});return {txHash:receipt.transactionHash,blockNumber:receipt.blockNumber};},
  };
  const input={marketId:42,action:'resolve',outcome:0,reason:'Reviewed evidence'};
  return {db,sql,signed,sent,input,provider,sign,dispatch,
    set(options){if(options.fee)fee=options.fee;if(options.balance)balance=ethers.utils.parseEther(options.balance);if(options.chain)chain=options.chain;if(options.binding)binding=options.binding;if(options.ready){receiptReady=true;nonce=1;}},
    run:async(extra={})=>settleOnchainMarket({sql,provider,env:preview,sign,input,key:'fixture_request_123',actor:'frmm',dispatch,
      contractAt:()=>({getMarket:async()=>[binding],collateral:async()=>addr(3)}),...extra})};
}

test('settlement gates production, other branches/chains/databases and disabled flags',()=>{
  assert.equal(settlementSettings(preview).configured,true);
  for(const change of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'pointbreak'},{ONCHAIN_CHAIN_ID:'42161'},
    {DATABASE_URL:'postgresql://x:x@production.invalid/neondb'},{ONCHAIN_ADMIN_SETTLEMENT_ENABLED:'false'},{ONCHAIN_DURABLE_TRADES_ENABLED:'false'}])assert.equal(settlementSettings({...preview,...change}).configured,false);
});
test('input and exact market identity reject missing/forged fields, parallel legs and malformed IDs',()=>{
  assert.deepEqual(settlementInput({marketId:42,action:'resolve',outcome:0,reason:' Evidence '}),{marketId:42,action:'resolve',outcome:0,reason:'Evidence'});
  for(const change of [{marketId:0},{outcome:'0'},{outcome:-1},{reason:''},{factoryAddress:addr(1)},{action:'reopen'},{reviewHash:'invalid'}])assert.throws(()=>settlementInput({marketId:42,action:'resolve',outcome:0,reason:'Evidence',...change}));
  const m={mode:'onchain',points_chain_id:421614,chain_id:421614,protocol_version:'v1',protocol_id:99,pool_address:addr(4),chain_address:addr(4),chain_market_id:'0',contract_id:'0',factory_address:addr(1)};
  assert.equal(assertSettlementMarket(m,preview),m);
  for(const change of [{mode:'points'},{protocol_version:null},{contract_id:null},{chain_market_id:'99'},{factory_address:addr(2)},{chain_id:42161},{parent_id:1},{amm_mode:'parallel'}])assert.throws(()=>assertSettlementMarket({...m,...change},preview));
});
for(const variant of ['v1','v2'])test(`${variant} exact zero contract ID settles once; replay after indexing uses no second nonce/signature`,async t=>{
  const f=await fixture(t,{variant});const result=await f.run();assert.equal(result.httpStatus,200);assert.equal(result.body.protocolMarketId,99);assert.equal(result.body.marketId,42);
  assert.equal(f.signed.length,1);assert.equal(iface.parseTransaction(ethers.utils.parseTransaction(f.sent[0])).args[0].toString(),'0');
  await f.db.exec("UPDATE protocol_markets SET status='resolved'");
  const replay=await f.run();assert.equal(replay.body.txHash,result.body.txHash);assert.equal(f.signed.length,1);assert.equal(f.sent.length,1);
  assert.equal((await f.db.query('SELECT mode FROM points_markets')).rows[0].mode,'onchain');
});

test('timed-out signature resumes from the same hash after source/DB state changes',async t=>{
  const f=await fixture(t,{timeout:true});const first=await f.run();assert.equal(first.httpStatus,202);
  await f.db.exec("UPDATE protocol_markets SET status='resolved'");f.set({ready:true});
  const replay=await f.run();assert.equal(replay.httpStatus,200);assert.equal(f.signed.length,1);assert.equal(first.body.txHash,replay.body.txHash);
});
test('a crash before planning retains original source evidence and rejects changed resolver configuration on recovery',async t=>{
  const f=await fixture(t),m=await loadSettlementMarket(f.sql,42,preview),expectedSourceHash=settlementSourceHash(m);
  await assert.rejects(f.run({origin:'scheduler',expectedSourceHash,evidence:{finalScore:'2-1'},runner:async args=>{
    await args.store.create({id:'11111111-1111-1111-1111-111111111111',wallet:wallet.address.toLowerCase(),suborg:args.suborg,key:args.key,
      action:args.action,payload:args.payload,hash:tradePayloadHash({chainId:421614,action:args.action,payload:args.payload})});
    throw Error('simulated process exit');
  }}),/simulated process exit/);
  await f.db.exec(`UPDATE protocol_markets SET resolver_config='{"source":"changed"}'`);
  const result=await f.run();assert.equal(result.httpStatus,409);assert.equal(result.body.error,'settlement_source_changed');assert.equal(f.signed.length,0);
  const row=(await f.db.query('SELECT payload FROM sepolia_trade_requests')).rows[0];assert.equal(row.payload.review.evidence.finalScore,'2-1');
});
test('same key with changed outcome conflicts; an unresolved wallet rejects another intent',async t=>{
  const f=await fixture(t,{timeout:true});await f.run();
  await assert.rejects(f.run({input:{...f.input,outcome:1}}),/idempotency_key_conflict/);
  const second=await f.run({key:'another_request_123'});assert.equal(second.httpStatus,409);assert.equal(f.signed.length,1);
});
test('a queue resolution never signs when its published evidence changes after review', async t => {
  const f = await fixture(t);
  const market = await loadSettlementMarket(f.sql, 42, preview);
  const published = await loadPublishedResolution(f.sql, 42);
  const input = { ...f.input, reviewHash: settlementQueueReviewHash(market, published) };
  await f.db.exec(`UPDATE points_markets SET resolver_config='{"source":"changed"}'`);
  const result = await f.run({ input });
  assert.equal(result.httpStatus, 409);
  assert.equal(result.body.error, 'settlement_source_changed');
  assert.equal(f.signed.length, 0);
});
test('queue settlement rechecks current payout backing and only signs a funded outcome once', async t => {
  const f = await fixture(t);
  const market = await loadSettlementMarket(f.sql, 42, preview);
  const input = { ...f.input, reviewHash: settlementQueueReviewHash(market, await loadPublishedResolution(f.sql, 42)) };
  const block = { number: 10, timestamp: 100, hash: '0x' + 'ab'.repeat(32) };
  f.provider.getBlock = async () => block;
  let collateral = 5n;
  const read = value => async () => value;
  const contractAt = address => ({
    [addr(1)]: { getMarket: read([addr(4), 'Fixture', 'general', 99, '', true]), collateral: read(addr(3)) },
    [addr(3)]: { balanceOf: async () => collateral },
    [addr(4)]: { resolved: read(false), disputed: read(false), canceled: read(false), token: read(addr(5)), collateral: read(addr(3)) },
    [addr(5)]: { yesTokenId: read(0), totalSupply: read(10n), balanceOf: read(2n) },
  })[address];

  const rejected = await f.run({ input, contractAt });
  assert.equal(rejected.httpStatus, 409);
  assert.equal(rejected.body.error, 'settlement_resolution_pool_shortfall');
  assert.equal(f.signed.length, 0);
  collateral = 8n;
  const args = { input, contractAt, key: 'funded_review_123' };
  const settled = await f.run(args);
  assert.equal(settled.httpStatus, 200);
  await f.db.exec("UPDATE protocol_markets SET status='resolved'");
  assert.equal((await f.run(args)).body.txHash, settled.body.txHash);
  assert.equal(f.signed.length, 1);
});
for(const [action,status] of [['cancel','active'],['dispute','resolved'],['clear_dispute','disputed'],['correct_resolution','disputed']])test(`${action} is an owner action and does not pay refunds or mutate Points`,async t=>{
  const f=await fixture(t,{status});const input={...f.input,action,outcome:action==='correct_resolution'?1:null};
  const result=await f.run({input});assert.equal(result.httpStatus,200);assert.equal(result.body.refundsPaid,false);
  assert.equal((await f.db.query('SELECT status FROM protocol_markets')).rows[0].status,status);
});
test('wrong chain/binding, low reserves, expensive fees and exhausted budget never sign',async t=>{
  for(const option of [{chain:42161},{binding:addr(5)},{balance:'0.00001'},{fee:'200000000'}]) {
    const f=await fixture(t);f.set(option);try{await f.run();}catch{}assert.equal(f.signed.length,0);
  }
  const f=await fixture(t);await f.db.exec(`INSERT INTO sepolia_trade_requests(id,chain_id,wallet_address,suborg_id,request_key,action,payload_hash,payload,plan,status)
    VALUES('11111111-1111-1111-1111-111111111111',421614,'${wallet.address.toLowerCase()}','ops','old_budget_request','admin_resolve','hash','{}','{"maxCostWei":"5000000000000000"}','confirmed')`);
  const result=await f.run();assert.equal(result.httpStatus,429);assert.equal(f.signed.length,0);
});

for (const variant of ['v1', 'v2']) test(`${variant} reviewed Sepolia resolver commits evidence and records a proposal with durable retries`, async t => {
  const f = await fixture(t, { variant, timeout: true });
  const env = { ...preview, ONCHAIN_SEPOLIA_REVIEW_ENABLED: 'true' };
  await f.db.query('UPDATE protocol_markets SET resolution_review=$1', [{ state: 'open', rulesHash: ethers.utils.id('rules') }]);
  await f.db.exec(`CREATE TABLE protocol_resolution_documents(hash text PRIMARY KEY, content text);
    UPDATE points_markets SET outcomes='["Lakers","Hawks"${variant === 'v2' ? ',"Draw"' : ''}]',
      resolver_config='{"source":"espn","leaguePath":"basketball/nba","eventId":"123"}'`);
  f.provider.getBlock = async () => ({ number: 10, timestamp: 100, hash: ethers.utils.id('block') });
  const read = value => async () => value;
  const factory = addr(variant === 'v2' ? 2 : 1);
  const contractAt = address => ({
    [factory]: { getMarket: read([addr(4), 'Fixture', 'general', 99, '', ...(variant === 'v2' ? [3] : []), true]), collateral: read(addr(3)) },
    [addr(3)]: { balanceOf: read(100n) },
    [addr(4)]: { resolved: read(false), disputed: read(false), canceled: read(false), token: read(addr(5)), collateral: read(addr(3)) },
    [addr(5)]: { yesTokenId: read(0), tokenId: read(0), totalSupply: read(10n), balanceOf: read(2n) },
  })[address];
  const options = { env, contractAt };
  const pending = await f.run(options);
  assert.equal(pending.httpStatus, 202, JSON.stringify(pending.body));
  assert.equal(f.signed.length, 1);
  const call = iface.parseTransaction(ethers.utils.parseTransaction(f.sent[0]));
  assert.equal(call.name, 'proposeResolution');
  assert.equal(call.args[1], variant === 'v1' ? 1 : 0);
  const [document] = (await f.db.query('SELECT hash, content FROM protocol_resolution_documents')).rows;
  assert.equal(call.args[2], ethers.utils.id(document.content));
  assert.match(document.content, /Lakers/);
  assert.match(document.content, /basketball\/nba/);
  await f.db.exec("UPDATE protocol_markets SET status='under_review'");
  f.set({ ready: true });
  const confirmed = await f.run(options);
  assert.equal(confirmed.body.proposalId, ethers.utils.id('proposal'));
  assert.equal(confirmed.body.txHash, pending.body.txHash);
  assert.equal(f.signed.length, 1);
});
