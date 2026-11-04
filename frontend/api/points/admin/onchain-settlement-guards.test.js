import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertPointsExecution} from '../../_lib/points-execution-mode.js';
for(const route of ['resolve-market','correct-resolution','resolution-candidates'])test(`${route} refuses an onchain row before any Points ledger mutation`,async()=>{
  const source=(await readFile(new URL(`./${route}.js`,import.meta.url),'utf8')).replace(/^import[\s\S]*?;\n/gm,'').replace('export default async','async');
  const writes=[];
  const row={id:42,mode:'onchain',status:route==='correct-resolution'?'resolved':'active',amm_mode:'unified',market_status:'active'};
  const query=async text=>{if(!/^\s*SELECT/.test(String(text)))writes.push(text);return {rows:[row]};};
  const bindings={neon:()=>async()=>[row],process:{env:{}},applyCors:()=>null,requirePointsAdmin:()=>({username:'admin'}),
    ensurePointsSchema:async()=>{},withTransaction:async fn=>fn({query}),assertPointsExecution,console:{error(){}},
    bestEffortPersistTopHolderSnapshot:()=>{throw Error('snapshot must not run');}};
  const handler=new Function(...Object.keys(bindings),`${source};return handler;`)(...Object.values(bindings));
  const res={status(n){this.code=n;return this;},json(b){this.body=b;}};
  await handler({method:'POST',body:{marketId:42,winningOutcomeIndex:0,candidateId:1,action:'confirm'}},res);
  assert.equal(res.code,409);assert.equal(res.body.error,'onchain_market_requires_protocol');assert.equal(writes.length,0);
});
