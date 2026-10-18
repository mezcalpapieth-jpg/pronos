#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { buildTournamentShadowScores } from '../_lib/sepolia-tournament-scoring.js';

// Offline input only. Never loads .env, connects to a DB, signs, or broadcasts.
const { values } = parseArgs({ options: { input:{type:'string'}, 'reviewed-plan-hash':{type:'string'}, help:{type:'boolean'} } });
if (values.help) {
  console.log('Offline shadow scoring: node api/scripts/onchain-sepolia-score.mjs --input <private-snapshot.json> --reviewed-plan-hash <sha256>');
} else {
  try {
    if (!values.input || !/^[a-f0-9]{64}$/.test(values['reviewed-plan-hash'] || '')) throw Error('input_and_reviewed_plan_hash_required');
    const input = JSON.parse(await readFile(values.input,'utf8'));
    console.log(JSON.stringify(buildTournamentShadowScores({...input,reviewedPlanHash:values['reviewed-plan-hash']}),null,2));
  } catch {
    console.error('Shadow scoring refused: validate the funded plan and complete canonical snapshot.');
    process.exitCode=1;
  }
}
