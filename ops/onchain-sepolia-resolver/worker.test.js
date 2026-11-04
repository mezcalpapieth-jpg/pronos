import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateResolverWorker,createResolverWorker} from './worker.js';
const env={VERCEL_ENV:'production',VERCEL_PROJECT_ID:'prj_fixture_resolver',PREVIEW_RESOLVER_PROJECT_ID:'prj_fixture_resolver',
  CRON_SECRET:'c'.repeat(32),RESOLVER_TRIGGER_SECRET:'t'.repeat(32),ONCHAIN_RESOLVER_WORKER_ENABLED:'true'};
const source={branch:'onchain-sepolia',sha:'a'.repeat(40),mode:'active',target:'https://pronos-abc123-mezcalpapieth-jpgs-projects.vercel.app/api/cron/sepolia-resolve'};
function fixture(change={}){
  const calls=[];const worker=createResolverWorker({env,sourceFor:async()=>source,fetcher:async(...args)=>{calls.push(args);return {ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>({status:'ok',resolved:[]})};},...change});
  const res={setHeader(){},status(n){this.code=n;return this;},json(b){this.body=b;}};
  return {res,calls,run:req=>worker({method:'GET',headers:{authorization:`Bearer ${env.CRON_SECRET}`},query:{},...req},res)};
}
test('worker rejects alternate projects, standby packages, mutable URLs and signing/database credentials',()=>{
  validateResolverWorker(env,source);
  for(const change of [{VERCEL_ENV:'preview'},{VERCEL_PROJECT_ID:'other'},{CRON_SECRET:env.RESOLVER_TRIGGER_SECRET},{DATABASE_URL:'forbidden'},{TURNKEY_API_PUBLIC_KEY:'forbidden'},{ONCHAIN_RPC_URL:'forbidden'}])assert.throws(()=>validateResolverWorker({...env,...change},source));
  for(const change of [{mode:'standby'},{branch:'pointbreak'},{sha:'unknown'},{target:'https://pronos.io/api/cron/sepolia-resolve'},{target:source.target+'?dry=true'},{target:source.target.replace('https:','http:')}])assert.throws(()=>validateResolverWorker(env,{...source,...change}));
});
test('worker authenticates and stays off by default; enabled trigger pins source and forbids redirects',async()=>{
  const unauthorized=fixture();await unauthorized.run({headers:{}});assert.equal(unauthorized.res.code,401);assert.equal(unauthorized.calls.length,0);
  const off=fixture({env:{...env,ONCHAIN_RESOLVER_WORKER_ENABLED:undefined}});await off.run();assert.equal(off.res.body.status,'disabled');assert.equal(off.calls.length,0);
  const overridden=fixture();await overridden.run({query:{target:'forged'}});assert.equal(overridden.res.code,400);assert.equal(overridden.calls.length,0);
  const f=fixture({env:{...env,PREVIEW_PROTECTION_BYPASS_SECRET:'fixture-bypass'}});await f.run();assert.equal(f.res.code,200);assert.equal(f.calls.length,1);
  const [url,options]=f.calls[0];assert.equal(url,source.target);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers['x-pronos-resolver-source'],source.sha);assert.equal(options.headers.authorization,`Bearer ${env.RESOLVER_TRIGGER_SECRET}`);assert.equal(options.headers['x-vercel-protection-bypass'],'fixture-bypass');
});
test('worker treats non-JSON, HTTP errors and raw credential errors as unavailable',async()=>{
  for(const fetcher of [async()=>({ok:false}),async()=>({ok:true,headers:new Headers({'content-type':'text/html'})}),async()=>{throw Error('private-token');}]){
    const f=fixture({fetcher});await f.run();assert.equal(f.res.code,503);assert.doesNotMatch(JSON.stringify(f.res.body),/private-token/);
  }
});
test('standby and active packages use exact committed bytes; preparation does not deploy',async t=>{
  const root=await mkdtemp(join(tmpdir(),'resolver-package-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const repo=join(root,'repo'),workerDir=join(repo,'ops/onchain-sepolia-resolver');await mkdir(join(workerDir,'api'),{recursive:true});
  for(const file of ['worker.js','api/tick.js','package.json','build.mjs','vercel.json','prepare.mjs'])await copyFile(new URL(file,import.meta.url),join(workerDir,file));
  const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-b','onchain-sepolia']);git(['add','ops']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);
  for(const active of [false,true]){
    const output=join(root,active?'active':'standby');
    const result=JSON.parse(execFileSync(process.execPath,[join(workerDir,'prepare.mjs'),'--output',output,'--target',source.target,...(active?['--active']:[])],{cwd:repo,encoding:'utf8'}));
    assert.equal(result.deployed,false);assert.equal(result.enabled,false);
    const metadata=JSON.parse(await readFile(join(output,'source.json'),'utf8')),config=JSON.parse(await readFile(join(output,'vercel.json'),'utf8'));
    assert.equal(metadata.sha,git(['rev-parse','HEAD']));assert.equal(metadata.mode,active?'active':'standby');assert.equal(config.crons.length,active?1:0);
    if(active)assert.equal(config.crons[0].schedule,'*/5 * * * *');
    assert.equal(await readFile(join(output,'worker.js'),'utf8'),await readFile(join(workerDir,'worker.js'),'utf8'));
    execFileSync(process.execPath,[join(output,'build.mjs')],{cwd:output});
  }
  await writeFile(join(workerDir,'worker.js'),'uncommitted change');
  assert.throws(()=>execFileSync(process.execPath,[join(workerDir,'prepare.mjs'),'--output',join(root,'dirty'),'--target',source.target],{cwd:repo,stdio:'pipe'}));
});
