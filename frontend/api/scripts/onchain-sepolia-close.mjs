#!/usr/bin/env node
import { readFile,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { planHash,requireTournamentPreview } from '../_lib/sepolia-tournament.js';
import { buildTournamentFinalScores,exportSeasonContext,verifySeasonCutoff } from '../_lib/sepolia-tournament-final.js';
import { tournamentCloseStore } from '../_lib/sepolia-tournament-close-store.js';

// Explicit files/environment only. No signer, chain write, .env loader, reset,
// automatic migration, payout or runtime activation exists in this command.
export async function closeCommand(values,{env=process.env,sqlFor=neon,now=new Date(),
  branch=()=>execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),
  providerFor=url=>new ethers.providers.JsonRpcProvider(url)}={}) {
  if (!values.input || !values.output) throw Error('explicit_close_inputs_required');
  const artifact=JSON.parse(await readFile(values.input,'utf8'));
  if (values['export-context']) {
    if (values.apply || values.context) throw Error('context_export_is_read_only');
    requireTournamentPreview({env,branch:branch(),expectedHost:values['expected-host']});
    const context=await exportSeasonContext(artifact,sqlFor(env.DATABASE_URL));
    await writeFile(values.output,JSON.stringify(context,null,2)+'\n',{flag:'wx',mode:0o600});
    return {cycleId:context.cycleId,contextHash:planHash(context),applied:false};
  }
  if (!values.context) throw Error('explicit_close_inputs_required');
  const context=JSON.parse(await readFile(values.context,'utf8'));
  const result=buildTournamentFinalScores({artifact,context,reviewedSnapshotHash:values['reviewed-snapshot-hash'],
    reviewedContextHash:values['reviewed-context-hash'],now});
  if (values.apply) {
    requireTournamentPreview({env,branch:branch(),expectedHost:values['expected-host']});
    const rpc=new URL(env.ONCHAIN_RPC_URL);
    if (rpc.protocol!=='https:') throw Error('https_rpc_required');
    await verifySeasonCutoff(result,providerFor(rpc.href));
    await tournamentCloseStore(sqlFor(env.DATABASE_URL)).close(result);
  }
  // A failed local export after DB confirmation is recovered by another output
  // filename. The immutable DB result makes a repeated close idempotent.
  await writeFile(values.output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return {cycleId:result.cycleId,status:result.status,resultHash:result.resultHash,
    totalParticipants:result.totalParticipants,applied:Boolean(values.apply),readyForRewards:false};
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const {values}=parseArgs({options:{input:{type:'string'},context:{type:'string'},output:{type:'string'},
      'reviewed-snapshot-hash':{type:'string'},'reviewed-context-hash':{type:'string'},
      'expected-host':{type:'string'},apply:{type:'boolean'},'export-context':{type:'boolean'},help:{type:'boolean'}}});
    if(values.help) console.log('Final scoring/season close: --input <final-capture.json> --context <reviewed-points-context.json> --output <new-private-result.json> --reviewed-snapshot-hash <sha256> --reviewed-context-hash <sha256>. Default is offline export. --export-context with --expected-host reads Points metadata to a new private output (no --context or --apply). --apply with --expected-host persists results in the explicitly pinned onchain-sepolia Preview DB after checking live cutoff hashes. No ETH, transaction or current-cycle switch.');
    else console.log(JSON.stringify(await closeCommand(values)));
  } catch {console.error('Season closing refused: verify reviewed final capture, Points context, immutable results and explicit future-preview destination. No transaction was sent.');process.exitCode=1;}
}
