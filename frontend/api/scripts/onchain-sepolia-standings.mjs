#!/usr/bin/env node
import { readFile,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { requireTournamentPreview } from '../_lib/sepolia-tournament.js';
import { buildTournamentProvisionalScores,verifyProvisionalAnchor } from '../_lib/sepolia-tournament-provisional.js';
import { tournamentProvisionalStore } from '../_lib/sepolia-tournament-provisional-store.js';

// Offline by default. The explicit publish path writes only reviewed standings
// to the pinned future preview. No signer, transaction or automatic migration.
export async function standingsCommand(values,{env=process.env,sqlFor=neon,now=new Date(),
  branch=()=>execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),
  providerFor=url=>new ethers.providers.JsonRpcProvider(url)}={}) {
  if (!values.input || !values.context || !values.output) throw Error('explicit_standings_inputs_required');
  const artifact=JSON.parse(await readFile(values.input,'utf8')),context=JSON.parse(await readFile(values.context,'utf8'));
  const result=buildTournamentProvisionalScores({artifact,context,reviewedSnapshotHash:values['reviewed-snapshot-hash'],
    reviewedContextHash:values['reviewed-context-hash'],now});
  if (values.publish) {
    requireTournamentPreview({env,branch:branch(),expectedHost:values['expected-host']});
    const rpc=new URL(env.ONCHAIN_RPC_URL);
    if (rpc.protocol!=='https:') throw Error('https_rpc_required');
    await verifyProvisionalAnchor(result,providerFor(rpc.href));
    await tournamentProvisionalStore(sqlFor(env.DATABASE_URL)).publish(result);
  }
  await writeFile(values.output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return {cycleId:result.cycleId,resultHash:result.resultHash,status:'provisional',asOf:result.asOf,
    totalParticipants:result.totalParticipants,published:Boolean(values.publish),readyForRewards:false};
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const {values}=parseArgs({options:{input:{type:'string'},context:{type:'string'},output:{type:'string'},
      'reviewed-snapshot-hash':{type:'string'},'reviewed-context-hash':{type:'string'},
      'expected-host':{type:'string'},publish:{type:'boolean'},help:{type:'boolean'}}});
    if (values.help) console.log('Provisional standings: --input <ongoing-capture.json> --context <reviewed-points-context.json> --output <new-private-result.json> --reviewed-snapshot-hash <sha256> --reviewed-context-hash <sha256>. Default: offline export. --publish --expected-host <isolated-preview-host> checks the live canonical anchor and persists reviewed standings. No ETH or cycle activation.');
    else console.log(JSON.stringify(await standingsCommand(values)));
  } catch {console.error('Standings refused: verify the reviewed ongoing capture, Points context and explicit future-preview destination. No transaction was sent.');process.exitCode=1;}
}
