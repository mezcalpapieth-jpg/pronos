#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { snapshotCommand } from './onchain-sepolia-snapshot.mjs';
import { captureTournamentSnapshot } from '../_lib/sepolia-tournament-capture.js';

export async function captureCommand(values, dependencies={}) {
  const maxRequests=values['max-requests']===undefined?500:Number(values['max-requests']);
  if(!values.checkpoint || !Number.isSafeInteger(maxRequests) || maxRequests<1 || maxRequests>5000)throw Error('invalid_capture_options');
  const paused=new Error('capture_paused');let capture;
  try {
    const result=await snapshotCommand(values,{...dependencies,buildSnapshot:async(input,options)=>{
      capture=await captureTournamentSnapshot(input,{...options,checkpointDirectory:values.checkpoint,maxRequests});
      if(capture.status==='paused')throw paused;
      return capture.artifact;
    }});
    const {artifact,...progress}=capture;
    return {...progress,...result};
  } catch(error) {if(error===paused)return capture;throw error;}
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const {values}=parseArgs({options:{input:{type:'string'},output:{type:'string'},checkpoint:{type:'string'},
      'reviewed-plan-hash':{type:'string'},'reviewed-registry-hash':{type:'string'},'max-requests':{type:'string'},help:{type:'boolean'}}});
    if(values.help)console.log('Read-only resumable shadow capture: --input <private-request.json> --output <new-private-artifact.json> --checkpoint <private-directory> --reviewed-plan-hash <sha256> --reviewed-registry-hash <sha256> [--max-requests 500]. Repeat the same command after status paused. Explicit preview DB/RPC environment required.');
    else console.log(JSON.stringify(await captureCommand(values)));
  } catch {
    console.error('Capture refused: review private checkpoints, the pinned chain history and explicit preview inputs. No transaction was sent.');
    process.exitCode=1;
  }
}
