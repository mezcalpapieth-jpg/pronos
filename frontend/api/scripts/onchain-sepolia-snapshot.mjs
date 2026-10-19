#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ethers } from 'ethers';
import { neon } from '@neondatabase/serverless';
import { isSepoliaGasDatabase } from '../_lib/sepolia-gas-config.js';
import { buildTournamentSnapshot } from '../_lib/sepolia-tournament-snapshot.js';

// Explicit environment only; never load production/root .env or a signer.
export async function snapshotCommand(values, { env=process.env, sqlFor=neon,
  providerFor=url=>new ethers.providers.JsonRpcProvider(url), buildSnapshot=buildTournamentSnapshot }={}) {
    if (!values.input || !values.output || !/^[a-f0-9]{64}$/.test(values['reviewed-plan-hash'] || '')
      || !/^[a-f0-9]{64}$/.test(values['reviewed-registry-hash'] || '')
      || !isSepoliaGasDatabase(env.ONCHAIN_SNAPSHOT_DATABASE_URL)) throw Error('explicit_preview_inputs_required');
    const rpc = new URL(env.ONCHAIN_SNAPSHOT_RPC_URL);
    if (rpc.protocol !== 'https:') throw Error('https_rpc_required');
    const request = JSON.parse(await readFile(values.input,'utf8'));
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(request.cycleId || '')) throw Error('cycle_id_required');
    const provider = providerFor(rpc.href);
    // Fix an already-final cutoff before reading the registration ledger. New
    // joins can then only land after that cutoff; a changed anchor is refused.
    const network=await provider.getNetwork(),tip=await provider.getBlockNumber();
    if (network.chainId!==421614 || !Number.isSafeInteger(request.asOfBlock) || request.asOfBlock<1
      || tip-request.asOfBlock<1) throw Error('final_cutoff_required');
    const anchor=await provider.getBlock(request.asOfBlock);
    const sql = sqlFor(env.ONCHAIN_SNAPSHOT_DATABASE_URL);
    const result = await sql`SELECT plan, plan_hash, status FROM sepolia_tournament_cycles WHERE cycle_id = ${request.cycleId}`;
    const cycles = Array.isArray(result) ? result : result.rows;
    if (cycles.length !== 1 || cycles[0].plan.cycleId !== request.cycleId) throw Error('funded_cycle_required');
    const attempts = await sql`SELECT batch_index, tx_hash FROM sepolia_tournament_mints WHERE cycle_id = ${request.cycleId} AND status = 'confirmed' ORDER BY batch_index`;
    const joins = cycles[0].plan.lateJoining === 'open_during_cycle'
      ? await sql`SELECT plan_hash, username, wallet_address, suborg_id, tx_hash, status FROM sepolia_tournament_joins
          WHERE cycle_id = ${request.cycleId} AND status <> 'reverted' ORDER BY created_at,tx_hash` : [];
    const joinRows=Array.isArray(joins)?joins:joins.rows;
    if (joinRows.some(r=>r.status!=='confirmed')) throw Error('pending_join_reconciliation_required');
    const artifact = await buildSnapshot({ cycle:cycles[0], fromBlock:request.fromBlock,
      asOfBlock:request.asOfBlock, expectedCutoffHash:anchor.hash, registry:request.registry, final:request.final === true,
      reviewedPlanHash:values['reviewed-plan-hash'], reviewedRegistryHash:values['reviewed-registry-hash'],
      lateJoins:joinRows.map(r=>({planHash:r.plan_hash,username:r.username,wallet:r.wallet_address,suborg:r.suborg_id,txHash:r.tx_hash})),
      funding:(Array.isArray(attempts) ? attempts : attempts.rows).map(r => ({ batchIndex:Number(r.batch_index), txHash:r.tx_hash })) }, {
      provider,
      readIndexerCoverage:async factories => {
        const result = await sql`SELECT chain_id, factory_address, last_block FROM indexer_factory_state WHERE chain_id = 421614 AND factory_address = ANY(${factories}::text[])`;
        return (Array.isArray(result) ? result : result.rows).map(r => ({ chainId:Number(r.chain_id), factory:r.factory_address, lastBlock:Number(r.last_block) }));
      },
    });
    // Exclusive creation: an existing reviewed artifact is never overwritten.
    await writeFile(values.output,JSON.stringify(artifact,null,2)+'\n',{ flag:'wx', mode:0o600 });
    return { mode:artifact.mode, readyForRewards:false, snapshotHash:artifact.snapshotHash,
      registryHash:artifact.registryHash, markets:artifact.snapshot.markets.length, events:artifact.snapshot.events.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { input:{type:'string'}, output:{type:'string'},
    'reviewed-plan-hash':{type:'string'}, 'reviewed-registry-hash':{type:'string'}, help:{type:'boolean'} } });
  if (values.help) {
    console.log('Read-only shadow snapshot: --input <private-request.json> --output <new-private-artifact.json> --reviewed-plan-hash <sha256> --reviewed-registry-hash <sha256>. Requires ONCHAIN_SNAPSHOT_DATABASE_URL (isolated preview) and ONCHAIN_SNAPSHOT_RPC_URL.');
  } else try {
    console.log(JSON.stringify(await snapshotCommand(values)));
  } catch {
    console.error('Snapshot refused: check reviewed inputs, complete preview coverage, funding and canonical RPC history. No transaction was sent.');
    process.exitCode = 1;
  }
}
