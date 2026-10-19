#!/usr/bin/env node
import { readFile,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { requireTournamentPreview,planHash } from '../_lib/sepolia-tournament.js';
import { buildRewardEligibility,exportRewardEvidence } from '../_lib/sepolia-tournament-rewards.js';
import { tournamentRewardStore } from '../_lib/sepolia-tournament-reward-store.js';

// No prize amounts or payout command. Default is an offline review artifact.
export async function rewardsCommand(values,{env=process.env,sqlFor=neon,now=new Date(),
  branch=()=>execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim()}={}) {
  if(!values.output)throw Error('new_private_output_required');
  let report,published=false;
  if(values['export-evidence']) {
    if(values.apply || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(values['cycle-id']||''))throw Error('evidence_cycle_required');
    requireTournamentPreview({env,branch:branch(),expectedHost:values['expected-host']});
    const sql=sqlFor(env.DATABASE_URL);
    const response=await sql`SELECT c.plan,c.plan_hash,c.status,r.result FROM sepolia_tournament_cycles c
      JOIN sepolia_tournament_closures r USING(cycle_id) WHERE c.cycle_id=${values['cycle-id']}`;
    const [cycle]=Array.isArray(response)?response:response.rows;
    if(!cycle || planHash(cycle.plan)!==cycle.plan_hash || cycle.status!=='funded')throw Error('frozen_reward_cycle_required');
    report=await exportRewardEvidence(cycle,cycle.result,sql);
  } else {
    if(!values.input || !values.review || !values.evidence)throw Error('explicit_reward_inputs_required');
    const {cycle,result}=JSON.parse(await readFile(values.input,'utf8'));
    const review=JSON.parse(await readFile(values.review,'utf8')),evidence=JSON.parse(await readFile(values.evidence,'utf8'));
    report=buildRewardEligibility({cycle,result,review,evidence,now,reviewedResultHash:values['reviewed-result-hash'],
      reviewedEvidenceHash:values['reviewed-evidence-hash'],reviewedReviewHash:values['reviewed-review-hash']});
    if(values.apply) {
      requireTournamentPreview({env,branch:branch(),expectedHost:values['expected-host']});
      await tournamentRewardStore(sqlFor(env.DATABASE_URL)).publish(report);published=true;
    }
  }
  await writeFile(values.output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  return {cycleId:report.cycleId,hash:report.eligibilityHash||planHash(report),published,readyForRewards:false};
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const {values}=parseArgs({options:Object.fromEntries(['input','review','evidence','output','reviewed-result-hash',
      'reviewed-evidence-hash','reviewed-review-hash','expected-host','cycle-id'].map(k=>[k,{type:'string'}])
      .concat(['apply','export-evidence','help'].map(k=>[k,{type:'boolean'}])))});
    if(values.help)console.log('Offline eligibility: --input <cycle-and-frozen-result.json> --review <complete-decisions.json> --evidence <private-evidence.json> --output <new-private-report.json> --reviewed-result-hash <hash> --reviewed-evidence-hash <hash> --reviewed-review-hash <hash>. Read-only --export-evidence --cycle-id <id>, or explicit --apply, requires --expected-host and the isolated preview environment. No payout.');
    else console.log(JSON.stringify(await rewardsCommand(values)));
  } catch {console.error('Reward review refused. Check complete reviewed inputs, frozen result and preview destination. No payout or transaction was sent.');process.exitCode=1;}
}
