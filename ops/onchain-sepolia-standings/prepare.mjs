// Produce a private, reviewable worker package from committed Sepolia source.
// This command does not link projects, set env vars, deploy or activate a cron.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { resolve,join,dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { validateStandingsPolicy } from '../../frontend/api/_lib/sepolia-tournament-automation.js';

const {values}=parseArgs({options:{disabled:{type:'boolean'},policy:{type:'string'},'reviewed-policy-hash':{type:'string'},output:{type:'string'}}});
assert.ok(values.output,'Explicit new output directory required');
if(values.disabled)assert.ok(!values.policy && !values['reviewed-policy-hash'],'Standby releases cannot include a policy');
else assert.ok(values.policy && values['reviewed-policy-hash'],'Explicit reviewed policy required, or use --disabled for standby');
const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
assert.equal(git(['branch','--show-current']).trim(),'onchain-sepolia');
assert.equal(git(['status','--porcelain','--','ops/onchain-sepolia-standings','frontend/api/_lib']).trim(),'',
  'Commit the worker and shared modules before preparing a release');
const sha=git(['rev-parse','HEAD']).trim();
const policy=values.disabled?null:JSON.parse(await readFile(values.policy,'utf8'));
if(policy)validateStandingsPolicy(policy,values['reviewed-policy-hash']);
const destination=resolve(values.output);await mkdir(destination,{mode:0o700});
async function copy(path,relative) {
  const target=join(destination,relative);await mkdir(dirname(target),{recursive:true,mode:0o700});
  await writeFile(target,git(['show',`${sha}:${path}`]),{flag:'wx',mode:0o600});
}
for(const path of git(['ls-files','ops/onchain-sepolia-standings']).trim().split('\n')) {
  if(!path || /(?:\.gitignore|README\.md|schema\.sql|prepare\.mjs)$|\.test\./.test(path))continue;
  if(values.disabled && path.endsWith('/vercel.json')) {
    const config=JSON.parse(git(['show',`${sha}:${path}`]));
    config.crons=[];
    config.functions['api/tick.js'].includeFiles='source.json';
    await writeFile(join(destination,'vercel.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
    continue;
  }
  await copy(path,path.slice('ops/onchain-sepolia-standings/'.length));
}
for(const path of git(['ls-files','frontend/api/_lib']).trim().split('\n')) {
  if(!path || /\.test\.|test-fixture/.test(path))continue;
  await copy(path,'src/'+path.slice('frontend/api/_lib/'.length));
}
const mode=values.disabled?'standby':'active';
await writeFile(join(destination,'source.json'),JSON.stringify({branch:'onchain-sepolia',sha,mode}),{flag:'wx',mode:0o600});
if(policy)await writeFile(join(destination,'review.json'),JSON.stringify(policy),{flag:'wx',mode:0o600});
console.log(JSON.stringify({directory:destination,sha,mode,policyHash:policy?.policyHash??null,deployed:false,enabled:false}));
