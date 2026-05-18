import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requireSession } from '../../_lib/session.js';
import {
  createJunoClabe,
  extractJunoClabe,
  extractJunoExternalId,
  isJunoConfigured,
  registerJunoBlockchainAccount,
} from '../../_lib/juno.js';
import {
  buildDepositMethods,
  buildFundingHistory,
  buildFundingStatusPayload,
  ensureJunoFundingSchema,
} from '../../_lib/juno-funding.js';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const sql = neon(process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

async function getOnchainBalance(walletAddress) {
  const chainId = Number(process.env.ONCHAIN_CHAIN_ID || 42161);
  if (!walletAddress || !process.env.ONCHAIN_RPC_URL || !process.env.ONCHAIN_COLLATERAL_ADDRESS) {
    return { balance: 0, symbol: 'MXNB', chainId, decimals: 18 };
  }
  try {
    const provider = new ethers.providers.JsonRpcProvider(process.env.ONCHAIN_RPC_URL);
    const erc20 = new ethers.Contract(process.env.ONCHAIN_COLLATERAL_ADDRESS, ERC20_ABI, provider);
    const [raw, decimals, symbol] = await Promise.all([
      erc20.balanceOf(walletAddress),
      erc20.decimals().catch(() => 18),
      erc20.symbol().catch(() => 'MXNB'),
    ]);
    const dec = Number(decimals || 18);
    return {
      balance: Number(ethers.utils.formatUnits(raw, dec)),
      symbol: symbol || 'MXNB',
      chainId,
      decimals: dec,
    };
  } catch (error) {
    console.warn('[protocol/onboarding/funding] balance fetch failed', { message: error?.message });
    return { balance: 0, symbol: 'MXNB', chainId, decimals: 18, detail: 'rpc_failed' };
  }
}

function toUser(row, session) {
  return {
    turnkeySubOrgId: row?.turnkey_sub_org_id || session?.sub || null,
    walletAddress: row?.wallet_address || null,
  };
}

async function ensureFundingAccount(user) {
  if (!user?.turnkeySubOrgId || !user?.walletAddress) return null;
  const rows = await sql`
    INSERT INTO juno_funding_accounts (turnkey_sub_org_id, wallet_address)
    VALUES (${user.turnkeySubOrgId}, ${user.walletAddress})
    ON CONFLICT (turnkey_sub_org_id)
    DO UPDATE SET wallet_address = EXCLUDED.wallet_address, updated_at = NOW()
    RETURNING *
  `;
  return rows[0] || null;
}

async function refreshJunoProvisioning(account, user, configured) {
  if (!configured || !account || !user?.walletAddress) return account;
  let next = account;
  const externalRef = `pronos-${user.turnkeySubOrgId}`;

  if (!next.clabe) {
    try {
      const response = await createJunoClabe({ externalRef, walletAddress: user.walletAddress });
      const clabe = extractJunoClabe(response);
      const junoAccountId = extractJunoExternalId(response);
      if (clabe || junoAccountId) {
        const rows = await sql`
          UPDATE juno_funding_accounts
          SET clabe = COALESCE(${clabe}, clabe),
              juno_account_id = COALESCE(${junoAccountId}, juno_account_id),
              updated_at = NOW()
          WHERE turnkey_sub_org_id = ${user.turnkeySubOrgId}
          RETURNING *
        `;
        next = rows[0] || next;
      }
    } catch (error) {
      console.warn('[protocol/onboarding/funding] clabe provisioning pending', { message: error?.message });
    }
  }

  if (!next.blockchain_account_registered) {
    try {
      await registerJunoBlockchainAccount({ externalRef, walletAddress: user.walletAddress });
      const rows = await sql`
        UPDATE juno_funding_accounts
        SET blockchain_account_registered = true, updated_at = NOW()
        WHERE turnkey_sub_org_id = ${user.turnkeySubOrgId}
        RETURNING *
      `;
      next = rows[0] || next;
    } catch (error) {
      console.warn('[protocol/onboarding/funding] wallet registration pending', { message: error?.message });
    }
  }

  return next;
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const session = requireSession(req, res);
    if (!session) return;

    await ensurePointsSchema(schemaSql);
    await ensureJunoFundingSchema(schemaSql);

    const userRows = await sql`
      SELECT turnkey_sub_org_id, wallet_address
      FROM points_users
      WHERE turnkey_sub_org_id = ${session.sub}
      LIMIT 1
    `;
    const user = toUser(userRows[0], session);
    const configured = isJunoConfigured(process.env);
    const baseAccount = await ensureFundingAccount(user);
    const fundingAccount = await refreshJunoProvisioning(baseAccount, user, configured);
    const balance = await getOnchainBalance(user.walletAddress);
    const clabe = fundingAccount?.clabe || null;
    const walletAddress = user.walletAddress || null;
    const transactionEvents = await sql`
      SELECT id, transaction_type, transaction_status, amount, asset, network,
             tx_hash, clabe, created_at
      FROM juno_transaction_events
      WHERE turnkey_sub_org_id = ${user.turnkeySubOrgId}
         OR (${walletAddress}::text IS NOT NULL AND LOWER(wallet_address) = LOWER(${walletAddress}))
         OR (${clabe}::text IS NOT NULL AND clabe = ${clabe})
      ORDER BY created_at DESC
      LIMIT 25
    `;
    const withdrawalRequests = await sql`
      SELECT id, status, amount, asset, destination_clabe, destination_name,
             provider_request_id, requested_at, processed_at, updated_at
      FROM juno_withdrawal_requests
      WHERE turnkey_sub_org_id = ${user.turnkeySubOrgId}
      ORDER BY requested_at DESC
      LIMIT 25
    `;

    return res.status(200).json(buildFundingStatusPayload({
      user,
      fundingAccount,
      balance,
      junoConfigured: configured,
      depositMethods: buildDepositMethods(process.env),
      history: buildFundingHistory({ transactionEvents, withdrawalRequests }),
    }));
  } catch (error) {
    console.error('[protocol/onboarding/funding] unhandled', { message: error?.message });
    return res.status(500).json({ error: 'funding_status_failed' });
  }
}
