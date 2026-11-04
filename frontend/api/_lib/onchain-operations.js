import { ethers } from 'ethers';
import { pendingApprovalSettings } from './onchain-preview-approval.js';
import { isSepoliaGasDatabase } from './sepolia-gas-config.js';
import { probeGasFunding } from './sepolia-gas-readiness.js';

export const OPERATIONS_THRESHOLDS = Object.freeze({
  tradeWaitSeconds: 300, indexingWaitSeconds: 120, workerWaitSeconds: 600,
  factoryWaitSeconds: 600, factoryLagBlocks: 2400, requestLimit: 50,
});

export function onchainOperationsSettings(env = process.env) {
  const enabled = pendingApprovalSettings(env).previewEnabled
    && env.ONCHAIN_DURABLE_TRADES_ENABLED === 'true';
  let databaseReady = false;
  try { databaseReady = isSepoliaGasDatabase(env.DATABASE_URL) && new URL(env.DATABASE_URL).pathname === '/neondb'; } catch { /* default off */ }
  return { enabled, configured: Boolean(enabled && databaseReady && env.ONCHAIN_RPC_URL) };
}

const age = (date, now) => {
  const timestamp = date == null ? NaN : new Date(date).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((now - timestamp) / 1000)) : Infinity;
};
const severity = issues => issues.some(i => i.severity === 'critical') ? 'critical'
  : issues.length ? 'warning' : 'ok';
const issue = (id, source, level, message, nextAction) => ({ id, source, severity: level, message, nextAction });

