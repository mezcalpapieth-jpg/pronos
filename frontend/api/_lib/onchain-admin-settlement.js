import { ethers } from 'ethers';
import { pendingApprovalSettings } from './onchain-preview-approval.js';
import { isSepoliaGasDatabase } from './sepolia-gas-config.js';
import { runDurableTrade, tradeError, tradePayloadHash } from './trade-requests.js';
import { tradeRequestStore } from './trade-request-store.js';
import { onchainFeeData } from './onchain-fees.js';
import { resolveMarketOnChain, lifecycleMarketOnChain } from './onchain-trader.js';
import { REVIEW_EVENT_ABI } from './protocol-resolution-review.js';
import { proposalInterface, sepoliaReviewEnabled } from './sepolia-resolution-review.js';
import { simulateContractCall } from './onchain-simulation.js';
import { previewResolutionPayouts } from './onchain-resolution-payouts.js';

export const SETTLEMENT_ACTIONS = ['resolve', 'cancel', 'dispute', 'clear_dispute', 'correct_resolution'];
export const SETTLEMENT_MIGRATION = [
  `ALTER TABLE sepolia_trade_requests DROP CONSTRAINT sepolia_trade_requests_action_check`,
  `ALTER TABLE sepolia_trade_requests ADD CONSTRAINT sepolia_trade_requests_action_check
    CHECK (action IN ('buy','sell','redeem','admin_resolve','admin_cancel','admin_dispute','admin_clear_dispute','admin_correct_resolution','admin_cancel_refund'))`,
];
const address = a => ethers.utils.isAddress(a || '') && a.toLowerCase() !== ethers.constants.AddressZero ? a.toLowerCase() : null;
const events = new ethers.utils.Interface([
  ...REVIEW_EVENT_ABI,
  'event MarketResolved(uint256 indexed marketId, uint8 outcome)',
  'event MarketCanceled(uint256 indexed marketId)',
  'event ResolutionDisputeOpened(uint256 indexed marketId)',
  'event ResolutionDisputeCleared(uint256 indexed marketId)',
  'event MarketResolutionCorrected(uint256 indexed marketId, uint8 oldOutcome, uint8 newOutcome)',
]);
const eventNames = { resolve: 'MarketResolved', cancel: 'MarketCanceled', dispute: 'ResolutionDisputeOpened',
  clear_dispute: 'ResolutionDisputeCleared', correct_resolution: 'MarketResolutionCorrected' };
export const SETTLEMENT_LIMITS = { maxFeePerGas: '200000000', walletDailyWei: '5000000000000000', reserveWei: '1000000000000000' };

