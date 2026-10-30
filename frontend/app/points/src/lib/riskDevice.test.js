import test from 'node:test';import assert from 'node:assert/strict';
import {riskDeviceHeaders} from './riskDevice.js';
function browser(){const storage=new Map();return {document:{cookie:''},location:{protocol:'https:'},crypto:{randomUUID:()=> 'd52bb07a-6c7b-45f3-8de1-8efb06bcd6e1'},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};}
test('browser identifier persists through account and network changes, without user or IP content',()=>{
 const b=browser();const first=riskDeviceHeaders(b);b.crypto.randomUUID=()=>{throw new Error('must reuse device id')};
 assert.deepEqual(riskDeviceHeaders(b),first);assert.match(b.document.cookie,/Max-Age=31536000; SameSite=Lax; Secure/);
 assert.deepEqual(Object.keys(first),['X-Pronos-Device-Id']);
});
test('device identifier can recover from blocked storage using the cookie',()=>{
 const b=browser();b.document.cookie='pronos_device_id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 b.localStorage.getItem=()=>{throw new Error('blocked')};b.localStorage.setItem=()=>{throw new Error('blocked')};
 assert.equal(riskDeviceHeaders(b)['X-Pronos-Device-Id'],'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
});
test('server-side clients do not acquire a shared artificial device identity',()=>assert.deepEqual(riskDeviceHeaders({}),{}));

test('blocked storage and cookie access never interrupt API requests',()=>{
 const b=browser();
 b.localStorage.getItem=()=>{throw new Error('blocked')};
 b.localStorage.setItem=()=>{throw new Error('blocked')};
 Object.defineProperty(b.document,'cookie',{get(){throw new Error('blocked')},set(){throw new Error('blocked')}});
 assert.match(riskDeviceHeaders(b)['X-Pronos-Device-Id'],/^[a-f0-9-]{32,64}$/i);
});
