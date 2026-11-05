import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addr,hash} from './sepolia-tournament-test-fixture.js';
import {planHash} from './sepolia-tournament.js';
import {discoverStandingsRegistry} from './sepolia-standings-registry.js';
function discovery() {
  const f=fixture(),mappings=f.input.registry.markets.map((m,i)=>({factory_address:m.factory,pool_address:m.pool,market_id:m.marketId,
    tx_hash:m.creationTxHash,protocol_version:i===0?'v1':'v2',points_id:10+i}));
  const sql=async(parts)=>{const query=parts.join('');assert.match(query,/^SELECT/);
    if(query.includes('FROM sepolia_tournament_cycles'))return [f.input.cycle];
    if(query.includes('FROM indexer_factory_state'))return [2,3].map(n=>({factory_address:addr(n),last_block:200}));return mappings;};
  return {f,mappings,run:extra=>discoverStandingsRegistry({sql,provider:f.options.provider,cycleId:f.input.cycle.plan.cycleId,
    reviewedPlanHash:f.input.reviewedPlanHash,confirmations:2,contractAt:a=>({marketCount:async()=>f.contracts.get(a).state.marketCount}),...extra})};
}
test('registry discovery proves complete indexed V1/V2 creations without signing or changing policy',async()=>{
  const d=discovery(),r=await d.run();assert.deepEqual(r.registry,d.f.input.registry);assert.equal(r.registryHash,planHash(d.f.input.registry));assert.equal(r.enabled,false);assert.equal(r.requiresPolicyReview,true);
});
test('missing mappings, duplicate approvals, wrong variants, receipt reorgs and foreign chain never produce a proposal',async()=>{
  for(const change of [d=>d.mappings.pop(),d=>d.mappings.push({...d.mappings[0]}),d=>d.mappings[0].protocol_version='v2',
    d=>d.f.receipts.get(hash(501)).blockHash=hash(999),d=>d.f.options.provider.getNetwork=async()=>({chainId:1})]) {
    const d=discovery();change(d);await assert.rejects(d.run());
  }
});