export function settlementSettings(env = process.env) {
  const enabled = pendingApprovalSettings(env).previewEnabled && env.ONCHAIN_ADMIN_SETTLEMENT_ENABLED === 'true';
  const factories = [address(env.ONCHAIN_MARKET_FACTORY_ADDRESS), address(env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS)];
  let databaseReady = false;
  try { databaseReady = isSepoliaGasDatabase(env.DATABASE_URL) && new URL(env.DATABASE_URL).pathname === '/neondb'; } catch { /* disabled */ }
  return { enabled, factories, configured: Boolean(enabled && databaseReady && factories.every(Boolean)
    && factories[0] !== factories[1] && address(env.ONCHAIN_COLLATERAL_ADDRESS) && env.ONCHAIN_RPC_URL
    && env.ONCHAIN_DURABLE_TRADES_ENABLED === 'true' && env.TURNKEY_POLICIES_ENABLED === 'true') };
}
export function settlementInput(body) {
  const allowed = ['marketId','action','outcome','reason','requestId','reviewHash'];
  if (Object.keys(body || {}).some(k => !allowed.includes(k))) throw tradeError('invalid_settlement_input', 400);
  const marketId = Number(body?.marketId), action = body?.action;
  if (!Number.isSafeInteger(marketId) || marketId < 1 || !SETTLEMENT_ACTIONS.includes(action)) throw tradeError('invalid_settlement_input', 400);
  const needsOutcome = ['resolve','correct_resolution'].includes(action);
  if (needsOutcome && (typeof body.outcome !== 'number' || !Number.isInteger(body.outcome) || body.outcome < 0 || body.outcome > 7)) throw tradeError('invalid_outcome', 400);
  if (!needsOutcome && body.outcome != null) throw tradeError('invalid_outcome', 400);
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 240) throw tradeError('settlement_reason_required', 400);
  if (Object.hasOwn(body,'reviewHash') && (action !== 'resolve' || typeof body.reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.reviewHash))) {
    throw tradeError('invalid_settlement_review', 400);
  }
  return { marketId, action, outcome: needsOutcome ? body.outcome : null, reason: body.reason.trim(),
    ...(body.reviewHash ? { reviewHash: body.reviewHash } : {}) };
}
export function assertSettlementMarket(m, env) {
  const settings = settlementSettings(env), variant = m?.protocol_version;
  const factory = address(m?.factory_address);
  if (!m || m.mode !== 'onchain' || Number(m.points_chain_id) !== 421614 || Number(m.chain_id) !== 421614
    || !['v1','v2'].includes(variant) || m.protocol_id == null
    || !address(m.pool_address) || address(m.chain_address) !== address(m.pool_address)
    || m.chain_market_id == null || !/^(0|[1-9]\d*)$/.test(String(m.contract_id))
    || String(m.chain_market_id) !== String(m.contract_id)
    || !factory || factory !== settings.factories[variant === 'v2' ? 1 : 0]) throw tradeError('settlement_market_mapping_unavailable', 409);
  if (m.parent_id || m.amm_mode === 'parallel') throw tradeError('onchain_parallel_settlement_requires_review', 409);
  return m;
}
export async function loadSettlementMarket(sql, id, env) {
  const rows = await sql`SELECT p.id AS points_id, p.mode, p.chain_id AS points_chain_id,
      p.chain_address, p.chain_market_id, p.parent_id, p.amm_mode, p.question,
      m.id AS protocol_id, m.chain_id, m.factory_address, m.pool_address, m.market_id AS contract_id,
      m.protocol_version, m.outcome_count, m.status, m.outcome, m.resolver_type, m.resolver_config, m.outcomes,
      m.tx_hash AS creation_tx_hash, m.resolution_review
    FROM points_markets p LEFT JOIN protocol_markets m
      ON m.chain_id = p.chain_id AND LOWER(m.pool_address) = LOWER(p.chain_address)
      AND m.market_id::text = p.chain_market_id::text
    WHERE p.id = ${id} LIMIT 2`;
  if (!rows.length) throw tradeError('market_not_found', 404);
  if (rows.length !== 1) throw tradeError('ambiguous_settlement_market', 409);
  return assertSettlementMarket(rows[0], env);
}
export function settlementSigner(action, env) {
  // Owner-only actions never fall back to the resolver/deployer accidentally.
  const owner = action !== 'resolve';
  const wallet = address(owner ? env.ONCHAIN_OWNER_ADDRESS : env.ONCHAIN_RESOLVER_ADDRESS);
  const suborg = owner ? env.ONCHAIN_OWNER_SUBORG_ID : env.ONCHAIN_RESOLVER_SUBORG_ID;
  if (!wallet || !suborg) throw tradeError(owner ? 'settlement_owner_not_configured' : 'settlement_resolver_not_configured', 503);
  if ([env.ONCHAIN_GAS_FUNDER_ADDRESS, '0x0Caa37c077924038e14e9D8dE46B5208788e52CF'].some(a => address(a) === wallet)) throw tradeError('settlement_signer_not_isolated', 503);
  return { wallet, suborg };
}
function validateAction(m, input, env) {
  if (m.resolution_review && (!sepoliaReviewEnabled(env) || !['resolve', 'cancel'].includes(input.action))) {
    throw tradeError('settlement_use_review_queue', 409);
  }
  const states = { resolve: ['active'], cancel: ['active','disputed'], dispute: ['resolved'], clear_dispute: ['disputed'], correct_resolution: ['disputed'] };
  if (!states[input.action].includes(m.status)) throw tradeError('settlement_market_state_changed', 409);
  const count = Number(m.outcome_count);
  if (input.outcome != null && (!Number.isInteger(count) || input.outcome >= count || (m.protocol_version === 'v1' && input.outcome > 1))) throw tradeError('invalid_outcome', 400);
}
export function assertSettlementReceipt(m, input, receipt, evidenceHash) {
  const rawOutcome = input.outcome == null ? null : input.outcome + (m.protocol_version === 'v1' ? 1 : 0);
  const log = receipt.status === 1 && (receipt.logs || []).find(log => {
    if (address(log.address) !== address(m.factory_address)) return false;
    try {
      const e = events.parseLog(log);
      const expected = evidenceHash ? 'ResolutionProposed' : eventNames[input.action];
      return e.name === expected && (!evidenceHash || e.args.evidenceHash === evidenceHash) && e.args.marketId.toString() === String(m.contract_id)
        && (rawOutcome == null || Number(e.args.newOutcome ?? e.args.outcome) === rawOutcome);
    } catch { return false; }
  });
  if (!log) throw tradeError('settlement_receipt_requires_review', 202);
  return events.parseLog(log).args;
}
export const settlementSourceHash = m => tradePayloadHash([m.resolver_type, m.resolver_config, m.outcomes]);
export function settlementQueueReviewHash(m, published) {
  return tradePayloadHash([
    Number(m.points_id), String(m.protocol_id), m.factory_address, m.pool_address, String(m.contract_id),
    m.protocol_version, Number(m.outcome_count), settlementSourceHash(m),
    ...(m.resolution_review ? [m.resolution_review.rulesHash] : []),
    { ...published, start_time: published.start_time == null ? null : new Date(published.start_time).toISOString(),
      end_time: new Date(published.end_time).toISOString() },
  ]);
}

