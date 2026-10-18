import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, stat, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ethers } from 'ethers';
import { fixture, addr, hash, base } from './sepolia-tournament-test-fixture.js';
import { buildTournamentPlan, MINT_ABI, planHash } from './sepolia-tournament.js';
import { buildTournamentSnapshot, tournamentMarketRegistry } from './sepolia-tournament-snapshot.js';
import { captureTournamentSnapshot } from './sepolia-tournament-capture.js';
import { captureCommand } from '../scripts/onchain-sepolia-capture.mjs';

async function checkpoint(fn) {
  const root=await mkdtemp(join(tmpdir(),'pronos-full-capture-'));
  try {return await fn(root);}finally{await rm(root,{recursive:true,force:true});}
}
const run=(f,root,maxRequests=500)=>captureTournamentSnapshot(f.input,{...f.options,checkpointDirectory:root,maxRequests});
async function files(root) {
  const out=[];
  for(const child of await readdir(root,{withFileTypes:true})) {
    const path=join(root,child.name);
    if(child.isDirectory())out.push(...await files(path));else out.push(path);
  }
  return out;
}

test('small quotas resume exact canonical output without re-fetching saved successful responses',async()=>checkpoint(async root=>{
  const f=fixture({resolved:true}), expected=await buildTournamentSnapshot(f.input,f.options), seen=new Set();
  for(const method of ['getLogs','call','getCode','getTransaction','getTransactionReceipt']) {
    const original=f.options.provider[method];
    f.options.provider[method]=async(...args)=>{
      const key=planHash({method,args});assert.equal(seen.has(key),false,'committed reads must be reused');seen.add(key);
      return original(...args);
    };
  }
  let result,pauses=0;
  do {result=await run(f,root,7);assert.ok(result.newReads<=7);if(result.status==='paused'){pauses++;assert.equal(result.artifact,undefined);}}while(result.status!=='complete'&&pauses<30);
  assert.equal(result.status,'complete');assert.ok(pauses>3);assert.deepEqual(result.artifact,expected);
  const repeats=await run(f,root,1);assert.equal(repeats.newReads,0);assert.equal(repeats.artifact.snapshotHash,expected.snapshotHash);
  for(const path of await files(root))assert.equal((await stat(path)).mode&0o777,0o600);
  assert.equal((await stat(root)).mode&0o777,0o700);
}));

test('a month-length cutoff beyond the bounded adapter completes with contiguous shared pages',async()=>checkpoint(async root=>{
  const asOfBlock=10_300_100,f=fixture({asOfBlock}),original=f.options.provider.getLogs,queries=[];
  f.options.provider.getBlock=async n=>({...f.block(n),timestamp:base+Math.floor((n-100)/4)});
  f.options.provider.getLogs=async q=>{queries.push(q);return original(q);};
  await assert.rejects(buildTournamentSnapshot(f.input,f.options),/snapshot_bounds_exceeded/);
  let result,runs=0;
  do {result=await run(f,root,5000);runs++;}while(result.status==='paused'&&runs<4);
  assert.equal(result.status,'complete');assert.ok(runs>=3);
  assert.equal(result.artifact.snapshot.asOf.blockNumber,asOfBlock);
  assert.equal(result.artifact.snapshot.events.length,3);
  assert.equal(result.artifact.readyForRewards,false);
  for(const pool of [addr(40),addr(41)]) {
    const windows=queries.filter(q=>q.address.includes(pool)).sort((a,b)=>a.fromBlock-b.fromBlock);
    assert.equal(windows[0].fromBlock,0);assert.equal(windows.at(-1).toBlock,asOfBlock);
    for(let i=1;i<windows.length;i++)assert.equal(windows[i].fromBlock,windows[i-1].toBlock+1);
  }
}));

