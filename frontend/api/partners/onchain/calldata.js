import { neon } from '@neondatabase/serverless';
import { ensureProtocolSchema } from '../../_lib/protocol-schema.js';
import { clientIp, rateLimit } from '../../_lib/rate-limit.js';
import {
  buildProtocolApprovalTransaction,
  buildProtocolBuyTransaction,
  buildProtocolRedeemTransaction,
  buildProtocolSellTransaction,
  readProtocolCollateralAllowance,
  quoteBuyOnChain,
  quoteSellOnChain,
} from '../../_lib/onchain-trader.js';
import { defaultMinCollateralOut, defaultMinSharesOut } from '../../_lib/protocol-trade-guards.js';
import {
  applyPartnerCors,
  normalizeAction,
  normalizeChainId,
  normalizeMarketLookup,
  normalizeOutcomeIndex,
  normalizeWalletAddress,
  partnerError,
  positiveNumber,
  readPartnerMarketRow,
  toPartnerMarket,
  withPartnerEnvelope,
} from '../../_lib/partner-onchain.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function marketForChain(row) {
  return {
    chain_address: row.pool_address,
    outcomes: Array.isArray(row.outcomes) ? row.outcomes : JSON.parse(row.outcomes || '["Sí","No"]'),
  };
}

function slippagePct(value) {
  const bps = Number(value ?? 200);
  if (!Number.isFinite(bps) || bps < 0) return 2;
  return Math.min(bps, 5000) / 100;
}

export default async function handler(req, res) {
  const cors = applyPartnerCors(req, res, { methods: 'POST, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'POST') return partnerError(res, 405, 'method_not_allowed');

  const limited = rateLimit(req, res, {
    key: `partner-onchain-calldata:${clientIp(req)}`,
    limit: 120,
    windowMs: 60_000,
    structuredError: true,
  });
  if (limited) return;

  const body = req.body || {};
  const action = normalizeAction(body.action || body.side || 'buy');
  if (!action) return partnerError(res, 400, 'invalid_action');
  const lookup = normalizeMarketLookup(body.marketId || body.id || body.poolAddress);
  if (!lookup.dbId && !lookup.poolAddress) return partnerError(res, 400, 'invalid_market_id');
  const outcomeIndex = normalizeOutcomeIndex(body.outcomeIndex);
  if (action !== 'redeem' && outcomeIndex === null) return partnerError(res, 400, 'invalid_outcome_index');

  const collateral = positiveNumber(body.collateral ?? body.amount);
  const shares = positiveNumber(body.shares ?? body.amount);
  const redeemAmount = positiveNumber(body.redeemAmount ?? body.amount ?? body.shares);
  if (action === 'buy' && collateral === null) return partnerError(res, 400, 'invalid_collateral');
  if (action === 'sell' && shares === null) return partnerError(res, 400, 'invalid_shares');
  if (action === 'redeem' && redeemAmount === null) return partnerError(res, 400, 'invalid_redeem_amount');

  try {
    await ensureProtocolSchema(schemaSql);
    const chainId = normalizeChainId(body.chainId ?? body.chain_id);
    const row = await readPartnerMarketRow(sql, { lookup, chainId });
    if (!row) return partnerError(res, 404, 'market_not_found');
    if (action !== 'redeem' && row.status !== 'active') return partnerError(res, 400, 'market_closed');
    if (action !== 'redeem' && row.end_time && new Date(row.end_time) <= new Date()) {
      return partnerError(res, 400, 'market_expired');
    }

    const market = marketForChain(row);
    if (!market.chain_address) return partnerError(res, 400, 'market_missing_pool');
    if (outcomeIndex !== null && outcomeIndex >= market.outcomes.length) {
      return partnerError(res, 400, 'invalid_outcome_index');
    }

    const transactions = [];
    const warnings = [];
    let quote = null;
    let allowance = null;
    const walletAddress = normalizeWalletAddress(body.walletAddress || body.owner || body.address);

    if (action === 'buy') {
      quote = await quoteBuyOnChain({ market, outcomeIndex, collateral });
      const minSharesOut = positiveNumber(body.minSharesOut)
        ?? defaultMinSharesOut(quote, slippagePct(body.slippageBps));

      if (walletAddress) {
        try {
          allowance = await readProtocolCollateralAllowance({
            ownerAddr: walletAddress,
            spenderAddr: market.chain_address,
          });
        } catch (e) {
          warnings.push({ code: 'allowance_check_failed', detail: e?.message || 'allowance check failed' });
        }
      }

      const allowanceValue = allowance ? Number(allowance.allowance) : null;
      const approvalRequired = allowanceValue === null ? 'unknown' : allowanceValue < collateral;
      if (approvalRequired !== false) {
        transactions.push({
          role: 'approve_collateral',
          required: approvalRequired,
          transaction: buildProtocolApprovalTransaction({ spender: market.chain_address, amount: 'max' }),
        });
      }
      transactions.push({
        role: 'buy',
        required: true,
        transaction: buildProtocolBuyTransaction({
          market,
          outcomeIndex,
          collateral,
          minSharesOut,
        }),
      });
    } else if (action === 'sell') {
      quote = await quoteSellOnChain({ market, outcomeIndex, shares });
      const minCollateralOut = positiveNumber(body.minCollateralOut)
        ?? defaultMinCollateralOut(quote, slippagePct(body.slippageBps));
      transactions.push({
        role: 'sell',
        required: true,
        transaction: buildProtocolSellTransaction({
          market,
          outcomeIndex,
          shares,
          minCollateralOut,
        }),
      });
    } else {
      transactions.push({
        role: 'redeem',
        required: true,
        transaction: buildProtocolRedeemTransaction({ market, amount: redeemAmount }),
      });
    }

    return res.status(200).json(withPartnerEnvelope(req, {
      market: toPartnerMarket(row, { req }),
      request: {
        action,
        outcomeIndex,
        walletAddress,
        collateral: action === 'buy' ? collateral : null,
        shares: action === 'sell' ? shares : null,
        redeemAmount: action === 'redeem' ? redeemAmount : null,
      },
      quote,
      allowance,
      transactions,
      warnings,
    }));
  } catch (e) {
    if (e?.status) return partnerError(res, e.status, e.message, e.detail);
    console.error('[partners/onchain/calldata] failed', { message: e?.message, code: e?.code });
    return partnerError(res, 500, 'calldata_failed', 'Could not build partner calldata.');
  }
}

