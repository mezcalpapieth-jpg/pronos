import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import { onchainOperationsSettings } from './onchain-operations.js';

const PAGE_SIZE = 25;
const badQuery = () => Object.assign(new Error('invalid_transaction_filters'), { status: 400 });
const fingerprint = filters => createHash('sha256').update(JSON.stringify(filters)).digest('hex');
const validTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,6}Z$/.test(value) && Number.isFinite(Date.parse(value));

export function transactionFilters(query = {}, now = Date.now()) {
  const allowed = ['username', 'wallet', 'market', 'action', 'status', 'from', 'to', 'tx', 'cursor'];
  if (Object.keys(query).some(key => !allowed.includes(key) || typeof query[key] !== 'string'
    || /[\x00-\x1f]/.test(query[key]) || query[key].length > (key === 'cursor' ? 2048 : 120))) throw badQuery();
  const filters = { username: (query.username || '').trim().replace(/^@/, '').toLowerCase(),
    wallet: (query.wallet || '').trim().toLowerCase(), market: (query.market || '').trim(),
    action: query.action || 'all', status: query.status || 'all', from: query.from || '', to: query.to || '', tx: (query.tx || '').trim().toLowerCase() };
  if (filters.username.length > 64 || /[\x00-\x1f]/.test(filters.username)
    || (filters.wallet && (!ethers.utils.isAddress(filters.wallet) || filters.wallet === ethers.constants.AddressZero))
    || (filters.tx && !/^0x[0-9a-f]{64}$/.test(filters.tx))
    || !['all','buy','sell','redeem','gas_topup'].includes(filters.action)
    || !['all','pending','confirmed','failed','needs_reconciliation','awaiting_indexing','indexed'].includes(filters.status)) throw badQuery();
  for (const date of [filters.from, filters.to].filter(Boolean)) {
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || date.slice(0,4)==='0000' || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw badQuery();
  }
  if (filters.from && filters.to && filters.from > filters.to) throw badQuery();
  let cursor = null, asOf = new Date(now).toISOString();
  if (query.cursor) {
    try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); } catch { throw badQuery(); }
    if (!cursor || cursor.v !== 1 || cursor.filter !== fingerprint(filters) || !validTime(cursor.asOf) || !validTime(cursor.at)
      || Date.parse(cursor.asOf) > now || now - Date.parse(cursor.asOf) > 15 * 60 * 1000
      || Date.parse(cursor.at) > Date.parse(cursor.asOf) || typeof cursor.id !== 'string'
      || !/^(request:[0-9a-f-]{36}|trade:\d+|redemption:\d+|gas:0x[0-9a-f]{64})$/.test(cursor.id)) throw badQuery();
    asOf = cursor.asOf;
  }
  return { filters, cursor, asOf };
}

function wei(value) {
  if (value && typeof value === 'object') value = value.hex;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;
  const str = String(value);
  if (str.length > 100 || !/^(\d+|0x[0-9a-f]+)$/i.test(str)) return null;
  return BigInt(str);
}
function publicStep(step) {
  const used = wei(step.gasUsed), price = wei(step.effectiveGasPrice);
  return { step: step.step, nonce: step.nonce, status: step.status, txHash: step.txHash,
    blockNumber: Number.isSafeInteger(step.blockNumber) && step.blockNumber>=0 ? step.blockNumber : null,
    receiptFeeEth: used !== null && price !== null ? ethers.utils.formatEther((used * price).toString()) : null };
}