test('600 registered users and 101 binary markets fit the full profile and share RPC log queries',async()=>checkpoint(async root=>{
  const f=fixture(),old=f.input.cycle.plan;
  const plan=buildTournamentPlan({deployment:old.deployment,previousDeployment:old.previousDeployment,
    users:Array.from({length:600},(_,i)=>({username:'user'+String(i).padStart(3,'0'),wallet_address:addr(10000+i),turnkey_sub_org_id:'org'+i})),
    cycleId:old.cycleId,label:old.label,startsAt:old.startsAt,endsAt:old.endsAt,liquidityMxnp:'1000',maxTotalMxnp:'301000',batchSize:100});
  f.input.cycle={plan,plan_hash:planHash(plan),status:'funded'};f.input.reviewedPlanHash=planHash(plan);
  f.contracts.get(addr(1)).state.totalSupply=plan.totalUnits;
  const mint=new ethers.utils.Interface(MINT_ABI);f.input.funding=[];
  for(const batch of plan.batches) {
    const txHash=hash(50000+batch.index);
    f.addReceipt(txHash,90,batch.recipients.map((r,i)=>f.encoded(mint,'Transfer',[ethers.constants.AddressZero,r.wallet,r.units],addr(1),batch.index*100+i)));
    f.transactions.set(txHash,{hash:txHash,blockHash:hash(90),blockNumber:90,chainId:421614,from:plan.deployment.owner,
      to:plan.deployment.token,value:0,data:mint.encodeFunctionData('batchMint',[batch.recipients.map(r=>r.wallet),batch.recipients.map(r=>r.units)])});
    f.input.funding.push({batchIndex:batch.index,txHash});
  }
  const created=new ethers.utils.Interface(['event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime)']);
  const registry=structuredClone(f.input.registry);
  for(let i=1;i<=100;i++) {
    const pool=addr(1000+i),txHash=hash(60000+i),logIndex=1000+i;
    f.contracts.set(pool,{...f.contracts.get(addr(40)),state:{...f.contracts.get(addr(40)).state,marketId:i}});
    f.addReceipt(txHash,95,[f.encoded(created,'MarketCreated',[i,pool,'Q','test',base+1000],addr(2),logIndex)]);
    registry.markets.push({factory:addr(2),pool,marketId:String(i),creationTxHash:txHash,creationLogIndex:logIndex});
  }
  const state=f.contracts.get(addr(2)).state;state.marketCount=101;
  state.markets=([i])=>[i.isZero()?addr(40):addr(1000+i.toNumber()),'Q','test',base+1000,'source',true];
  registry.planHash=planHash(plan);f.input.registry=tournamentMarketRegistry(registry);f.input.reviewedRegistryHash=planHash(f.input.registry);
  const original=f.options.provider.getLogs,queries=[];f.options.provider.getLogs=async q=>{queries.push(q);return original(q);};
  const result=await run(f,root,5000);
  assert.equal(result.status,'complete');assert.equal(result.artifact.snapshot.markets.length,102);
  assert.equal(result.artifact.scores.rows.length,600);assert.equal(queries.length,6);
  assert.ok(queries.some(q=>q.address.length===25));
  assert.ok(result.artifact.scores.rows.every(r=>r.equityUnits==='500000000'));
}));

test('changed review, funding, cutoff or checkpoint contents cannot reuse captured responses',async()=>checkpoint(async root=>{
  const f=fixture();assert.equal((await run(f,root,1)).status,'paused');
  for(const mutate of [f=>f.input.asOfBlock=199,f=>f.input.funding[0].txHash=hash(900)]) {
    const other=fixture();mutate(other);await assert.rejects(run(other,root),/capture_context_mismatch/);
  }
  const entry=(await files(join(root,'entries')))[0], body=JSON.parse(await readFile(entry,'utf8'));
  body.result={};await writeFile(entry,JSON.stringify(body),{mode:0o600});
  await assert.rejects(run(f,root),/capture_cache_corrupt/);
}));

test('a reorg or wrong chain on resume or mid-run stops capture and releases its lock',async()=>checkpoint(async root=>{
  const f=fixture();await run(f,root,2);
  f.options.provider.getBlock=async n=>({...f.block(n),hash:n===200?hash(999):hash(n)});
  await assert.rejects(run(f,root),/capture_anchor_reorg/);
  await assert.rejects(stat(join(root,'capture.lock')),{code:'ENOENT'});
  f.options.provider.getNetwork=async()=>({chainId:42161});await assert.rejects(run(f,root),/rpc_chain_mismatch/);
  const next=join(root,'mid-run');let reads=0;
  const mid=fixture();mid.options.provider.getBlock=async n=>({...mid.block(n),hash:n===200&&++reads>2?hash(999):hash(n)});
  await assert.rejects(run(mid,next),/capture_anchor_reorg/);
}));

test('RPC errors leave reusable successful reads but no partial score',async()=>checkpoint(async root=>{
  const f=fixture(),original=f.options.provider.getLogs;let unavailable=true;
  f.options.provider.getLogs=async q=>{if(unavailable)throw Error('network unavailable');return original(q);};
  await assert.rejects(run(f,root),/network unavailable/);unavailable=false;
  const result=await run(f,root);assert.equal(result.status,'complete');assert.ok(result.cacheHits>20);
}));

