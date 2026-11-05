#!/usr/bin/env node
// Serial, offline acceptance checks. No env files, API credentials, remote
// provider, fork, broadcast, deployment, migration or wallet funding command.
import {spawnSync,execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const {values}=parseArgs({options:{output:{type:'string'}}});
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(git(['branch','--show-current'])!=='onchain-sepolia')throw Error('onchain_sepolia_checkout_required');
const baseline={head:git(['rev-parse','HEAD']),pointbreak:git(['rev-parse','pointbreak'])};
const env={PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,TZ:'UTC',NODE_ENV:'test',
  SEPOLIA_GAS_TEST_PGLITE:import.meta.resolve('@electric-sql/pglite')};
const lib='frontend/api/_lib/',admin='frontend/api/points/admin/';
const groups=[
  ['refunds_and_durable_nonces',[...['onchain-cancel-refunds','onchain-admin-settlement','onchain-resolution','onchain-simulation','trade-requests.integration'].map(n=>lib+n+'.test.js'),
    admin+'onchain-refunds.test.js',admin+'onchain-settlement.test.js','frontend/app/points/src/components/AdminOnchainSettlement.test.js']],
  ['automatic_resolution',[lib+'sepolia-resolver.test.js',admin+'onchain-resolution-preview.test.js','frontend/api/cron/sepolia-resolve.test.js','ops/onchain-sepolia-resolver/worker.test.js']],
  ['season_preparation_and_gas',[...['sepolia-season-preparation','sepolia-tournament','sepolia-tournament-join','sepolia-gas-funding','sepolia-gas-store.integration','sepolia-gas-activity','sepolia-gas-readiness'].map(n=>lib+n+'.test.js')]],
  ['standings',[lib+'sepolia-standings-registry.test.js',lib+'sepolia-tournament-automation.test.js',lib+'sepolia-tournament-provisional.test.js',
    'ops/onchain-sepolia-standings/worker.test.js','ops/onchain-sepolia-standings/prepare.test.js']],
  ['full_season_accounting',[...['sepolia-season-rehearsal','sepolia-tournament-capture','sepolia-tournament-snapshot','sepolia-tournament-transfers','sepolia-tournament-lifecycle',
    'sepolia-tournament-scoring','sepolia-tournament-final','sepolia-tournament-rewards','sepolia-tournament-presentation','onchain-operations','onchain-transactions','onchain-readiness'].map(n=>lib+n+'.test.js')]],
];
const report={version:1,mode:'local_offline',startedAt:new Date().toISOString(),branch:'onchain-sepolia',source:baseline,
  groups:[],liveChainTransactions:0,runtimeTouched:false,liveLaunchVerified:false};
for(const [name,files] of groups) {
  console.log(JSON.stringify({phase:name,status:'running'}));
  const result=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',...files],{cwd:root,env,encoding:'utf8',maxBuffer:8*1024*1024});
  const out=result.stdout||'',count=k=>Number(out.match(new RegExp(`^# ${k} (\\d+)$`,'m'))?.[1]||0);
  const row={name,passed:result.status===0&&count('tests')>0&&count('skipped')===0,tests:count('tests'),failures:count('fail'),skipped:count('skipped')};
  report.groups.push(row);console.log(JSON.stringify(row));
  if(!row.passed){console.error(out);console.error(result.stderr||result.error?.message||'');break;}
}
if(report.groups.length===groups.length&&report.groups.every(g=>g.passed)) {
  console.log(JSON.stringify({phase:'solidity_contracts',status:'running'}));
  const result=spawnSync('forge',['test','--offline','--threads','1','--summary','--root',resolve(root,'contracts')],{cwd:root,env,encoding:'utf8',maxBuffer:8*1024*1024});
  const out=result.stdout||'',suites=[...out.matchAll(/Suite result: ok\. (\d+) passed; (\d+) failed; (\d+) skipped/g)];
  report.groups.push({name:'solidity_contracts',passed:result.status===0&&suites.length>0,tests:suites.reduce((n,m)=>n+Number(m[1]),0),failures:suites.reduce((n,m)=>n+Number(m[2]),0),skipped:suites.reduce((n,m)=>n+Number(m[3]),0)});
  console.log(JSON.stringify(report.groups.at(-1)));
  if(result.status!==0){console.error(out);console.error(result.stderr||result.error?.message||'');}
}
report.refsUnchanged=baseline.head===git(['rev-parse','HEAD'])&&baseline.pointbreak===git(['rev-parse','pointbreak'])&&git(['branch','--show-current'])==='onchain-sepolia';
report.passed=report.groups.length===groups.length+1&&report.groups.every(g=>g.passed&&g.failures===0&&g.skipped===0)&&report.refsUnchanged;
report.totalTests=report.groups.reduce((n,g)=>n+g.tests,0);report.completedAt=new Date().toISOString();
if(values.output)await writeFile(values.output,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({passed:report.passed,totalTests:report.totalTests,liveChainTransactions:0,liveLaunchVerified:false,output:values.output||null}));
if(!report.passed)process.exitCode=1;