// All activity here is application-ledger or indexed protocol evidence, not
// an explorer of arbitrary wallet transfers. No RPC, signing or schema writes.
export async function collectOnchainTransactions({ sql, query = {}, env = process.env, now = Date.now() }) {
  if (!onchainOperationsSettings(env).configured) throw new Error('onchain_transactions_unavailable');
  const { filters: f, cursor, asOf } = transactionFilters(query, now);
  const marketPattern = `%${f.market.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await sql`WITH events AS (
    SELECT 'trade:' || t.id AS id, t.created_at AS occurred_at, LOWER(t.trader) AS wallet,
      t.side AS action, m.id AS market_id, m.question, LOWER(m.pool_address) AS pool,
      COALESCE(t.outcome_index, CASE WHEN t.is_yes THEN 0 WHEN NOT t.is_yes THEN 1 END) AS outcome_index,
      t.collateral_amt::text AS collateral, t.shares_amt::text AS shares, t.fee_amt::text AS fee, t.tx_hash
    FROM trades t JOIN protocol_markets m ON m.id = t.market_id WHERE m.chain_id = 421614
    UNION ALL
    SELECT 'redemption:' || d.id, d.created_at, LOWER(d.user_address), 'redeem', m.id, m.question,
      LOWER(m.pool_address), d.outcome_index, d.payout::text, d.shares::text, NULL::text, d.tx_hash
    FROM redemptions d JOIN protocol_markets m ON m.id = d.market_id WHERE m.chain_id = 421614
  ), history AS (
    SELECT 'request:' || r.id AS id, 'request' AS source, r.created_at AS occurred_at, r.wallet_address AS wallet, r.action,
      CASE WHEN r.status = 'needs_reconciliation' OR EXISTS (SELECT 1 FROM sepolia_trade_transactions x WHERE x.request_id=r.id AND x.status='needs_reconciliation') THEN 'needs_reconciliation'
        WHEN r.status IN ('rejected','reverted') THEN 'failed' WHEN r.status='confirmed' THEN 'confirmed' ELSE 'pending' END AS status,
      r.status AS request_state, m.id AS market_id, m.question, LOWER(m.pool_address) AS pool,
      COALESCE(r.payload->>'outcomeIndex',e.outcome_index::text) AS outcome_index,
      CASE r.action WHEN 'buy' THEN r.payload->>'collateral' WHEN 'sell' THEN r.payload->>'shares' ELSE r.payload->>'amount' END AS requested_amount,
      CASE WHEN r.action='buy' THEN 'MXNP' ELSE 'shares' END AS requested_unit,
      e.collateral, e.shares, e.fee, tx.tx_hash, e.id IS NOT NULL AS indexed,
      COALESCE(steps.items, '[]'::jsonb) AS steps, NULL::text AS funder, NULL::text AS budget_max_cost_wei
    FROM sepolia_trade_requests r
    LEFT JOIN LATERAL (SELECT pm.id, pm.question, pm.pool_address FROM protocol_markets pm
      WHERE pm.chain_id=421614 AND (LOWER(pm.pool_address)=LOWER(r.plan->'market'->>'chain_address')
        OR (r.plan->'market'->>'chain_address' IS NULL AND pm.id::text=r.payload->>'marketId')) ORDER BY pm.id LIMIT 1) m ON true
    LEFT JOIN sepolia_trade_transactions tx ON tx.request_id=r.id AND tx.step='trade'
    LEFT JOIN LATERAL (SELECT ev.id, ev.collateral, ev.shares, ev.fee, ev.outcome_index FROM events ev
      WHERE ev.tx_hash=tx.tx_hash AND ev.wallet=r.wallet_address AND ev.action=r.action AND ev.market_id=m.id
      ORDER BY ev.id LIMIT 1) e ON true
    LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('step', x.step, 'nonce', x.nonce::text, 'status', x.status,
      'txHash', x.tx_hash, 'blockNumber', x.receipt->'blockNumber', 'gasUsed', x.receipt->'gasUsed',
      'effectiveGasPrice', x.receipt->'effectiveGasPrice') ORDER BY x.nonce) AS items
      FROM sepolia_trade_transactions x WHERE x.request_id=r.id) steps ON true
    WHERE r.chain_id=421614 AND r.action IN ('buy','sell','redeem')
    UNION ALL
    SELECT e.id, 'indexed', e.occurred_at, e.wallet, e.action, 'confirmed', NULL, e.market_id, e.question, e.pool,
      e.outcome_index::text, NULL, NULL, e.collateral, e.shares, e.fee, e.tx_hash, true, '[]'::jsonb, NULL, NULL
    FROM events e WHERE NOT EXISTS (SELECT 1 FROM sepolia_trade_requests r JOIN sepolia_trade_transactions tx ON tx.request_id=r.id AND tx.step='trade'
      WHERE r.chain_id=421614 AND tx.tx_hash=e.tx_hash AND r.wallet_address=e.wallet AND r.action=e.action
        AND (LOWER(r.plan->'market'->>'chain_address')=e.pool
          OR (r.plan->'market'->>'chain_address' IS NULL AND r.payload->>'marketId'=e.market_id::text)))
    UNION ALL
    SELECT 'gas:' || g.tx_hash, 'gas', g.created_at, g.wallet_address, 'gas_topup',
      CASE g.status WHEN 'confirmed' THEN 'confirmed' WHEN 'reverted' THEN 'failed' ELSE 'pending' END, g.status,
      NULL, NULL, NULL, NULL, g.amount_wei::text, 'wei', NULL, NULL, NULL, g.tx_hash, NULL::boolean,
      jsonb_build_array(jsonb_build_object('step','gas_transfer','nonce',g.nonce::text,'status',g.status,'txHash',g.tx_hash)),
      g.funder_address, g.max_cost_wei::text FROM sepolia_gas_transfers g WHERE g.chain_id=421614
  ) SELECT h.id, h.source, to_char(h.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
    h.wallet, u.username, h.action, h.status, h.request_state, h.market_id, h.question, h.pool, h.outcome_index,
    h.requested_amount, h.requested_unit, h.collateral, h.shares, h.fee, h.tx_hash, h.indexed, h.steps, h.funder, h.budget_max_cost_wei
  FROM history h LEFT JOIN LATERAL (SELECT username FROM points_users WHERE LOWER(wallet_address)=h.wallet ORDER BY id LIMIT 1) u ON true
  WHERE h.occurred_at <= ${asOf}::timestamptz
    AND (${f.username}='' OR LOWER(u.username)=${f.username}) AND (${f.wallet}='' OR h.wallet=${f.wallet})
    AND (${f.market}='' OR h.market_id::text=${f.market} OR h.question ILIKE ${marketPattern})
    AND (${f.action}='all' OR h.action=${f.action})
    AND (${f.status}='all' OR h.status=${f.status}
      OR (${f.status}='awaiting_indexing' AND h.status='confirmed' AND h.indexed=false)
      OR (${f.status}='indexed' AND h.indexed=true))
    AND (${f.from}='' OR h.occurred_at >= (NULLIF(${f.from},'')::date::timestamp AT TIME ZONE 'UTC'))
    AND (${f.to}='' OR h.occurred_at < ((NULLIF(${f.to},'')::date + 1)::timestamp AT TIME ZONE 'UTC'))
    AND (${f.tx}='' OR LOWER(h.tx_hash)=${f.tx} OR EXISTS (SELECT 1 FROM jsonb_array_elements(h.steps) st WHERE LOWER(st->>'txHash')=${f.tx}))
    AND (${cursor?.at ?? null}::timestamptz IS NULL OR (h.occurred_at,h.id) < (${cursor?.at ?? null}::timestamptz,${cursor?.id ?? null}::text))
  ORDER BY h.occurred_at DESC,h.id DESC LIMIT 26`;
  const selected = rows.slice(0,PAGE_SIZE);
  const items = selected.map(r => {
    const steps = r.steps.map(publicStep);
    const broadcast = steps.filter(s => s.txHash);
    const receiptFeeEth = broadcast.length && broadcast.every(s => s.receiptFeeEth !== null)
      ? ethers.utils.formatEther(broadcast.reduce((sum,s) => sum + BigInt(ethers.utils.parseEther(s.receiptFeeEth).toString()),0n).toString()) : null;
    return { id: r.id, source: r.source, occurredAt: r.occurred_at, wallet: r.wallet, username: r.username,
      action: r.action, status: r.status, requestState: r.request_state,
      market: r.market_id == null ? null : { id: r.market_id, question: r.question, pool: r.pool }, outcomeIndex: r.outcome_index,
      requested: r.requested_amount == null ? null : { amount: r.requested_unit==='wei' ? ethers.utils.formatEther(r.requested_amount) : r.requested_amount, unit: r.requested_unit==='wei' ? 'ETH' : r.requested_unit },
      executed: r.indexed ? { collateral: r.collateral, shares: r.shares, fee: r.fee } : null,
      txHash: r.tx_hash, indexed: r.indexed, steps, receiptFeeEth, funder: r.funder,
      budgetMaxCostEth: r.budget_max_cost_wei == null ? null : ethers.utils.formatEther(r.budget_max_cost_wei),
    };
  });
  const last = selected.at(-1);
  const nextCursor = rows.length > PAGE_SIZE && last ? Buffer.from(JSON.stringify({ v:1, asOf, filter:fingerprint(f), at:last.occurred_at, id:last.id })).toString('base64url') : null;
  return { chainId:421614, readOnly:true, asOf, filters:f, items, nextCursor };
}
