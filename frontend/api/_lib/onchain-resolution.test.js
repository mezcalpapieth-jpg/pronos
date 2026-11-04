import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ethers } from 'ethers';

// Exercise the real dispatcher with real ABI encoding and a recording signer.
const source = await readFile(new URL('./onchain-trader.js', import.meta.url), 'utf8');
const resolveSource = source.slice(source.indexOf('export async function resolveMarketOnChain('), source.indexOf('const LIFECYCLE_FUNCTIONS'))
  .replace('export async', 'async');
const factoryAddress = `0x${'1'.repeat(40)}`;
const resolverAddr = `0x${'2'.repeat(40)}`;
const abi = ['function resolveMarket(uint256 marketId, uint8 outcome)', 'event MarketResolved(uint256 indexed marketId, uint8 outcome)'];
const iface = new ethers.utils.Interface(abi);

function fixture({ wrongResolver = false, revert = false, event = true } = {}) {
  const simulations = [], signed = [];
  const bindings = {
    ethers: { ...ethers, Contract: class { async resolver() { return wrongResolver ? factoryAddress : resolverAddr; } } },
    requireReady() {}, MARKET_FACTORY_V1_ABI: abi, MARKET_FACTORY_V2_ABI: abi,
    provider: () => ({ async call(tx) { simulations.push(tx); if (revert) throw Error('already resolved'); } }),
    sameAddress: (a, b) => a.toLowerCase() === b.toLowerCase(),
    extractRevertDetail: e => e.message, chainId: () => 421614,
    signAndBroadcast: async tx => {
      signed.push(tx);
      const decoded = iface.decodeFunctionData('resolveMarket', tx.data);
      const log = iface.encodeEventLog(iface.getEvent('MarketResolved'), decoded);
      return { transactionHash: '0xtest', blockNumber: 1, logs: event ? [{ address: factoryAddress, ...log }] : [] };
    },
  };
  const resolve = new Function(...Object.keys(bindings), `${resolveSource}\nreturn resolveMarketOnChain;`)(...Object.values(bindings));
  return { simulations, signed, resolve: args => resolve({ resolverSuborgId: 'ops', resolverAddr, factoryAddress, marketId: 0, ...args }) };
}

test('V1 converts both app outcomes to the binary enum; numeric and string market zero remain valid', async () => {
  for (const marketId of [0, '0']) for (const outcome of [0, 1]) {
    const f = fixture();
    const result = await f.resolve({ factoryVariant: 'v1', marketId, outcome });
    const decoded = iface.decodeFunctionData('resolveMarket', f.signed[0].data);
    assert.equal(decoded.marketId.toString(), '0');
    assert.equal(decoded.outcome, outcome + 1);
    assert.equal(f.simulations[0].data, f.signed[0].data);
    assert.equal(result.outcome, outcome + 1); // raw contract event convention
    assert.equal(result.marketId, '0');
  }
});

test('V2 keeps zero-based outcomes, including zero; missing event uses the same contract value', async () => {
  for (const event of [true, false]) for (const outcome of [0, 1, 4]) {
    const f = fixture({ event });
    const result = await f.resolve({ factoryVariant: 'v2', outcome });
    assert.equal(iface.decodeFunctionData('resolveMarket', f.signed[0].data).outcome, outcome);
    assert.equal(result.outcome, outcome);
  }
});

test('invalid outcomes, resolver mismatch and failed simulation never sign', async () => {
  for (const outcome of [-1, 2, 1.5, '1oops', '', null, false]) {
    const f = fixture();
    await assert.rejects(f.resolve({ factoryVariant: 'v1', outcome }), /outcome must be an integer/);
    assert.equal(f.signed.length, 0);
  }
  for (const [options, message] of [[{ wrongResolver: true }, /not_resolver/], [{ revert: true }, /factory_resolve_simulation_failed/]]) {
    const f = fixture(options);
    await assert.rejects(f.resolve({ factoryVariant: 'v1', outcome: 0 }), message);
    assert.equal(f.signed.length, 0);
  }
});

const lifecycleSource=source.slice(source.indexOf('const LIFECYCLE_FUNCTIONS'),source.indexOf('function normalizeCancelRefund'))
  .replace('export async','async');
const lifecycleAbi=['function owner() view returns(address)','function cancelMarket(uint256)','function openResolutionDispute(uint256)',
  'function clearResolutionDispute(uint256)','function correctResolution(uint256,uint8)'];
function lifecycleFixture({revert=false,wrongOwner=false}={}){
  const calls=[],signed=[],owners=[];
  const bindings={ethers:{...ethers,Contract:class{async owner(){owners.push(true);return wrongOwner?factoryAddress:resolverAddr;}}},
    provider:()=>({call:async tx=>{calls.push(tx);if(revert)throw Error('already redeemed');}}),
    sameAddress:(a,b)=>a===b,requireReady(){},MARKET_FACTORY_V1_ABI:lifecycleAbi,MARKET_FACTORY_V2_ABI:lifecycleAbi,
    extractRevertDetail:e=>e.message,chainId:()=>421614,signAndBroadcast:async tx=>{signed.push(tx);return {transactionHash:'0xfixture',blockNumber:5};}};
  const run=new Function(...Object.keys(bindings),`${lifecycleSource};return lifecycleMarketOnChain;`)(...Object.values(bindings));
  return {calls,signed,owners,run:args=>run({ownerSuborgId:'ops',ownerAddr:resolverAddr,factoryAddress,marketId:0,action:'correct_resolution',...args})};
}
test('owner correction converts V1 app outcomes, keeps V2 indices and simulates before signing',async()=>{
  const iface=new ethers.utils.Interface(lifecycleAbi);
  for(const factoryVariant of ['v1','v2'])for(const outcome of [0,1]){
    const f=lifecycleFixture();await f.run({factoryVariant,outcome});
    assert.equal(iface.decodeFunctionData('correctResolution',f.signed[0].data)[1],outcome+(factoryVariant==='v1'?1:0));
    assert.equal(f.calls[0].data,f.signed[0].data);
  }
  for(const options of [{revert:true},{wrongOwner:true}]){const f=lifecycleFixture(options);await assert.rejects(f.run({factoryVariant:'v1',outcome:0}));assert.equal(f.signed.length,0);}
});
test('owner receipt recovery bypasses changed ownership and payout simulation with no new signature',async()=>{
  const f=lifecycleFixture({wrongOwner:true,revert:true});
  const result=await f.run({factoryVariant:'v1',outcome:0,execution:{receipt:{transactionHash:'0xoriginal',blockNumber:5}}});
  assert.equal(result.txHash,'0xoriginal');assert.equal(f.calls.length,0);assert.equal(f.owners.length,0);assert.equal(f.signed.length,0);
});
