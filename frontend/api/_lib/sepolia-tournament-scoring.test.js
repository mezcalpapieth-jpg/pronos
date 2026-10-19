import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTournamentPlan, planHash } from './sepolia-tournament.js';
import { buildTournamentShadowScores, tournamentRegistrations } from './sepolia-tournament-scoring.js';

const addr = n => `0x${n.toString(16).padStart(40,'0')}`;
const hash = n => `0x${n.toString(16).padStart(64,'0')}`;
const deployment = (n=0) => ({ chainId:421614, token:addr(n+1), factoryV1:addr(n+2),
  factoryV2:addr(n+3), shareV1:addr(n+4), shareV2:addr(n+5), router:addr(n+6),
  owner:addr(90), operations:addr(91), routerCodeHash:hash(1) });
function input() {
  const plan = buildTournamentPlan({ deployment:deployment(), previousDeployment:deployment(100),
    users:[{username:'alice',wallet_address:addr(30),turnkey_sub_org_id:'alice'},
      {username:'bob',wallet_address:addr(31),turnkey_sub_org_id:'bob'},
      {username:'no-wallet'}],cycleId:'cycle-two',label:'Second cycle',
    startsAt:'2026-11-01T00:00:00Z',endsAt:'2026-12-01T00:00:00Z',
    liquidityMxnp:'1000',maxTotalMxnp:'2000' });
  return { cycle:{plan,status:'funded',plan_hash:planHash(plan)},reviewedPlanHash:planHash(plan),
    fromBlock:100,asOf:{blockNumber:200,blockHash:hash(200),timestamp:'2026-11-15T00:00:00Z'},
    markets:[{chainId:421614,pool:addr(40),factory:addr(2),collateral:addr(1),marketId:'0',outcomeCount:2,
      registeredBlock:100,status:'active',pricesUnits:['500000','500000'],markBlock:200,markBlockHash:hash(200)}],
    events:[] };
}
const event = (overrides={}) => ({chainId:421614,pool:addr(40),wallet:addr(30),side:'buy',
  blockNumber:110,blockHash:hash(110),logIndex:1,txHash:hash(1000),timestamp:'2026-11-02T00:00:00Z',
  outcomeIndex:0,sharesUnits:'180000000',collateralUnits:'100000000',...overrides});
const alice = result => result.rows.find(r=>r.username==='alice');

test('registration requires a fully funded reviewed immutable plan and excludes operations/missing wallets',()=>{
  const args=input(), before=structuredClone(args);
  assert.deepEqual(tournamentRegistrations(args).users.map(r=>r.username),['alice','bob']);
  for(const change of [a=>a.cycle.status='prepared',a=>a.reviewedPlanHash=hash(8),
    a=>a.cycle.plan_hash=hash(8),a=>a.cycle.plan.batches[0].recipients[0].units='1']) {
    const a=input();change(a);assert.throws(()=>buildTournamentShadowScores(a));
  }
  assert.deepEqual(args,before);
});

test('opening score ignores wallet balances, transfers, faucet mints, unregistered wallets and markets',()=>{
  const args=input();args.balances={[addr(30)]:'999999999999999999999999'};
  args.events=[event({side:'Transfer',collateralUnits:'999999999999'}),event({side:'mint'}),
    event({wallet:addr(91)}),event({wallet:addr(99)}),event({pool:addr(99)}),event({chainId:42161})];
  const r=buildTournamentShadowScores(args);
  assert.equal(r.mode,'shadow');assert.equal(r.readyForRewards,false);assert.equal(r.ignoredEvents,6);
  assert.deepEqual(r.rows.map(x=>[x.username,x.equityUnits,x.pnlUnits]),[['alice','500000000','0'],['bob','500000000','0']]);
});

test('cashflow uses gross buys and net sales, without subtracting fees twice',()=>{
  const args=input();args.events=[event({feeUnits:'1000000'}),event({side:'sell',sharesUnits:'90000000',
    collateralUnits:'45000000',feeUnits:'1000000',logIndex:2})];
  const row=alice(buildTournamentShadowScores(args));
  assert.equal(row.cashUnits,'445000000');assert.equal(row.openValueUnits,'45000000');
  assert.equal(row.pnlUnits,'-10000000');assert.equal(row.eventCount,2);
});

test('resolved claims and partial/full redemptions preserve equity without double counting',()=>{
  const args=input();Object.assign(args.markets[0],{status:'resolved',winner:0});
  args.events=[event()];const initial=alice(buildTournamentShadowScores(args));
  args.events.push(event({side:'redeem',outcomeIndex:null,sharesUnits:'90000000',collateralUnits:'90000000',logIndex:2}));
  const partial=alice(buildTournamentShadowScores(args));
  args.events.push(event({side:'redeem',outcomeIndex:null,sharesUnits:'90000000',collateralUnits:'90000000',logIndex:3}));
  const full=alice(buildTournamentShadowScores(args));
  assert.equal(initial.equityUnits,'580000000');assert.equal(partial.equityUnits,initial.equityUnits);
  assert.equal(full.equityUnits,initial.equityUnits);assert.equal(full.openValueUnits,'0');
  assert.equal(full.pnlUnits,'80000000');
});

