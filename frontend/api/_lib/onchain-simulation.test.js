import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { simulateContractCall } from './onchain-simulation.js';

const iface = new ethers.utils.Interface(['function lifecycle()', 'function createMarket() returns(uint256)', 'error Blocked()']);
const call = result => ({call:async()=>result});

test('accepts canonical void results and a valid creation ID including zero',async()=>{
  assert.equal((await simulateContractCall(call('0x'),{},iface,'lifecycle')).length,0);
  for(const id of [0,7]){
    const result=iface.encodeFunctionResult('createMarket',[id]);
    assert.equal((await simulateContractCall(call(result),{},iface,'createMarket'))[0].toNumber(),id);
  }
});

test('rejects returned Error, Panic, custom errors and malformed or trailing data',async()=>{
  const error='0x08c379a0'+ethers.utils.defaultAbiCoder.encode(['string'],['already redeemed']).slice(2);
  const panic='0x4e487b71'+ethers.utils.defaultAbiCoder.encode(['uint256'],[0x11]).slice(2);
  for(const result of [error,panic,iface.encodeErrorResult('Blocked'), '0x12',undefined]){
    for(const method of ['lifecycle','createMarket'])await assert.rejects(simulateContractCall(call(result),{},iface,method));
  }
  await assert.rejects(simulateContractCall(call('0x'+'00'.repeat(32)),{},iface,'lifecycle'));
  await assert.rejects(simulateContractCall(call(iface.encodeFunctionResult('createMarket',[0])+'00'.repeat(32)),{},iface,'createMarket'));
  await assert.rejects(simulateContractCall(call('0x'),{},iface,'createMarket'));
});

test('preserves thrown RPC failure without treating it as a successful simulation',async()=>{
  const error=new Error('RPC unavailable');
  await assert.rejects(simulateContractCall({call:async()=>{throw error;}},{},iface,'lifecycle'),e=>e===error);
});
