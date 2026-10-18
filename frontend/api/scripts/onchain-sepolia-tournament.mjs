#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { buildTournamentPlan, normalizeDeployment, planHash, requireTournamentPreview,
  summarizeTournament, tournamentRuntimeEnv, validateTournamentPlan, verifyTournamentDeployment } from '../_lib/sepolia-tournament.js';
import { SEPOLIA_TOURNAMENT_SCHEMA, tournamentStore } from '../_lib/sepolia-tournament-store.js';
import { fundTournamentBatch } from '../_lib/sepolia-tournament-funding.js';

async function main() {
  const [command = 'help', ...argv] = process.argv.slice(2);
  const allowed = new Set(['apply', 'expected-host', 'deployment', 'previous-deployment', 'cycle-id',
    'label', 'starts-at', 'ends-at', 'allocation', 'liquidity-mxnp', 'max-total-mxnp', 'batch-size',
    'out', 'plan', 'plan-hash', 'retry-reverted']);
  const flags = Object.fromEntries(argv.map(arg => {
    const match = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!match || !allowed.has(match[1])) throw new Error('unknown_tournament_argument');
    return [match[1], match[2] ?? true];
  }));
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const output = value => console.log(JSON.stringify(value, null, 2));
  const help = `Usage: node frontend/api/scripts/onchain-sepolia-tournament.mjs COMMAND [options]

  All operations require explicit onchain-sepolia preview metadata and its pinned
  direct DATABASE_URL/--expected-host. No .env file is loaded automatically.
  Default is read-only. No command deploys contracts or changes runtime settings.

  schema    Print migration SQL; --apply installs it in the isolated preview DB.
  plan      --deployment=JSON --previous-deployment=JSON --cycle-id=slug --label=...
            --starts-at=ISO --ends-at=ISO --liquidity-mxnp=N --max-total-mxnp=N
            [--allocation=500] [--batch-size=50] --out=/private/tmp/cycle.json
            Snapshot all users with a wallet and Turnkey suborg. Verify fresh stack.
  prepare   --plan=JSON --plan-hash=HASH [--apply] Record the immutable snapshot.
  fund      --cycle-id=slug --plan-hash=HASH [--apply] Send/reconcile ONE batch.
            Rerun until funded; require two confirmations. --retry-reverted after
            reviewing a reverted receipt. Ambiguous sends reuse the saved bytes.
  status    --cycle-id=slug Show summary/receipts, never signed transaction bytes.
  runtime   --cycle-id=slug Print config handoff ONLY after funding is final.

  Funding signer: either TOURNAMENT_MINTER_PRIVATE_KEY (the new token owner), or
  TOURNAMENT_MINTER_SUBORG_ID with the existing Turnkey server credentials.
  No user delegation or ETH grant is created. Gas remains on demand.
  `;

  if (command === 'help' || command === '--help') {
    console.log(help);
  } else {
    if (!['schema', 'plan', 'prepare', 'fund', 'status', 'runtime'].includes(command)) throw new Error('unknown_tournament_command');
    const apply = flags.apply === true;
    if (flags.apply !== undefined && !apply) throw new Error('use_bare_apply_flag');
    if (flags['retry-reverted'] !== undefined && flags['retry-reverted'] !== true) throw new Error('use_bare_retry_reverted_flag');
    if (apply && !['schema', 'prepare', 'fund'].includes(command)) throw new Error('command_is_read_only');
    if (command === 'schema' && !apply) {
      console.log(`${SEPOLIA_TOURNAMENT_SCHEMA.join(';\n\n')};`);
    } else {
      requireTournamentPreview({ branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
        expectedHost: flags['expected-host'] });
      const sql = neon(process.env.DATABASE_URL);
      const provider = new ethers.providers.JsonRpcProvider(process.env.ONCHAIN_RPC_URL);
      const store = tournamentStore(sql);
      if (command === 'schema') {
        await sql.transaction(SEPOLIA_TOURNAMENT_SCHEMA.map(ddl => sql.query(ddl)));
        output({ schemaInstalled: true, minted: false });
      } else if (command === 'plan') {
        const previousDeployment = normalizeDeployment(read(flags['previous-deployment']));
        if (previousDeployment.token !== process.env.ONCHAIN_COLLATERAL_ADDRESS?.toLowerCase()
          || previousDeployment.factoryV1 !== process.env.ONCHAIN_MARKET_FACTORY_ADDRESS?.toLowerCase()
          || previousDeployment.factoryV2 !== process.env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS?.toLowerCase()
          || previousDeployment.router !== process.env.ONCHAIN_TRADING_ROUTER_ADDRESS?.toLowerCase()) throw new Error('previous_deployment_must_match_current_preview');
        // No LIMIT: silent truncation would omit users from the opening allocation.
        const users = await sql`SELECT username, wallet_address, turnkey_sub_org_id FROM points_users ORDER BY LOWER(username)`;
        const plan = buildTournamentPlan({ deployment: read(flags.deployment), previousDeployment, users,
          cycleId: flags['cycle-id'], label: flags.label, startsAt: flags['starts-at'], endsAt: flags['ends-at'],
          allocation: flags.allocation || '500', liquidityMxnp: flags['liquidity-mxnp'], maxTotalMxnp: flags['max-total-mxnp'],
          batchSize: Number(flags['batch-size'] || 50) });
        await verifyTournamentDeployment(plan, { provider });
        fs.writeFileSync(flags.out, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        output({ ...summarizeTournament(plan), writtenTo: flags.out, applied: false });
      } else if (command === 'prepare') {
        const plan = validateTournamentPlan(read(flags.plan));
        if (planHash(plan) !== flags['plan-hash']) throw new Error('reviewed_plan_hash_required');
        if (new Date(plan.endsAt) <= new Date()) throw new Error('cycle_ended');
        // Repeat prepare is harmless, including after funding started. The stored
        // hash, never a newly queried user list, defines all resumable work.
        let existing;
        try { existing = await store.cycle(plan.cycleId); } catch (error) { if (error.message !== 'cycle_not_found') throw error; }
        if (existing && existing.plan_hash !== flags['plan-hash']) throw new Error('cycle_snapshot_is_immutable');
        if (!existing) await verifyTournamentDeployment(plan, { provider });
        if (apply) await store.register(plan, flags['plan-hash']);
        output({ ...summarizeTournament(plan), applied: apply });
      } else {
        const cycle = await store.cycle(flags['cycle-id']);
        const plan = validateTournamentPlan(cycle.plan);
        if (planHash(plan) !== cycle.plan_hash) throw new Error('stored_plan_hash_mismatch');
        if (command === 'runtime') {
          if (cycle.status !== 'funded') throw new Error('funding_must_finish_before_runtime_handoff');
          output({ cycleId: plan.cycleId, env: tournamentRuntimeEnv(plan), previousDeployment: plan.previousDeployment,
            activationRequired: ['Preserve old deployment access, policies, pools and indexer coverage for outstanding claims.',
              'Review the full branch-scoped runtime and service-signer targets before preview deployment.',
              'Users authorize the new router through the normal owner flow. Funding is not trading authorization.'] });
        } else if (command === 'status' || !apply) {
          output({ ...summarizeTournament(plan), status: cycle.status, applied: false,
            attempts: await store.attempts(plan.cycleId) });
        } else {
          let sign;
          if (process.env.TOURNAMENT_MINTER_PRIVATE_KEY && process.env.TOURNAMENT_MINTER_SUBORG_ID) throw new Error('choose_one_minter_signer');
          if (process.env.TOURNAMENT_MINTER_PRIVATE_KEY) {
            const wallet = new ethers.Wallet(process.env.TOURNAMENT_MINTER_PRIVATE_KEY);
            if (wallet.address.toLowerCase() !== plan.deployment.owner) throw new Error('minter_is_not_token_owner');
            sign = tx => wallet.signTransaction(tx);
          } else if (process.env.TOURNAMENT_MINTER_SUBORG_ID) {
            const { signTransactionForSuborg } = await import('../_lib/turnkey.js');
            sign = tx => signTransactionForSuborg({ suborgId: process.env.TOURNAMENT_MINTER_SUBORG_ID,
              signWithAddress: ethers.utils.getAddress(plan.deployment.owner), unsignedSerialized: ethers.utils.serializeTransaction(tx) });
          } else throw new Error('explicit_token_owner_signer_required');
          output(await fundTournamentBatch({ store, provider, cycleId: plan.cycleId,
            expectedHash: flags['plan-hash'], sign, retryReverted: flags['retry-reverted'] === true }));
        }
      }
    }
  }
}

main().catch(error => {
  // SDK/RPC errors can echo unsigned/signed payloads or credentials. Preserve
  // our short operational error codes only; never dump provider error objects.
  const safe = /^[a-z][a-z0-9_:-]{0,120}$/.test(error.message || '') ? error.message : 'tournament_operation_failed';
  console.error(safe);
  process.exitCode = 1;
});
