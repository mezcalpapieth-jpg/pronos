import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeasonPreparation,verifySeasonPreparation,assertPreparedSeasonPlan} from './sepolia-season-preparation.js';
const input={cycleId:'season-example',label:'Example only',startsAt:'2027-01-01T00:00:00Z',endsAt:'2027-02-01T00:00:00Z',expectedParticipants:600,
  lateJoinCapacity:100,allocationMxnp:'500',maxTotalMxnp:'400000',markets:[{key:'sports-example',seedMxnp:'1000',closesAt:'2027-01-15T00:00:00Z',resolver_type:'sports_api',resolver_config:{source:'espn',shape:'binary'}}],
  gas:{expectedActiveUsers:200,tradesPerActiveUser:100,measuredTradeWei:'1000000000000',settlementWei:'100000000000000',deploymentWei:'1000000000000000'}};
test('offline season budget includes every grant, late-join reserve and market seed without changing a cycle',()=>{
  const d=buildSeasonPreparation(input);assert.equal(d.totalMxnp,'351000.000000');assert.equal(d.userUnits,'300000000000');assert.equal(d.lateJoinReserveUnits,'50000000000');
  assert.equal(d.gasEstimate.estimatedConsumptionEth,'0.0211');assert.equal(d.gasEstimate.inactiveUsersFunded,0);assert.equal(d.readyToLaunch,false);
  assert.equal(d.deployment,undefined);assert.equal(verifySeasonPreparation(d,d.draftHash),d);
});
test('missing coverage or gas measurements remain explicit launch blockers',()=>{
  const d=buildSeasonPreparation({...input,gas:undefined,markets:[{...input.markets[0],resolver_type:'manual'}]});
  assert.ok(d.blockers.includes('manual_resolution_coverage_required'));assert.ok(d.blockers.includes('measured_gas_budget_required'));
});
test('invalid caps, dates, duplicate markets and misleading gas assumptions are rejected',()=>{
  for(const change of [{maxTotalMxnp:'300000'},{endsAt:input.startsAt},{startsAt:'2027-01-01'},{markets:[...input.markets,...input.markets]},
    {markets:[{...input.markets[0],closesAt:'2027-03-01T00:00:00Z'}]},{gas:{...input.gas,expectedActiveUsers:701}},{gas:{...input.gas,measuredTradeWei:'0'}}])assert.throws(()=>buildSeasonPreparation({...input,...change}));
});
test('the later funding plan must match the reviewed proposal; neither mutable drafts nor mismatched rosters authorize minting',()=>{
  const d=buildSeasonPreparation(input),p={...d,userCount:600,maxTotalUnits:d.capUnits};
  assert.equal(assertPreparedSeasonPlan(d,d.draftHash,p),p);
  for(const change of [{totalUnits:'1'},{userCount:601},{allocationUnits:'1'},{lateJoinReserveUnits:'0'}])assert.throws(()=>assertPreparedSeasonPlan(d,d.draftHash,{...p,...change}));
  assert.throws(()=>verifySeasonPreparation({...d,totalUnits:'1'},d.draftHash));
});

test('draft CLI runs without credentials and writes a private proposal exclusively',async()=>{
  const {mkdtemp,writeFile,readFile,stat,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFileSync}=await import('node:child_process');
  const directory=await mkdtemp(join(tmpdir(),'pronos-season-draft-'));
  try {
    const source=join(directory,'input.json'),output=join(directory,'draft.json');await writeFile(source,JSON.stringify(input));
    const command=new URL('../scripts/onchain-sepolia-tournament.mjs',import.meta.url).pathname,args=[command,'draft',`--input=${source}`,`--out=${output}`];
    const result=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8',env:{PATH:process.env.PATH}}));
    assert.equal(result.applied,false);assert.equal(result.readyToLaunch,false);assert.equal((await stat(output)).mode&0o777,0o600);
    assert.equal(JSON.parse(await readFile(output,'utf8')).totalUnits,'351000000000');
    assert.throws(()=>execFileSync(process.execPath,args,{stdio:'pipe'}));
  }finally{await rm(directory,{recursive:true,force:true});}
});
