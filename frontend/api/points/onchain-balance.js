/**
 * GET /api/points/onchain-balance
 *
 * Returns the authenticated user's on-chain MXNB balance (the ERC-20
 * collateral they trade with on /mvp). Distinct from the off-chain
 * MXNP balance in points_balances — that's the Points-app currency
 * for the off-chain AMM, served by /api/points/auth/me.
 *
 * Response shape:
 *   { balance: number, symbol: 'MXNB', chainId: number,
 *     address: '0x…', decimals: number, cached: boolean }
 *
 * Best-effort: if the user has no wallet_address yet, or the chain
 * RPC fails, returns 0 with the appropriate detail string instead of
 * a 5xx — the Nav UI just shows '— MXNB' in those cases.
 *
 * Performance: bare ERC-20 balanceOf RPC call. Cheap enough that we
 * skip any in-process cache; Alchemy's free tier easily handles it
 * even on every page load. If we ever need to scale, drop a 30s
 * memoize keyed on (address, chainId).
 */
import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const session = requireSession(req, res);
    if (!session) return;
    if (!session.sub) return res.status(400).json({ error: 'suborg_required' });

    const rpcUrl = process.env.ONCHAIN_RPC_URL;
    const collateralAddr = process.env.ONCHAIN_COLLATERAL_ADDRESS;
    const chainId = Number(process.env.ONCHAIN_CHAIN_ID || 421614);
    if (!rpcUrl || !collateralAddr) {
      return res.status(200).json({
        balance: 0,
        symbol: 'MXNB',
        chainId,
        address: null,
        decimals: 18,
        cached: false,
        detail: 'onchain_not_configured',
      });
    }

    await ensurePointsSchema(schemaSql);

    // Resolve wallet address from points_users by sub-org id.
    const rows = await sql`
      SELECT wallet_address
      FROM points_users
      WHERE turnkey_sub_org_id = ${session.sub}
      LIMIT 1
    `;
    const walletAddress = rows[0]?.wallet_address;
    if (!walletAddress) {
      return res.status(200).json({
        balance: 0,
        symbol: 'MXNB',
        chainId,
        address: null,
        decimals: 18,
        cached: false,
        detail: 'wallet_not_found',
      });
    }

    let balance = 0;
    let decimals = 18;
    try {
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const erc20 = new ethers.Contract(collateralAddr, ERC20_ABI, provider);
      // Pull decimals first (one-time per request — could be cached
      // module-scope but ERC-20 implementations vary so it's safer to
      // ask each time during testnet).
      const [raw, dec] = await Promise.all([
        erc20.balanceOf(walletAddress),
        erc20.decimals().catch(() => 18),
      ]);
      decimals = Number(dec);
      balance = Number(ethers.utils.formatUnits(raw, decimals));
    } catch (e) {
      console.warn('[points/onchain-balance] rpc failed', { message: e?.message });
      return res.status(200).json({
        balance: 0,
        symbol: 'MXNB',
        chainId,
        address: walletAddress,
        decimals: 18,
        cached: false,
        detail: 'rpc_failed',
      });
    }

    return res.status(200).json({
      balance,
      symbol: 'MXNB',
      chainId,
      address: walletAddress,
      decimals,
      cached: false,
    });
  } catch (e) {
    console.error('[points/onchain-balance] unhandled', { message: e?.message });
    return res.status(500).json({ error: 'balance_fetch_failed' });
  }
}
