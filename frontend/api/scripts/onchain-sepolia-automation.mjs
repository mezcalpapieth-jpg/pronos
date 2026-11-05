#!/usr/bin/env node
import { readFile,writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { isSepoliaGasDatabase } from '../_lib/sepolia-gas-config.js';
import { discoverStandingsRegistry } from '../_lib/sepolia-standings-registry.js';
import { buildStandingsPolicy,appendStandingsMarkets } from '../_lib/sepolia-tournament-automation.js';

export async function automationPolicyCommand(values) {
  if(!values.registry || !values.context || !values.output)throw Error('explicit_policy_inputs_required');
  const inputs={registry:JSON.parse(await readFile(values.registry,'utf8')),
    context:JSON.parse(await readFile(values.context,'utf8')),fromBlock:Number(values['from-block']),
    confirmations:values.confirmations===undefined?12:Number(values.confirmations),
    reviewedRegistryHash:values['reviewed-registry-hash'],reviewedContextHash:values['reviewed-context-hash']};
  const revision=Boolean(values['previous-policy']||values['previous-context']||values['reviewed-previous-hash']);
  if(revision && (!values['previous-policy']||!values['previous-context']||!values['reviewed-previous-hash']))throw Error('reviewed_previous_policy_required');
  const policy=revision?appendStandingsMarkets({...inputs,previous:JSON.parse(await readFile(values['previous-policy'],'utf8')),
    previousContext:JSON.parse(await readFile(values['previous-context'],'utf8')),reviewedPreviousHash:values['reviewed-previous-hash'],reason:values.reason}):buildStandingsPolicy(inputs);
  await writeFile(values.output,JSON.stringify(policy,null,2)+'\n',{flag:'wx',mode:0o600});
  return {cycleId:policy.cycleId,policyHash:policy.policyHash,enabled:false};
}
export async function registryDiscoveryCommand(values,{env=process.env,sqlFor=neon,providerFor=url=>new ethers.providers.JsonRpcProvider({url,timeout:10000})}={}) {
  if(!values.output||!isSepoliaGasDatabase(env.ONCHAIN_SNAPSHOT_DATABASE_URL))throw Error('isolated_preview_registry_required');
  const rpc=new URL(env.ONCHAIN_SNAPSHOT_RPC_URL);if(rpc.protocol!=='https:')throw Error('https_rpc_required');
  const proposal=await discoverStandingsRegistry({sql:sqlFor(env.ONCHAIN_SNAPSHOT_DATABASE_URL),provider:providerFor(rpc.href),cycleId:values['cycle-id'],
    reviewedPlanHash:values['reviewed-plan-hash'],confirmations:values.confirmations===undefined?12:Number(values.confirmations)});
  await writeFile(values.output,JSON.stringify(proposal,null,2)+'\n',{flag:'wx',mode:0o600});
  return {registryHash:proposal.registryHash,markets:proposal.registry.markets.length,enabled:false};
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const {values}=parseArgs({options:Object.fromEntries(['registry','context','output','from-block','confirmations',
      'previous-policy','previous-context','reviewed-previous-hash','reason','cycle-id','reviewed-plan-hash','mode','reviewed-registry-hash','reviewed-context-hash'].map(k=>[k,{type:'string'}]))});
    if(values.mode && !['discover','policy'].includes(values.mode))throw Error('unknown_automation_mode');
    console.log(JSON.stringify(await (values.mode==='discover'?registryDiscoveryCommand(values):automationPolicyCommand(values))));
  } catch {console.error('Policy refused: use reviewed inputs, isolated discovery credentials if needed, and a new private output. No activation or transaction submitted.');process.exitCode=1;}
}