export async function loadPublishedResolution(sql, marketId) {
  // Approval writes the proposal's resolver and labels to Points; the chain
  // indexer may know only the pool and its token IDs, especially for V1.
  const [published] = await sql`SELECT p.resolver_type, p.resolver_config, p.outcomes, p.start_time, p.end_time,
      p.sport, p.league, pm.source_data AS pending_source_data
    FROM points_markets p
    LEFT JOIN LATERAL (SELECT source_data FROM points_pending_markets WHERE approved_market_id=p.id ORDER BY id DESC LIMIT 1) pm ON true
    WHERE p.id=${marketId} AND p.status='active' AND p.end_time<=now()`;
  if (!published) throw tradeError('settlement_market_state_changed', 409);
  return published;
}

async function assertQueueReview(sql, market, input) {
  if (input.reviewHash && settlementQueueReviewHash(market, await loadPublishedResolution(sql, input.marketId)) !== input.reviewHash) {
    throw tradeError('settlement_source_changed', 409);
  }
}
export async function settleOnchainMarket({ sql, provider, env, input, key, actor, origin = 'admin', sign, expectedSourceHash, evidence,
  dispatch = { resolveMarketOnChain, lifecycleMarketOnChain }, contractAt = (a, abi) => new ethers.Contract(a, abi, provider),
  runner = runDurableTrade }) {
  if (!settlementSettings(env).configured) throw tradeError('onchain_settlement_unavailable', 503);
  const { wallet, suborg } = settlementSigner(input.action, env);
  const store = tradeRequestStore(sql);
  const previous = await store.find(wallet,key);
  const acceptedOrigin = previous?.payload?.origin || origin;
  // Preserve source evidence even if a process dies between creating its
  // immutable request and saving the execution plan. Recovery cannot replace it.
  const review = previous?.payload?.review || (expectedSourceHash ? {expectedSourceHash,evidence:evidence || null} : null);
  return runner({ store, provider, sign, wallet, suborg, key, action: `admin_${input.action}`,
    payload: { ...input, origin: acceptedOrigin, ...(review ? {review} : {}) },
    prepare: async () => {
      const market = await loadSettlementMarket(sql, input.marketId, env);
      validateAction(market, input, env);
      await assertQueueReview(sql, market, input);
      if (review && settlementSourceHash(market) !== review.expectedSourceHash) throw tradeError('settlement_source_changed', 409);
      let evidenceHash = null;
      if (market.resolution_review && input.action === 'resolve') {
        const published = await loadPublishedResolution(sql, input.marketId);
        const cfg = published.resolver_config || {};
        const labels = published.outcomes;
        if (!Array.isArray(labels) || typeof labels[input.outcome] !== 'string') {
          throw tradeError('settlement_invalid_outcomes', 409);
        }
        const url = publicResolutionEvidenceUrl(cfg);
        const content = [
          `Pronos · Propuesta de resolución · Arbitrum Sepolia · #${input.marketId}`,
          market.question, `Fábrica: ${market.factory_address} · Mercado: ${market.contract_id}`,
          `Reglas: ${market.resolution_review.rulesHash}`,
          `Resultado propuesto: ${labels[input.outcome]}`, `Motivo: ${input.reason}`,
          ...(url ? [`Fuente pública: ${url}`] : []),
          ...(typeof review?.evidence?.finalScore === 'string' && /^[\d: .–-]{1,40}$/.test(review.evidence.finalScore)
            ? [`Marcador: ${review.evidence.finalScore}`] : []),
        ].join('\n');
        evidenceHash = ethers.utils.id(content);
        await sql`INSERT INTO protocol_resolution_documents(hash, content) VALUES (${evidenceHash}, ${content})
          ON CONFLICT (hash) DO NOTHING`;
      }
      const gasLimit = input.action === 'cancel' || evidenceHash ? 350000 : 250000;
      const maxCostWei = BigInt(gasLimit) * BigInt(SETTLEMENT_LIMITS.maxFeePerGas);
      const budget = await sql`SELECT COALESCE(SUM((plan->>'maxCostWei')::numeric),0)::text AS used
        FROM sepolia_trade_requests WHERE chain_id=421614 AND wallet_address=${wallet}
          AND action LIKE 'admin_%' AND status <> 'rejected'
          AND (updated_at >= now()-interval '24 hours' OR status IN ('validated','pending','needs_reconciliation'))`;
      if (BigInt(budget[0].used) + maxCostWei > BigInt(SETTLEMENT_LIMITS.walletDailyWei)) throw tradeError('settlement_daily_budget_exceeded', 429);
      return { market, input, actor, gasLimit, evidenceHash, maxCostWei: String(maxCostWei),
        expectedSourceHash: review?.expectedSourceHash || null, evidence: review?.evidence || null };
    },
    validate: async plan => {
      const current = await loadSettlementMarket(sql, input.marketId, env);
      if (tradePayloadHash([current.factory_address, current.pool_address, current.contract_id, current.protocol_version, current.outcome_count])
        !== tradePayloadHash([plan.market.factory_address, plan.market.pool_address, plan.market.contract_id, plan.market.protocol_version, plan.market.outcome_count])) throw tradeError('settlement_market_mapping_changed', 409);
      if ((current.resolution_review?.rulesHash || null) !== (plan.market.resolution_review?.rulesHash || null)) {
        throw tradeError('settlement_source_changed', 409);
      }
      validateAction(current, input, env);
      await assertQueueReview(sql, current, input);
      if (plan.expectedSourceHash && settlementSourceHash(current) !== plan.expectedSourceHash) throw tradeError('settlement_source_changed', 409);
      if (Number((await provider.getNetwork()).chainId) !== 421614) throw tradeError('settlement_wrong_chain', 503);
      if (input.reviewHash || plan.evidenceHash) {
        const { payouts } = await previewResolutionPayouts({ market: current, provider, env, outcome: input.outcome, contractAt });
        if (BigInt(payouts[0].shortfallUnits) > 0n) throw tradeError('settlement_resolution_pool_shortfall', 409);
      }
      const m = plan.market;
      const factory = contractAt(m.factory_address, ['function collateral() view returns(address)',
        `function getMarket(uint256) view returns(address,string,string,uint256,string,${m.protocol_version === 'v2' ? 'uint8,' : ''}bool)`]);
      const [chainMarket, collateral, balance] = await Promise.all([factory.getMarket(m.contract_id), factory.collateral(), provider.getBalance(wallet)]);
      if (address(chainMarket[0]) !== address(m.pool_address) || address(collateral) !== address(env.ONCHAIN_COLLATERAL_ADDRESS)) throw tradeError('settlement_contract_binding_mismatch', 409);
      if (plan.evidenceHash) {
        try {
          await simulateContractCall(provider, { from: wallet, to: m.factory_address, data: proposalData(plan) },
            proposalInterface, 'proposeResolution');
        } catch { throw tradeError('settlement_proposal_simulation_failed', 409); }
      }
      if (balance.lt(ethers.BigNumber.from(plan.maxCostWei).add(SETTLEMENT_LIMITS.reserveWei))) throw tradeError('settlement_signer_reserve_low', 503);
    },
    feeQuote: async (p, chain) => {
      const fees = await onchainFeeData(p, chain);
      if (!fees.maxFeePerGas || fees.maxFeePerGas.lte(0) || fees.maxFeePerGas.gt(SETTLEMENT_LIMITS.maxFeePerGas)
        || !fees.maxPriorityFeePerGas || fees.maxPriorityFeePerGas.gt(fees.maxFeePerGas)) throw tradeError('settlement_fee_ceiling_exceeded', 503);
      return fees;
    },
    execute: async (plan, execution) => {
      const m = plan.market;
      const checked = { ...execution, send: async call => {
        const receipt = await execution.send(call);
        assertSettlementReceipt(m, input, receipt, plan.evidenceHash);
        return receipt;
      } };
      if (plan.evidenceHash) {
        const receipt = execution.receipt || await execution.send({ step: 'trade', suborgId: suborg, from: wallet,
          to: m.factory_address, data: proposalData(plan), gasLimit: plan.gasLimit });
        const { proposalId } = assertSettlementReceipt(m, input, receipt, plan.evidenceHash);
        return { ok: true, marketId: Number(m.points_id), protocolMarketId: Number(m.protocol_id), action: input.action,
          outcome: input.outcome, txHash: receipt.transactionHash, blockNumber: receipt.blockNumber, chainId: 421614,
          proposalId, indexingStatus: 'pending', refundsPaid: false };
      }
      if (execution.receipt) assertSettlementReceipt(m, input, execution.receipt);
      const args = { factoryAddress: m.factory_address, factoryVariant: m.protocol_version,
        marketId: m.contract_id, outcome: input.outcome, execution: checked };
      const result = input.action === 'resolve'
        ? await dispatch.resolveMarketOnChain({ ...args, resolverSuborgId: suborg, resolverAddr: wallet })
        : await dispatch.lifecycleMarketOnChain({ ...args, ownerSuborgId: suborg, ownerAddr: wallet, action: input.action });
      return { ok: true, marketId: Number(m.points_id), protocolMarketId: Number(m.protocol_id), action: input.action,
        outcome: input.outcome, txHash: result.txHash, blockNumber: result.blockNumber, chainId: 421614,
        indexingStatus: 'pending', refundsPaid: false };
    },
  });
}

function proposalData({ market, input, evidenceHash }) {
  return proposalInterface.encodeFunctionData('proposeResolution', [market.contract_id,
    input.outcome + (market.protocol_version === 'v1' ? 1 : 0), evidenceHash]);
}

export function publicResolutionEvidenceUrl(cfg) {
  if (cfg.source === 'espn' && /^\d+$/.test(String(cfg.eventId))
    && /^[a-z-]+\/[a-z0-9.-]+$/i.test(cfg.leaguePath || '')) {
    return `https://site.api.espn.com/apis/site/v2/sports/${cfg.leaguePath}/summary?event=${cfg.eventId}`;
  }
  // Resolver request URLs can contain private provider tokens. Only surface
  // URLs explicitly identified in the market config as public evidence.
  try {
    const url = new URL(cfg.evidenceUrl || cfg.publicSourceUrl);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* No public source link. */ }
  return null;
}
