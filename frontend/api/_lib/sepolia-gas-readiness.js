import { ethers } from 'ethers';
import { sepoliaGasSettings } from './sepolia-gas-config.js';

export function gasFundingReadiness(env = process.env) {
  const config = sepoliaGasSettings(env);
  return { enabled: config.enabled, configured: config.configured, ready: false,
    funder: config.funder, targetEth: ethers.utils.formatEther(config.target),
    minimumEth: ethers.utils.formatEther(config.minimum), walletDailyEth: ethers.utils.formatEther(config.walletDaily),
    globalDailyEth: ethers.utils.formatEther(config.globalDaily), reserveEth: ethers.utils.formatEther(config.reserve),
    schemaReady: false, pendingTransfers: null, balanceEth: null, signerVerified: false };
}

// Read-only evidence. Funding permission is proven by the first real transfer,
// not inferred from a public key or a successful balance request.
export async function probeGasFunding({ env = process.env, provider, sql }) {
  const result = gasFundingReadiness(env);
  if (!result.enabled || !result.configured) return result;
  const config = sepoliaGasSettings(env);
  try {
    const [network, code, balance, tables] = await Promise.all([
      provider.getNetwork(), provider.getCode(config.funder), provider.getBalance(config.funder),
      sql`SELECT to_regclass('public.sepolia_gas_lock') IS NOT NULL AS lock_ready,
        to_regclass('public.sepolia_gas_transfers') IS NOT NULL AS ledger_ready`,
    ]);
    result.balanceEth = ethers.utils.formatEther(balance);
    if (!tables[0]?.lock_ready || !tables[0]?.ledger_ready) return result;
    const [state] = await sql`SELECT
      (has_table_privilege(current_user, 'sepolia_gas_lock', 'SELECT')
        AND has_table_privilege(current_user, 'sepolia_gas_lock', 'INSERT')
        AND has_table_privilege(current_user, 'sepolia_gas_lock', 'UPDATE')) AS lock_access,
      (has_table_privilege(current_user, 'sepolia_gas_transfers', 'SELECT')
        AND has_table_privilege(current_user, 'sepolia_gas_transfers', 'INSERT')
        AND has_table_privilege(current_user, 'sepolia_gas_transfers', 'UPDATE')) AS ledger_access,
      (SELECT count(*)::integer FROM sepolia_gas_transfers WHERE status = 'prepared') AS pending,
      EXISTS (SELECT 1 FROM sepolia_gas_transfers WHERE funder_address = ${config.funder}
        AND signer_key_hash = ${config.signerKeyHash} AND status = 'confirmed') AS proven,
      NOT EXISTS (SELECT 1 FROM sepolia_gas_lock WHERE funder_address <> ${config.funder}) AS funder_matches,
      (SELECT COALESCE(sum(max_cost_wei), 0)::text FROM sepolia_gas_transfers
        WHERE created_at > now() - interval '24 hours' OR status = 'prepared') AS spent`;
    result.schemaReady = Boolean(state.lock_access && state.ledger_access);
    result.pendingTransfers = state.pending;
    result.signerVerified = Boolean(state.proven);
    result.dailyBudgetUsedEth = ethers.utils.formatEther(state.spent);
    result.ready = Boolean(network.chainId === 421614 && code === '0x' && result.schemaReady && state.funder_matches
      && state.pending === 0 && state.proven
      && ethers.BigNumber.from(state.spent).add(config.target).add(config.transferGasCap.mul(config.maxFeePerGas)).lte(config.globalDaily)
      && balance.gte(config.reserve.add(config.target).add(config.transferGasCap.mul(config.maxFeePerGas))));
  } catch {
    result.error = 'gas_funding_probe_failed';
  }
  return result;
}