async function readWithDeadline(read, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('evidence_timeout')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function readTradeExceptions(sql) {
  // Select safe metadata only. Signed bytes, plans, sessions and payloads are
  // bearer capabilities or private input and must never enter this result.
  const rows = await sql`SELECT r.id, r.wallet_address, r.action, r.status, r.created_at, r.updated_at,
      t.step, t.nonce::text AS nonce, t.tx_hash,
      (r.status = 'needs_reconciliation' OR EXISTS (SELECT 1 FROM sepolia_trade_transactions x
        WHERE x.request_id = r.id AND x.status = 'needs_reconciliation')) AS reconcile
    FROM sepolia_trade_requests r
    LEFT JOIN LATERAL (SELECT step, nonce, tx_hash FROM sepolia_trade_transactions
      WHERE request_id = r.id ORDER BY nonce DESC LIMIT 1) t ON true
    WHERE r.chain_id = 421614 AND r.action IN ('buy','sell','redeem') AND (
      r.status = 'needs_reconciliation'
      OR EXISTS (SELECT 1 FROM sepolia_trade_transactions x
        WHERE x.request_id = r.id AND x.status = 'needs_reconciliation')
      OR (r.status IN ('created', 'validated', 'pending')
        AND r.created_at <= now() - ${OPERATIONS_THRESHOLDS.tradeWaitSeconds} * interval '1 second')
      OR (r.status = 'confirmed' AND r.updated_at <= now() - ${OPERATIONS_THRESHOLDS.indexingWaitSeconds} * interval '1 second'
        AND NOT EXISTS (SELECT 1 FROM sepolia_trade_transactions tx
          JOIN protocol_markets m ON m.chain_id = 421614
            AND LOWER(m.pool_address) = LOWER(r.plan->'market'->>'chain_address')
          WHERE tx.request_id = r.id AND tx.step = 'trade' AND tx.status = 'confirmed' AND (
            (r.action = 'redeem' AND EXISTS (SELECT 1 FROM redemptions d
              WHERE d.market_id = m.id AND d.tx_hash = tx.tx_hash AND LOWER(d.user_address) = r.wallet_address))
            OR (r.action IN ('buy','sell') AND EXISTS (SELECT 1 FROM trades e
              WHERE e.market_id = m.id AND e.tx_hash = tx.tx_hash
                AND LOWER(e.trader) = r.wallet_address AND e.side = r.action)))))
    ) ORDER BY reconcile DESC, r.created_at, r.id LIMIT 51`;
  const requests = rows.slice(0, OPERATIONS_THRESHOLDS.requestLimit).map(r => ({
    id: r.id, wallet: r.wallet_address, action: r.action, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at, step: r.step,
    nonce: r.nonce, txHash: r.tx_hash,
    reason: r.reconcile ? 'needs_reconciliation' : r.status === 'confirmed' ? 'awaiting_indexing' : 'trade_wait',
  }));
  const issues = requests.map(r => issue(`trade:${r.id}`, 'trades', r.reason === 'needs_reconciliation' ? 'critical' : 'warning',
    `${r.action}: ${r.reason}`,
    r.reason === 'awaiting_indexing' ? 'Check the indexer and receipt; do not repeat a confirmed trade.'
      : r.reason === 'needs_reconciliation' ? 'Inspect the saved transaction receipt and wallet nonce before any recovery. Do not create a replacement request.'
        : 'Resume through the original owner flow with the same saved request key; never create a second trade to clear a pending one.'));
  const truncated = rows.length > OPERATIONS_THRESHOLDS.requestLimit;
  if (truncated) issues.push(issue('trades:truncated', 'trades', 'warning', 'Exception list is incomplete (first 50).',
    'Review the private ledger with an operator; this snapshot is not a complete queue.'));
  return { status: severity(issues), requests, truncated, issues };
}

async function readIndexer({ sql, provider, env, now, chainReady }) {
  const [states, runs] = await Promise.all([
    sql`SELECT factory_address, last_block::text AS last_block, updated_at FROM indexer_factory_state WHERE chain_id = 421614`,
    sql`SELECT status, started_at, completed_at FROM preview_indexer_runs ORDER BY started_at DESC, id DESC LIMIT 1`,
  ]);
  const head = chainReady ? await provider.getBlockNumber() : null;
  const issues = [];
  const factories = ['ONCHAIN_MARKET_FACTORY_ADDRESS', 'ONCHAIN_MARKET_FACTORY_V2_ADDRESS'].map((key, i) => {
    const raw = env[key];
    const address = ethers.utils.isAddress(raw || '') && raw.toLowerCase() !== ethers.constants.AddressZero ? raw.toLowerCase() : null;
    const state = address && states.find(s => s.factory_address.toLowerCase() === address);
    const lag = state && head !== null ? head - Number(state.last_block) : null;
    if (!address || !state) issues.push(issue(`indexer:factory:${i + 1}`, 'indexer', 'critical', `V${i + 1} factory coverage is missing.`, 'Check the configured factory and dedicated preview indexer checkpoints.'));
    else if (age(state.updated_at, now) > OPERATIONS_THRESHOLDS.factoryWaitSeconds || lag === null || lag < 0 || lag > OPERATIONS_THRESHOLDS.factoryLagBlocks) {
      issues.push(issue(`indexer:factory:${i + 1}`, 'indexer', 'warning', `V${i + 1} factory checkpoint is delayed or cannot be verified.`, 'Inspect dedicated indexer runs and RPC health before trusting indexed balances or standings.'));
    }
    return { version: `v${i + 1}`, address, lastBlock: state?.last_block ?? null, updatedAt: state?.updated_at ?? null, lagBlocks: lag };
  });
  if (factories[0].address && factories[0].address === factories[1].address) issues.push(issue('indexer:duplicate_factory', 'indexer', 'critical', 'V1 and V2 point to the same factory.', 'Correct the preview factory configuration.'));
  const latest = runs[0] || null;
  if (!latest || latest.status === 'error' || age(latest.started_at, now) > OPERATIONS_THRESHOLDS.workerWaitSeconds) {
    issues.push(issue('indexer:worker', 'indexer', 'critical', 'Dedicated indexer has no recent successful or in-progress run.', 'Inspect worker authentication, schedule and logs; do not invoke funding or trade execution to repair indexing.'));
  }
  return { status: severity(issues), headBlock: head, factories, latestRun: latest, issues };
}

async function readGas({ sql, provider, env, chainReady }) {
  if (!chainReady) throw new Error('rpc_unavailable');
  const readiness = await probeGasFunding({ sql, provider, env });
  if (readiness.error) throw new Error('gas_probe_unavailable');
  const issues = readiness.ready ? [] : [issue('gas:readiness', 'gas', readiness.enabled ? 'critical' : 'warning',
    readiness.enabled ? 'Automatic gas funding is not ready.' : 'Automatic gas funding is disabled.',
    'Review configuration, pending transfers, reserve and the 24-hour budget. Funding changes require a separate action.')];
  return { status: severity(issues), ...readiness, issues };
}

// This adapter reads existing Sepolia infrastructure. It has no signer import,
// no transaction submission, no retry side effects and no tournament dependency.
export async function collectOnchainOperations({ sql, provider, env = process.env, now = Date.now(), readTimeoutMs = 5000 }) {
  const settings = onchainOperationsSettings(env);
  if (!settings.configured) throw new Error('onchain_operations_unavailable');
  let chainReady = false;
  try { chainReady = Number((await readWithDeadline(() => provider.getNetwork(), readTimeoutMs)).chainId) === 421614; } catch { /* report missing evidence */ }
  const issues = chainReady ? [] : [issue('rpc:chain', 'rpc', 'critical', 'Arbitrum Sepolia RPC cannot be verified.', 'Check the preview RPC chain; this report cannot establish live chain health.')];
  const results = await Promise.allSettled([
    readWithDeadline(() => readTradeExceptions(sql), readTimeoutMs),
    readWithDeadline(() => readIndexer({ sql, provider, env, now, chainReady }), readTimeoutMs),
    readWithDeadline(() => readGas({ sql, provider, env, chainReady }), readTimeoutMs),
  ]);
  const sections = {};
  ['trades', 'indexer', 'gas'].forEach((name, i) => {
    if (results[i].status === 'fulfilled') sections[name] = results[i].value;
    else sections[name] = { status: 'unavailable', issues: [issue(`${name}:unavailable`, name, 'critical',
      `${name} evidence is unavailable.`, 'Check the preview schema, application permissions and provider logs; refresh after recovery.')] };
    issues.push(...sections[name].issues);
  });
  return { schemaVersion: 1, chainId: 421614, readOnly: true, observedAt: new Date(now).toISOString(),
    status: severity(issues), thresholds: OPERATIONS_THRESHOLDS, sections, issues };
}