test('multi-outcome positions and losing claims use the registered outcome',()=>{
  const args=input();Object.assign(args.markets[0],{factory:addr(3),outcomeCount:3,
    pricesUnits:['333333','333333','333333']});
  args.events=[event({outcomeIndex:2,sharesUnits:'300000000'})];
  assert.equal(alice(buildTournamentShadowScores(args)).openValueUnits,'99999900');
  Object.assign(args.markets[0],{status:'resolved',winner:1});
  assert.equal(alice(buildTournamentShadowScores(args)).equityUnits,'400000000');
});

test('replayed logs deduplicate, ordering is canonical and conflicting identities/positions fail',()=>{
  const args=input(), buy=event(), sell=event({side:'sell',sharesUnits:'90000000',collateralUnits:'45000000',logIndex:2});
  args.events=[sell,buy,structuredClone(buy)];
  const r=buildTournamentShadowScores(args);
  assert.equal(r.acceptedEvents,2);assert.equal(r.duplicateEvents,1);
  assert.equal(alice(r).cashUnits,'445000000');
  args.events.push({...buy,collateralUnits:'1'});
  assert.throws(()=>buildTournamentShadowScores(args),/conflicting_event_identity/);
  args.events=[buy,{...sell,txHash:hash(1001),logIndex:1}];
  assert.throws(()=>buildTournamentShadowScores(args),/conflicting_log_position/);
});

test('unbacked sales/redemptions and externally funded overspending fail closed',()=>{
  for(const events of [[event({side:'sell'})],[event({side:'redeem'})],
    [event({collateralUnits:'500000001'})],
    [event(),event({side:'sell',sharesUnits:'180000001',logIndex:2})]]) {
    assert.throws(()=>buildTournamentShadowScores({...input(),events}),/exceeds/);
  }
});

test('redemptions require the resolved winner, exact payout and purchased holdings',()=>{
  for(const change of [a=>a.markets[0].status='active',a=>a.markets[0].winner=1,
    a=>a.events[1].collateralUnits='179999999']) {
    const args=input();Object.assign(args.markets[0],{status:'resolved',winner:0});
    args.events=[event(),event({side:'redeem',collateralUnits:'180000000',logIndex:2})];
    change(args);assert.throws(()=>buildTournamentShadowScores(args),/invalid_redemption/);
  }
});

test('foreign/stale/duplicated markets and unresolved dispute accounting are rejected',()=>{
  for(const change of [a=>a.markets[0].chainId=42161,a=>a.markets[0].factory=addr(102),
    a=>a.markets[0].collateral=addr(101),a=>a.markets[0].markBlock=199,
    a=>a.markets[0].markBlockHash=hash(199),a=>a.markets.push({...a.markets[0]}),
    a=>a.markets[0].status='disputed',
    a=>a.markets[0].pricesUnits=['0','0']]) {
    const args=input();change(args);assert.throws(()=>buildTournamentShadowScores(args));
  }
});

test('cutoff excludes old/future events and rejects post-cycle snapshots and trades at the end',()=>{
  const args=input();args.events=[event({blockNumber:99}),event({blockNumber:201}),
    event({timestamp:'2026-10-31T23:59:59Z'}),event({timestamp:'2026-11-16T00:00:00Z'})];
  assert.equal(buildTournamentShadowScores(args).ignoredEvents,4);
  args.asOf.timestamp='2026-12-01T00:00:00Z';args.events=[event({timestamp:args.asOf.timestamp})];
  assert.throws(()=>buildTournamentShadowScores(args),/trade_after_cycle_end/);
  args.asOf.timestamp='2026-12-01T00:00:01Z';
  assert.throws(()=>buildTournamentShadowScores(args),/invalid_scoring_cutoff/);
});

test('block hashes must agree and marks must match the pinned snapshot',()=>{
  const args=input();args.events=[event(),event({logIndex:2,blockHash:hash(111)})];
  assert.throws(()=>buildTournamentShadowScores(args),/inconsistent_block_hash/);
  args.events=[event({blockNumber:200,blockHash:hash(199)})];
  assert.throws(()=>buildTournamentShadowScores(args),/inconsistent_block_hash/);
});

test('unit arithmetic remains exact above JavaScript safe integers and rejects float amounts',()=>{
  const args=input();Object.assign(args.markets[0],{status:'resolved',winner:0});
  args.events=[event({sharesUnits:'9007199254740993',collateralUnits:'1'})];
  assert.equal(alice(buildTournamentShadowScores(args)).equityUnits,'9007199754740992');
  args.events[0].collateralUnits=0.1;
  assert.throws(()=>buildTournamentShadowScores(args),/integer_unit_string_required/);
});

test('offline operator command emits a shadow report and refuses an unreviewed snapshot',()=>{
  const dir=mkdtempSync(join(tmpdir(),'pronos-shadow-score-'));
  try {
    const args=input(), path=join(dir,'snapshot.json');
    writeFileSync(path,JSON.stringify(args),{mode:0o600});
    const script=new URL('../scripts/onchain-sepolia-score.mjs',import.meta.url);
    const run=digest=>spawnSync(process.execPath,[script.pathname,'--input',path,'--reviewed-plan-hash',digest],{encoding:'utf8'});
    const success=run(args.reviewedPlanHash);
    assert.equal(success.status,0,success.stderr);assert.equal(JSON.parse(success.stdout).readyForRewards,false);
    const refused=run('0'.repeat(64));
    assert.equal(refused.status,1);assert.equal(refused.stdout,'');
    assert.match(refused.stderr,/Shadow scoring refused/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
