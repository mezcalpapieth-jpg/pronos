#!/usr/bin/env node
import { readFile,writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildStandingsPolicy } from '../_lib/sepolia-tournament-automation.js';

export async function automationPolicyCommand(values) {
  if(!values.registry || !values.context || !values.output)throw Error('explicit_policy_inputs_required');
  const policy=buildStandingsPolicy({registry:JSON.parse(await readFile(values.registry,'utf8')),
    context:JSON.parse(await readFile(values.context,'utf8')),fromBlock:Number(values['from-block']),
    confirmations:values.confirmations===undefined?12:Number(values.confirmations),
    reviewedRegistryHash:values['reviewed-registry-hash'],reviewedContextHash:values['reviewed-context-hash']});
  await writeFile(values.output,JSON.stringify(policy,null,2)+'\n',{flag:'wx',mode:0o600});
  return {cycleId:policy.cycleId,policyHash:policy.policyHash,enabled:false};
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const {values}=parseArgs({options:Object.fromEntries(['registry','context','output','from-block','confirmations',
      'reviewed-registry-hash','reviewed-context-hash'].map(k=>[k,{type:'string'}]))});
    console.log(JSON.stringify(await automationPolicyCommand(values)));
  } catch {console.error('Policy refused: use a reviewed registry/context and a new private output. No network, activation or transaction.');process.exitCode=1;}
}
