import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('./protocol-event-indexer.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function runProtocolIndexer(');
const end = source.indexOf('async function ensureFactoryStateTable()', start);
const runSource = source.slice(start,end).replace('export async','async');

function fixture() {
  const ranges=[], states=[], schemas=[];
  const bindings={
    CHAIN_ID:421614,BLOCK_BATCH:2000,
    getIndexerConfig:()=>({factories:[{address:'v1'},{address:'v2'}],rpcUrl:'synthetic',startBlock:10,lookbackBlocks:100,maxBatches:2}),
    ethers:{providers:{StaticJsonRpcProvider:class {async getBlockNumber(){return 8000;}}}},
    parseInteger:value=>{const parsed=Number.parseInt(value,10);return Number.isFinite(parsed)?parsed:null;},
    getFactoryFromBlock:async()=>100,
    ensureProtocolSchema:async()=>schemas.push('protocol'),ensureFactoryStateTable:async()=>schemas.push('state'),
    indexFactoryRange:async(_p,f,from,to,processed)=>{ranges.push([f.address,from,to]);processed.trades++;},
    updateFactoryState:async(f,to)=>states.push([f,to]),sql:async()=>[],
  };
  const run = new Function(...Object.keys(bindings),`${runSource}\nreturn runProtocolIndexer;`)(...Object.values(bindings));
  return {run,ranges,states,schemas};
}
test('protocol-only worker resumes each factory checkpoint, bounds catch-up and cannot honor manual range overrides',async()=>{
  const f=fixture();const result=await f.run({setupSchema:false,query:{fromBlock:'0',toBlock:'10'}});
  assert.deepEqual(f.schemas,[]);
  assert.deepEqual(f.ranges,[['v1',100,2099],['v1',2100,4099],['v2',100,2099],['v2',2100,4099]]);
  assert.deepEqual(f.states,[['v1',2099],['v1',4099],['v2',2099],['v2',4099]]);
  assert.equal(result.processed.trades,4);
  assert.ok(!('crypto5Min' in result)&&!('pointsAutoResolve' in result));
});
test('existing manual handler retains explicit ranges and schema setup',async()=>{
  const f=fixture();await f.run({isManual:true,query:{fromBlock:'200',toBlock:'210'}});
  assert.deepEqual(f.schemas,['protocol','state']);
  assert.deepEqual(f.ranges,[['v1',200,210],['v2',200,210]]);
});

test('Sepolia can retain both historical factory checkpoints; mainnet ignores these preview legacy variables', () => {
  const section = source.slice(source.indexOf('function parseInteger('), source.indexOf('// Shared protocol-only'))
    .replace('export function', 'function');
  const env = { FACTORY_ADDRESS: 'current-v1', FACTORY_V2_ADDRESS: 'current-v2',
    ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS: 'legacy-v1', ONCHAIN_LEGACY_MARKET_FACTORY_V2_ADDRESS: 'legacy-v2' };
  const configs = chain => new Function('process','CHAIN_ID','FACTORY_ABI','FACTORY_V2_ABI','DEFAULT_LOOKBACK_BLOCKS','DEFAULT_MAX_BATCHES',
    `${section}\nreturn getIndexerConfig();`)({env},chain,['v1'],['v2'],250000,5).factories;
  assert.deepEqual(configs(421614).map(f => [f.address,f.version]), [['current-v1','v1'],['current-v2','v2'],['legacy-v1','v1'],['legacy-v2','v2']]);
  assert.equal(configs(42161).length, 2);
});
