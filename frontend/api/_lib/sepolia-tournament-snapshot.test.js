import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ethers } from 'ethers';
import { buildTournamentPlan, planHash, MINT_ABI } from './sepolia-tournament.js';
import { buildTournamentSnapshot, tournamentMarketRegistry } from './sepolia-tournament-snapshot.js';
import { snapshotCommand } from '../scripts/onchain-sepolia-snapshot.mjs';

const addr = n => `0x${n.toString(16).padStart(40,'0')}`;
const hash = n => `0x${n.toString(16).padStart(64,'0')}`;
const base = Date.parse('2026-11-01T00:00:00Z') / 1000;
const routerCode = '0x6001';
function fixture({ resolved=false }={}) {
  const deployment = (n=0) => ({ chainId:421614, token:addr(n+1), factoryV1:addr(n+2),
    factoryV2:addr(n+3), shareV1:addr(n+4), shareV2:addr(n+5), router:addr(n+6),
    owner:addr(90), operations:addr(91), routerCodeHash:ethers.utils.keccak256(routerCode) });
  const plan = buildTournamentPlan({ deployment:deployment(), previousDeployment:deployment(100),
    users:[{username:'alice',wallet_address:addr(30),turnkey_sub_org_id:'alice'}],
    cycleId:'cycle-two',label:'Second cycle', startsAt:'2026-11-01T00:00:00Z',endsAt:'2026-12-01T00:00:00Z',
    liquidityMxnp:'1000',maxTotalMxnp:'1500' });
  const contracts = new Map(), receipts = new Map(), transactions = new Map(), logs = [];
  function contract(at, signatures, state) {
    contracts.set(at,{abi:new ethers.utils.Interface(signatures.map(s=>`function ${s}`)),state});
  }
  contract(addr(1),['totalSupply() view returns(uint256)','decimals() view returns(uint8)'],{totalSupply:plan.totalUnits,decimals:6});
  contract(addr(6),['factoryV1','factoryV2','collateral','tokenV1','tokenV2'].map(s=>`${s}() view returns(address)`),
    {factoryV1:addr(2),factoryV2:addr(3),collateral:addr(1),tokenV1:addr(4),tokenV2:addr(5)});
  const block = n => ({ number:n,hash:hash(n),timestamp:base+n-100 });
  function addReceipt(txHash,n,rows) {
    const enriched = rows.map(row=>({...row,blockNumber:n,blockHash:hash(n),transactionHash:txHash,removed:false}));
    receipts.set(txHash,{status:1,transactionHash:txHash,blockNumber:n,blockHash:hash(n),logs:enriched});
    logs.push(...enriched);return enriched;
  }
  function encoded(abi,name,args,at,logIndex=0) {
    return {address:at,...abi.encodeEventLog(abi.getEvent(name),args),logIndex};
  }
  const mint = new ethers.utils.Interface(MINT_ABI), batch=plan.batches[0];
  addReceipt(hash(500),90,batch.recipients.map((r,i)=>encoded(mint,'Transfer',[ethers.constants.AddressZero,r.wallet,r.units],addr(1),i)));
  transactions.set(hash(500),{hash:hash(500),blockHash:hash(90),blockNumber:90,chainId:421614,
    from:addr(90),to:addr(1),value:0,data:mint.encodeFunctionData('batchMint',[batch.recipients.map(r=>r.wallet),batch.recipients.map(r=>r.units)])});
  const registryRows = [], eventAbis = {};
  for (const v of [1,2]) {
    const pool=addr(39+v),factory=addr(1+v),shares=addr(3+v);
    contract(factory,['marketCount() view returns(uint256)','collateral() view returns(address)',
      'token() view returns(address)','tradingRouter() view returns(address)',
      `markets(uint256) view returns(address pool,string question,string category,uint256 endTime,string resolutionSource,${v===2?'uint8 outcomeCount,':''}bool active)`],
    {marketCount:1,collateral:addr(1),token:shares,tradingRouter:addr(6),markets:[pool,'Question','test',base+1000,'source',...(v===2?[3]:[]),true]});
    contract(shares,['owner() view returns(address)'],{owner:factory});
    contract(pool,['factory() view returns(address)','collateral() view returns(address)','token() view returns(address)',
      'marketId() view returns(uint256)','outcomeCount() view returns(uint8)',
      ...['initialized','canceled','disputed','resolved'].map(s=>`${s}() view returns(bool)`),
      'outcome() view returns(uint8)','priceYes() view returns(uint256)','priceNo() view returns(uint256)','prices() view returns(uint256[])'],
    {factory,collateral:addr(1),token:shares,marketId:0,outcomeCount:3,initialized:true,canceled:false,disputed:false,
      resolved,outcome:v===1?1:2,priceYes:'500000',priceNo:'500000',prices:['333333','333333','333333']});
    const created = new ethers.utils.Interface([v===1
      ? 'event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime)'
      : 'event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime,string resolutionSource,string[] outcomes)']);
    addReceipt(hash(500+v),94+v,[encoded(created,'MarketCreated',[0,pool,'Question','test',base+1000,...(v===2?['source',['A','B','C']]:[])],factory)]);
    registryRows.push({factory,pool,marketId:'0',creationTxHash:hash(500+v),creationLogIndex:0});
    const abi = new ethers.utils.Interface([
      v===1?'event SharesBought(address indexed buyer,bool isYes,uint256 collateralIn,uint256 fee,uint256 sharesOut)'
        :'event SharesBought(address indexed buyer,uint8 indexed outcomeIndex,uint256 collateralIn,uint256 fee,uint256 sharesOut)',
      'event SharesSold(address indexed seller,bool isYes,uint256 sharesIn,uint256 collateralOut,uint256 fee)',
      v===1?'event WinningsRedeemed(address indexed user,uint256 shares,uint256 payout)'
        :'event WinningsRedeemed(address indexed user,uint8 indexed outcomeIndex,uint256 shares,uint256 payout)',
      'event MarketResolved(uint256 indexed marketId,uint8 outcome)',
      'event ResolutionDisputeOpened(uint256 indexed marketId,uint8 outcome)',
      'event ResolutionDisputeCleared(uint256 indexed marketId,uint8 outcome)',
      'event MarketResolutionCorrected(uint256 indexed marketId,uint8 oldOutcome,uint8 newOutcome)',
      'event MarketCanceled(uint256 indexed marketId)',
    ]);
    eventAbis[v]=abi;
    addReceipt(hash(600+v),110,[encoded(abi,'SharesBought',[addr(30),v===1?true:2,v===1?'100000000':'60000000','1000000',v===1?'180000000':'170000000'],pool,v-1)]);
    if (v===1) addReceipt(hash(610),120,[encoded(abi,'SharesSold',[addr(30),true,'90000000','45000000','1000000'],pool)]);
    if (resolved) {
      addReceipt(hash(620+v),130,[encoded(abi,'MarketResolved',[0,v===1?1:2],pool,v-1)]);
      addReceipt(hash(630+v),140,[encoded(abi,'WinningsRedeemed',[addr(30),...(v===2?[2]:[]),v===1?'90000000':'170000000',v===1?'90000000':'170000000'],pool,v-1)]);
    }
  }
  const calls=[];
  const provider = {
    getNetwork:async()=>({chainId:421614}),getBlockNumber:async()=>201,getBlock:async n=>block(n),
    getTransactionReceipt:async h=>receipts.get(h),getTransaction:async h=>transactions.get(h),
    getCode:async(at,n)=>{assert.equal(at,addr(6));assert.equal(n,200);return routerCode;},
    call:async(tx,n)=>{
      assert.equal(n,200,'every mark/binding must use the pinned historical block');calls.push(tx);
      const c=contracts.get(tx.to), decoded=c.abi.parseTransaction(tx), value=c.state[decoded.name];
      return c.abi.encodeFunctionResult(decoded.name,decoded.name==='markets'?value:[value]);
    },
    getLogs:async filter=>logs.filter(l=>l.address===filter.address && l.blockNumber>=filter.fromBlock
      && l.blockNumber<=filter.toBlock && filter.topics[0].includes(l.topics[0])),
    sendTransaction:()=>assert.fail('snapshot must never send a transaction'),
    getSigner:()=>assert.fail('snapshot must never request a signer'),
  };
  const registry=tournamentMarketRegistry({cycleId:plan.cycleId,planHash:planHash(plan),markets:registryRows});
  const input={cycle:{plan,plan_hash:planHash(plan),status:'funded'},reviewedPlanHash:planHash(plan),
    registry,reviewedRegistryHash:planHash(registry),funding:[{batchIndex:0,txHash:hash(500)}],fromBlock:100,asOfBlock:200};
  const options={provider,readIndexerCoverage:async()=>[2,3].map(n=>({chainId:421614,factory:addr(n),lastBlock:200}))};
  return {input,options,contracts,receipts,transactions,logs,calls,eventAbis,addReceipt,encoded,block};
}
const run = f => buildTournamentSnapshot(f.input,f.options);

