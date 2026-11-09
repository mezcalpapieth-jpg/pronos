import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { pendingApprovalSettings } from './onchain-preview-approval.js';
import { verifyTournamentDeployment } from './sepolia-tournament.js';
import { tournamentStore } from './sepolia-tournament-store.js';
import { tournamentJoinStore } from './sepolia-tournament-join-store.js';
import { joinTournament } from './sepolia-tournament-join.js';
import { readRuntimeSeason, seasonSettings } from './sepolia-tournament-season.js';
import { signTransactionForSuborg } from './turnkey.js';

export function lateJoinSettings(env = process.env) {
  const enabled = pendingApprovalSettings(env).previewEnabled && env.ONCHAIN_TOURNAMENT_LATE_JOIN_ENABLED === 'true';
  return {enabled, configured:Boolean(enabled && seasonSettings(env).configured
    && env.ONCHAIN_TOURNAMENT_FUNDER_SUBORG_ID && env.ONCHAIN_RPC_URL
    && env.TURNKEY_POLICIES_ENABLED === 'true' && env.ONCHAIN_DURABLE_TRADES_ENABLED === 'true')};
}

// Read-only hint for the buy dialog. The grant remains unavailable to spend
// until the buy endpoint reconciles its confirmed transfer.
export async function readTournamentOpeningGrant(suborgId, { env = process.env, sqlFor = neon,
  readSeason = readRuntimeSeason, now = Date.now() } = {}) {
  if (!lateJoinSettings(env).configured) return null;
  const season = await readSeason({ env, sqlFor });
  const plan = season?.cycle.plan;
  if (!plan || season.closure || plan.lateJoining !== 'open_during_cycle'
    || now < Date.parse(plan.startsAt) || now >= Date.parse(plan.endsAt)) return null;

  const sql = sqlFor(env.DATABASE_URL);
  const store = tournamentJoinStore(sql, tournamentStore(sql));
  const user = await store.user(suborgId);
  const opening = plan.batches.some(batch => batch.recipients.some(r => r.kind === 'user'
    && (r.username === user.username || r.wallet === user.wallet || r.suborg === user.suborg)));
  if (opening || (await store.join(plan.cycleId, user))?.status === 'confirmed') return null;
  return ethers.utils.formatUnits(plan.allocationUnits, 6);
}

export async function prepareTournamentJoin(suborgId, { env = process.env, market, expectedWallet,
  sqlFor = neon, providerFor = url => new ethers.providers.JsonRpcProvider(url),
  sign = signTransactionForSuborg, run = joinTournament } = {}) {
  const settings = lateJoinSettings(env);
  if (!settings.enabled) return {status:'disabled'};
  if (!settings.configured || !suborgId) throw Object.assign(Error('tournament_join_unavailable'),{status:503});
  const sql = sqlFor(env.DATABASE_URL), provider = providerFor(env.ONCHAIN_RPC_URL);
  try {
    return await run({store:tournamentJoinStore(sql,tournamentStore(sql)),provider,
      cycleId:env.ONCHAIN_TOURNAMENT_CYCLE_ID,suborgId,expectedWallet,
      verifyRuntime:async plan => {
        const d = plan.deployment;
        if (market && (Number(market.chain_id) !== d.chainId
          || ![d.factoryV1, d.factoryV2].includes(market.factory_address?.toLowerCase()))) {
          throw Object.assign(Error('trade_market_changed'), { status: 409 });
        }
        for (const [key,field] of [['ONCHAIN_COLLATERAL_ADDRESS','token'],['ONCHAIN_MARKET_FACTORY_ADDRESS','factoryV1'],
          ['ONCHAIN_MARKET_FACTORY_V2_ADDRESS','factoryV2'],['ONCHAIN_TRADING_ROUTER_ADDRESS','router'],['ONCHAIN_DEPLOYER_ADDRESS','operations']]) {
          if (env[key]?.toLowerCase()!==d[field]) throw Error('join_runtime_mismatch');
        }
        await verifyTournamentDeployment(plan,{provider,expectedSupply:plan.totalUnits,allowMarkets:true});
      },
      sign:async(tx,plan) => sign({suborgId:env.ONCHAIN_TOURNAMENT_FUNDER_SUBORG_ID,
        signWithAddress:ethers.utils.getAddress(plan.deployment.operations),unsignedSerialized:ethers.utils.serializeTransaction(tx)}),
    });
  } catch (error) {
    if (['join_funder_busy','join_funder_has_pending_transaction'].includes(error.message)) return { status:'pending' };
    if (error.message === 'trade_market_changed' && error.status === 409) throw error;
    if (error.message === 'join_outside_cycle_window') throw Object.assign(Error('tournament_join_outside_window'), { status:409 });
    if (error.message === 'join_identity_changed') throw Object.assign(Error('trade_owner_changed'), { status:403 });
    // Never expose SDK errors, signed payloads or the private cycle roster.
    throw Object.assign(Error('tournament_join_unavailable'),{status:503});
  }
}
