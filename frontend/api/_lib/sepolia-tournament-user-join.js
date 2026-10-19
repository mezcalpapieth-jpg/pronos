import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { pendingApprovalSettings } from './onchain-preview-approval.js';
import { isSepoliaGasDatabase } from './sepolia-gas-config.js';
import { verifyTournamentDeployment } from './sepolia-tournament.js';
import { tournamentStore } from './sepolia-tournament-store.js';
import { tournamentJoinStore } from './sepolia-tournament-join-store.js';
import { joinTournament } from './sepolia-tournament-join.js';
import { signTransactionForSuborg } from './turnkey.js';

export function lateJoinSettings(env = process.env) {
  const enabled = pendingApprovalSettings(env).previewEnabled && env.ONCHAIN_TOURNAMENT_LATE_JOIN_ENABLED === 'true';
  return {enabled, configured:Boolean(enabled && isSepoliaGasDatabase(env.DATABASE_URL)
    && /^[a-z0-9][a-z0-9-]{2,63}$/.test(env.ONCHAIN_TOURNAMENT_CYCLE_ID || '')
    && env.ONCHAIN_TOURNAMENT_FUNDER_SUBORG_ID && env.ONCHAIN_RPC_URL && env.TURNKEY_POLICIES_ENABLED === 'true')};
}

export async function prepareTournamentJoin(suborgId, { env = process.env,
  sqlFor = neon, providerFor = url => new ethers.providers.JsonRpcProvider(url),
  sign = signTransactionForSuborg, run = joinTournament } = {}) {
  const settings = lateJoinSettings(env);
  if (!settings.enabled) return {status:'disabled'};
  if (!settings.configured || !suborgId) throw Object.assign(Error('tournament_join_unavailable'),{status:503});
  const sql = sqlFor(env.DATABASE_URL), provider = providerFor(env.ONCHAIN_RPC_URL);
  try {
    return await run({store:tournamentJoinStore(sql,tournamentStore(sql)),provider,
      cycleId:env.ONCHAIN_TOURNAMENT_CYCLE_ID,suborgId,
      verifyRuntime:async plan => {
        const d = plan.deployment;
        for (const [key,field] of [['ONCHAIN_COLLATERAL_ADDRESS','token'],['ONCHAIN_MARKET_FACTORY_ADDRESS','factoryV1'],
          ['ONCHAIN_MARKET_FACTORY_V2_ADDRESS','factoryV2'],['ONCHAIN_TRADING_ROUTER_ADDRESS','router'],['ONCHAIN_DEPLOYER_ADDRESS','operations']]) {
          if (env[key]?.toLowerCase()!==d[field]) throw Error('join_runtime_mismatch');
        }
        await verifyTournamentDeployment(plan,{provider,expectedSupply:plan.totalUnits,allowMarkets:true});
      },
      sign:async(tx,plan) => sign({suborgId:env.ONCHAIN_TOURNAMENT_FUNDER_SUBORG_ID,
        signWithAddress:ethers.utils.getAddress(plan.deployment.operations),unsignedSerialized:ethers.utils.serializeTransaction(tx)}),
    });
  } catch {
    // Never expose SDK errors, signed payloads or the private cycle roster.
    throw Object.assign(Error('tournament_join_unavailable'),{status:503});
  }
}