test('canonical binary/multi marks and gross/net logs produce a reproducible private shadow artifact',async()=>{
  const f=fixture(), before=structuredClone(f.input), result=await run(f);
  assert.deepEqual(f.input,before);assert.equal(result.snapshot.events.length,3);
  assert.equal(result.snapshot.events[0].timestamp,'2026-11-01T00:00:10.000Z');
  assert.equal(result.snapshot.events[2].collateralUnits,'45000000');
  assert.equal(result.scores.rows[0].cashUnits,'385000000');
  assert.equal(result.scores.rows[0].openValueUnits,'101666610');
  assert.equal(result.readyForRewards,false);assert.equal(result.mode,'shadow');
  assert.deepEqual(await run(f),result);
  const {snapshotHash,...body}=result;assert.equal(snapshotHash,planHash(body));
});
test('resolved V1/V2 redemption maps winners and converts holdings into cash once',async()=>{
  const result=await run(fixture({resolved:true}));
  assert.deepEqual(result.snapshot.markets.map(m=>m.winner),[0,2]);
  assert.equal(result.scores.rows[0].equityUnits,'645000000');
  assert.equal(result.scores.rows[0].openValueUnits,'0');
});
test('unreviewed plans/registries, wrong-chain RPC and insufficient finality refuse before marking',async()=>{
  for (const mutate of [f=>f.input.reviewedPlanHash='0'.repeat(64),f=>f.input.reviewedRegistryHash='0'.repeat(64),
    f=>f.input.cycle.status='prepared',f=>f.options.provider.getNetwork=async()=>({chainId:42161}),
    f=>f.options.provider.getBlockNumber=async()=>200]) {
    const f=fixture();mutate(f);await assert.rejects(run(f));assert.equal(f.calls.length,0);
  }
});
test('the first cycle block is proved from its predecessor; gaps and post-cycle cutoffs fail',async()=>{
  for (const mutate of [f=>f.input.fromBlock=101,f=>f.input.fromBlock=99,
    f=>f.options.provider.getBlock=async n=>({...f.block(n),timestamp:n===200?base+3_000_000:f.block(n).timestamp}),
    f=>f.input.asOfBlock=2_000_101]) {
    const f=fixture();mutate(f);await assert.rejects(run(f));
  }
});
test('both factory indexer checkpoints must cover the cutoff without duplicates',async()=>{
  for (const coverage of [[],[{chainId:421614,factory:addr(2),lastBlock:199}],
    [2,2,3].map(n=>({chainId:421614,factory:addr(n),lastBlock:200}))]) {
    const f=fixture();f.options.readIndexerCoverage=async()=>coverage;
    await assert.rejects(run(f),/incomplete_indexer_coverage/);
  }
});
test('funding requires exact final pre-start mint payloads and allocation receipts',async()=>{
  for (const mutate of [f=>f.input.funding=[],f=>f.input.funding.push(f.input.funding[0]),
    f=>f.transactions.get(hash(500)).from=addr(99),f=>f.transactions.get(hash(500)).value=1,
    f=>f.transactions.get(hash(500)).data='0x',f=>f.receipts.get(hash(500)).logs.pop(),
    f=>f.options.provider.getBlock=async n=>({...f.block(n),timestamp:n===90?base:f.block(n).timestamp}),
    f=>f.contracts.get(addr(1)).state.totalSupply='999']) {
    const f=fixture();mutate(f);await assert.rejects(run(f));
  }
});
test('market registries cannot omit new factory markets or forge membership/creation/bindings',async()=>{
  for (const mutate of [f=>f.contracts.get(addr(2)).state.marketCount=2,
    f=>f.contracts.get(addr(2)).state.markets[0]=addr(99),
    f=>f.receipts.get(hash(501)).logs[0].address=addr(99),
    f=>f.contracts.get(addr(40)).state.collateral=addr(99),
    f=>f.contracts.get(addr(40)).state.marketId=1,
    f=>f.contracts.get(addr(41)).state.outcomeCount=4,
    f=>f.contracts.get(addr(4)).state.owner=addr(99),
    f=>f.options.provider.getCode=async()=> '0x',
    f=>f.contracts.get(addr(6)).state.factoryV1=addr(99)]) {
    const f=fixture();mutate(f);await assert.rejects(run(f));
  }
});
test('removed, forged, reverted, out-of-range and reorged log receipts fail closed',async()=>{
  for (const mutate of [f=>f.logs.find(l=>l.transactionHash===hash(601)).removed=true,
    f=>f.receipts.get(hash(601)).status=0,
    f=>f.receipts.get(hash(601)).blockHash=hash(999),
    f=>{const original=f.options.provider.getLogs;f.options.provider.getLogs=async q=>(await original(q)).map(l=>({...l,data:'0x'}));},
    f=>{const original=f.options.provider.getLogs;f.options.provider.getLogs=async q=>(await original(q)).map(l=>({...l,blockNumber:201}));}]) {
    const f=fixture();mutate(f);await assert.rejects(run(f));
  }
  const f=fixture(),seen=new Set();
  f.options.provider.getBlock=async n=>{const b=f.block(n);if(seen.has(n))b.hash=hash(999);seen.add(n);return b;};
  await assert.rejects(run(f),/snapshot_reorg/);
});
test('historical cancellation, dispute/clear and correction reject even a currently active pool',async()=>{
  for(const name of ['MarketCanceled','ResolutionDisputeOpened','ResolutionDisputeCleared','MarketResolutionCorrected']) {
    const f=fixture(), abi=f.eventAbis[1];
    f.addReceipt(hash(700),150,[f.encoded(abi,name,name==='MarketCanceled'?[0]:name==='MarketResolutionCorrected'?[0,1,2]:[0,1],addr(40))]);
    await assert.rejects(run(f),/unsupported_market_lifecycle/);
  }
});
test('resolved state must match exactly one canonical resolution and its winner',async()=>{
  const f=fixture({resolved:true});f.logs.splice(f.logs.findIndex(l=>l.transactionHash===hash(621)),1);
  await assert.rejects(run(f),/resolution_history_mismatch/);
  const mismatch=fixture({resolved:true});mismatch.contracts.get(addr(40)).state.outcome=2;
  await assert.rejects(run(mismatch),/resolution_mark_mismatch/);
});
test('duplicate RPC logs deduplicate; resource limits refuse an oversized response',async()=>{
  const f=fixture(),original=f.options.provider.getLogs;
  f.options.provider.getLogs=async q=>{const rows=await original(q);return [...rows,...rows];};
  assert.equal((await run(f)).snapshot.events.length,3);
  const flood=fixture();flood.options.provider.getLogs=async()=>Array(50_001).fill(flood.logs[0]);
  await assert.rejects(run(flood),/snapshot_log_budget_exceeded/);
});
test('operator CLI explains read-only use and refuses missing/production configuration without output',()=>{
  const script=new URL('../scripts/onchain-sepolia-snapshot.mjs',import.meta.url).pathname;
  const help=spawnSync(process.execPath,[script,'--help'],{encoding:'utf8'});
  assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/Read-only shadow snapshot/);
  const refused=spawnSync(process.execPath,[script,'--input','missing','--output','missing'],
    {encoding:'utf8',env:{...process.env,ONCHAIN_SNAPSHOT_DATABASE_URL:'postgresql://production.invalid/db'}});
  assert.equal(refused.status,1);assert.equal(refused.stdout,'');assert.match(refused.stderr,/Snapshot refused/);
});

