import { neon } from '@neondatabase/serverless';
import { pendingApprovalSettings } from './onchain-preview-approval.js';
import { isSepoliaGasDatabase } from './sepolia-gas-config.js';
import { tradeRequestStore } from './trade-request-store.js';
import { runDurableTrade, tradeError, tradeRequestKey } from './trade-requests.js';
import { signDelegatedTransaction } from './turnkey-delegation.js';
import { ethers } from 'ethers';

export function tradeRequestSettings(env = process.env) {
  const enabled = env.ONCHAIN_DURABLE_TRADES_ENABLED === 'true' && pendingApprovalSettings(env).previewEnabled;
  return { enabled, configured: enabled && isSepoliaGasDatabase(env.DATABASE_URL) && Boolean(env.ONCHAIN_RPC_URL) };
}
export async function tradeRequestWallet(sql, suborg) {
  const rows = await sql`SELECT wallet_address, turnkey_sub_org_id FROM points_users
    WHERE turnkey_sub_org_id = ${suborg} LIMIT 2`;
  if (rows.length !== 1 || !ethers.utils.isAddress(rows[0].wallet_address || '')) throw tradeError('wallet_not_found', 400);
  const wallet = rows[0].wallet_address.toLowerCase();
  // A duplicate wallet mapping must not create two independent owners of the
  // same idempotency namespace or signing authority.
  const owners = await sql`SELECT turnkey_sub_org_id FROM points_users WHERE LOWER(wallet_address) = ${wallet} LIMIT 2`;
  if (owners.length !== 1 || owners[0].turnkey_sub_org_id !== suborg) throw tradeError('trade_owner_ambiguous', 409);
  return wallet;
}

export async function protocolTradeRequest({ req, session, action, payload, prepare, execute, validate },
  { env = process.env, sqlFor = neon, providerFor = () => new ethers.providers.JsonRpcProvider(env.ONCHAIN_RPC_URL),
    sign = signDelegatedTransaction } = {}) {
  const settings = tradeRequestSettings(env);
  if (settings.enabled && !settings.configured) throw tradeError('trade_requests_unavailable', 503);
  const key = settings.enabled ? tradeRequestKey(req) : null;
  const sql = sqlFor(settings.enabled ? env.DATABASE_URL : env.DATABASE_READ_URL || env.DATABASE_URL);
  const wallet = await tradeRequestWallet(sql, session.sub);
  if (settings.enabled && req.body?.requestScope && req.body.requestScope !== `421614:${wallet}`) {
    throw tradeError('trade_owner_changed', 403);
  }
  if (!settings.enabled) return { httpStatus: 200, body: await execute(await prepare({ ownerAddr: wallet })) };
  return runDurableTrade({ store: tradeRequestStore(sql), provider: providerFor(), sign,
    wallet, suborg: session.sub, key, action, payload, prepare, execute, validate });
}