test('range-limit decisions survive one-read quotas and split into complete non-overlapping queries',async()=>checkpoint(async root=>{
  const f=fixture(),original=f.options.provider.getLogs,accepted=[],seen=new Set();
  f.options.provider.getLogs=async q=>{
    const key=planHash(q);assert.equal(seen.has(key),false,'split decisions must also survive pauses');seen.add(key);
    if(q.toBlock-q.fromBlock>50)throw Object.assign(Error('query returned more than result limit'),{code:-32005});
    accepted.push(q);return original(q);
  };
  let result,runs=0;
  do {result=await run(f,root,1);runs++;}while(result.status==='paused'&&runs<150);
  assert.equal(result.status,'complete');assert.ok(accepted.length>2);
  for(const pool of [addr(40),addr(41)]) {
    const rows=accepted.filter(q=>q.address.includes(pool)).sort((a,b)=>a.fromBlock-b.fromBlock);
    assert.equal(rows[0].fromBlock,0);assert.equal(rows.at(-1).toBlock,200);
    for(let i=1;i<rows.length;i++)assert.equal(rows[i].fromBlock,rows[i-1].toBlock+1);
  }
}));

test('capped successful log responses split and preserve the canonical artifact',async()=>checkpoint(async root=>{
  const f=fixture(),expected=await buildTournamentSnapshot(f.input,f.options),original=f.options.provider.getLogs;
  let capped=0;
  f.options.provider.getLogs=async q=>{
    const rows=await original(q);
    if(q.toBlock-q.fromBlock>50&&rows.length) {capped++;return Array.from({length:1000},()=>rows[0]);}
    return rows;
  };
  const result=await run(f,root);assert.equal(result.status,'complete');assert.ok(capped>0);
  assert.deepEqual(result.artifact,expected);
}));

test('a single-pool single-block log cap refuses without a partial artifact',async()=>checkpoint(async root=>{
  const f=fixture(),original=f.options.provider.getLogs;
  f.options.provider.getLogs=async q=>{
    const rows=await original(q);return rows.length?Array.from({length:1000},()=>rows[0]):rows;
  };
  await assert.rejects(run(f,root),/capture_single_block_log_limit/);
  await assert.rejects(stat(join(root,'capture.lock')),{code:'ENOENT'});
}));

test('locking, public checkpoint directories and hard bounds refuse',async()=>checkpoint(async root=>{
  const f=fixture();await writeFile(join(root,'capture.lock'),JSON.stringify({pid:process.pid,token:'held'}),{mode:0o600});
  await assert.rejects(run(f,root),/capture_locked/);await rm(join(root,'capture.lock'));
  const shared=join(root,'shared');await mkdir(shared,{mode:0o755});
  await assert.rejects(run(f,shared),/private_checkpoint_directory_required/);
  await assert.rejects(run(f,root,0),/invalid_capture_options/);
  f.input.asOfBlock=40_000_101;await assert.rejects(run(f,root),/snapshot_bounds_exceeded/);
}));

test('operator capture pauses without creating output, then resumes and writes the exact private artifact',async()=>checkpoint(async root=>{
  const f=fixture(),input=join(root,'request.json'),output=join(root,'artifact.json');
  await writeFile(input,JSON.stringify({cycleId:'cycle-two',fromBlock:100,asOfBlock:200,registry:f.input.registry}),{mode:0o600});
  const args={input,output,checkpoint:join(root,'checkpoint'),'max-requests':'1','reviewed-plan-hash':f.input.reviewedPlanHash,'reviewed-registry-hash':f.input.reviewedRegistryHash};
  const deps={env:{ONCHAIN_SNAPSHOT_DATABASE_URL:'postgresql://reader@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',ONCHAIN_SNAPSHOT_RPC_URL:'https://rpc.invalid'},
    providerFor:()=>f.options.provider,sqlFor:()=>async strings=>{
      const text=strings.join('?');assert.match(text,/^SELECT /);
      if(text.includes('FROM sepolia_tournament_cycles'))return[f.input.cycle];
      if(text.includes('FROM sepolia_tournament_mints'))return[{batch_index:0,tx_hash:hash(500)}];
      return[2,3].map(n=>({chain_id:421614,factory_address:addr(n),last_block:'200'}));
    }};
  const paused=await captureCommand(args,deps);assert.equal(paused.status,'paused');
  await assert.rejects(stat(output),{code:'ENOENT'});
  const completed=await captureCommand({...args,'max-requests':'500'},deps);
  assert.equal(completed.status,'complete');assert.equal((await stat(output)).mode&0o777,0o600);
  assert.equal(JSON.parse(await readFile(output,'utf8')).snapshotHash,completed.snapshotHash);
  await assert.rejects(captureCommand(args,deps),{code:'EEXIST'});
  const script=new URL('../scripts/onchain-sepolia-capture.mjs',import.meta.url).pathname;
  const help=spawnSync(process.execPath,[script,'--help'],{encoding:'utf8'});assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/resumable/);
  const refused=spawnSync(process.execPath,[script,'--max-requests','0'],{encoding:'utf8'});assert.equal(refused.status,1);assert.equal(refused.stdout,'');
}));