test('operator pipeline reads only public audit columns, handles both Neon result shapes and saves private immutable output',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pronos-snapshot-'));
  try {
    for (const wrapped of [false,true]) {
      const f=fixture(), output=join(dir,`snapshot-${wrapped}.json`), input=join(dir,'request.json'), queries=[];
      await writeFile(input,JSON.stringify({cycleId:'cycle-two',fromBlock:100,asOfBlock:200,registry:f.input.registry}));
      const args={input,output,'reviewed-plan-hash':f.input.reviewedPlanHash,'reviewed-registry-hash':f.input.reviewedRegistryHash};
      const dependencies={
        env:{ONCHAIN_SNAPSHOT_DATABASE_URL:'postgresql://reader@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',
          ONCHAIN_SNAPSHOT_RPC_URL:'https://rpc.invalid'},
        providerFor:()=>f.options.provider,
        sqlFor:()=>async(strings,...values)=>{
          const text=strings.join('?');queries.push(text);
          assert.match(text,/^SELECT /);assert.doesNotMatch(text,/signed_tx|INSERT|UPDATE|DELETE|CREATE/);
          let rows;
          if(text.includes('FROM sepolia_tournament_cycles')) {assert.deepEqual(values,['cycle-two']);rows=[f.input.cycle];}
          else if(text.includes('FROM sepolia_tournament_mints'))rows=[{batch_index:'0',tx_hash:hash(500)}];
          else {assert.deepEqual(values,[[addr(2),addr(3)]]);rows=[2,3].map(n=>({chain_id:421614,factory_address:addr(n),last_block:'200'}));}
          return wrapped?{rows}:rows;
        },
      };
      const summary=await snapshotCommand(args,dependencies), saved=JSON.parse(await readFile(output,'utf8'));
      assert.equal(summary.snapshotHash,saved.snapshotHash);assert.equal(summary.events,3);
      assert.equal((await stat(output)).mode & 0o777,0o600);
      assert.equal(queries.length,3);assert.doesNotMatch(JSON.stringify(summary),/alice|suborg/);
      await assert.rejects(snapshotCommand(args,dependencies),{code:'EEXIST'});
      assert.deepEqual(JSON.parse(await readFile(output,'utf8')),saved);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
