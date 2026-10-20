import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const prepare=fileURLToPath(new URL('./prepare.mjs',import.meta.url));
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'pronos-standings-package-'));
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],
    env:{...process.env,GIT_AUTHOR_NAME:'Package test',GIT_COMMITTER_NAME:'Package test',
      GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_EMAIL:'test@example.invalid'}}).trim();
  git(['init','--initial-branch=onchain-sepolia']);
  await mkdir(join(root,'ops/onchain-sepolia-standings/api'),{recursive:true});
  await mkdir(join(root,'frontend/api/_lib'),{recursive:true});
  for(const [path,body] of Object.entries({
    'ops/onchain-sepolia-standings/vercel.json':JSON.stringify({functions:{'api/tick.js':{includeFiles:'{review,source}.json'}},crons:[{path:'/api/tick',schedule:'* * * * *'}]}),
    'ops/onchain-sepolia-standings/api/tick.js':'// committed handler',
    'ops/onchain-sepolia-standings/worker.test.js':'// excluded test',
    'frontend/api/_lib/module.js':'// committed shared module',
    'frontend/api/_lib/module.test.js':'// excluded test',
  }))await writeFile(join(root,path),body);
  git(['add','.']);git(['commit','-m','Package fixture']);
  const run=args=>execFileSync(process.execPath,[prepare,...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  return {root,git,run,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('standby packages exact committed source privately, without policy, tests or a cron schedule',async()=>{
  const f=await fixture();
  try {
    const output=join(f.root,'release');
    const result=JSON.parse(f.run(['--disabled','--output',output]));
    assert.equal(result.sha,f.git(['rev-parse','HEAD']));assert.equal(result.mode,'standby');
    assert.equal(result.policyHash,null);assert.equal(result.enabled,false);assert.equal(result.deployed,false);
    assert.deepEqual(JSON.parse(await readFile(join(output,'source.json'),'utf8')),
      {branch:'onchain-sepolia',sha:result.sha,mode:'standby'});
    const config=JSON.parse(await readFile(join(output,'vercel.json'),'utf8'));
    assert.deepEqual(config.crons,[]);assert.equal(config.functions['api/tick.js'].includeFiles,'source.json');
    assert.equal(await readFile(join(output,'api/tick.js'),'utf8'),'// committed handler');
    for(const path of ['review.json','worker.test.js','src/module.test.js'])await assert.rejects(stat(join(output,path)),{code:'ENOENT'});
    assert.equal((await stat(output)).mode&0o777,0o700);
    assert.equal((await stat(join(output,'source.json'))).mode&0o777,0o600);
    assert.throws(()=>f.run(['--disabled','--output',output]),/Command failed/);
  } finally {await f.cleanup();}
});
test('missing review, mixed standby/policy, wrong branch and dirty source fail before packaging',async()=>{
  const f=await fixture();
  try {
    const output=join(f.root,'release');
    for(const args of [[],['--policy','missing.json'],['--disabled','--policy','missing.json'],
      ['--disabled','--reviewed-policy-hash','a'.repeat(64)]]) {
      assert.throws(()=>f.run([...args,'--output',output]),/Command failed/);
      await assert.rejects(stat(output),{code:'ENOENT'});
    }
    f.git(['branch','-m','pointbreak']);
    assert.throws(()=>f.run(['--disabled','--output',output]),/Command failed/);
    f.git(['branch','-m','onchain-sepolia']);
    await writeFile(join(f.root,'frontend/api/_lib/module.js'),'// uncommitted change');
    assert.throws(()=>f.run(['--disabled','--output',output]),/Command failed/);
    await assert.rejects(stat(output),{code:'ENOENT'});
  } finally {await f.cleanup();}
});
