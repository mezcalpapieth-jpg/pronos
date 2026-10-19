import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planHash } from './sepolia-tournament.js';
import { buildTournamentSnapshot } from './sepolia-tournament-snapshot.js';
import { snapshotCommand } from '../scripts/onchain-sepolia-snapshot.mjs';

import { fixture, addr, hash, base } from './sepolia-tournament-test-fixture.js';
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
    f=>f.input.expectedCutoffHash=hash(999),
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
test('inconsistent cancellation, dispute/clear and correction history rejects a currently active pool',async()=>{
  for(const name of ['MarketCanceled','ResolutionDisputeOpened','ResolutionDisputeCleared','MarketResolutionCorrected']) {
    const f=fixture(), abi=f.eventAbis[1];
    f.addReceipt(hash(700),150,[f.encoded(abi,name,name==='MarketCanceled'?[0]:name==='MarketResolutionCorrected'?[0,1,2]:[0,1],addr(40))]);
    await assert.rejects(run(f),/history/);
  }
});
test('resolved state and payouts must match canonical resolution history and its winner',async()=>{
  const f=fixture({resolved:true});f.logs.splice(f.logs.findIndex(l=>l.transactionHash===hash(621)),1);
  await assert.rejects(run(f),/invalid_redemption_history/);
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
