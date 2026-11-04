import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { usePointsExecution } from '../lib/PointsExecution.jsx';
import { getJson } from '../lib/pointsApi.js';

const labels = { ok: 'No exceptions detected', warning: 'Review needed', critical: 'Action needed', unavailable: 'Evidence unavailable' };
const short = text => text ? `${text.slice(0, 8)}…${text.slice(-6)}` : '—';
const box = { border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 18, background: 'var(--surface1)', overflowWrap: 'anywhere' };

export function OperationsPresentation({ report, error, loading, refresh }) {
  const { trades, indexer, gas } = report?.sections || {};
  return <section style={box} aria-label="Onchain operations">
    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Onchain operations · Arbitrum Sepolia</h2>
      <button type="button" onClick={refresh} disabled={loading}>{loading ? 'Checking…' : 'Refresh snapshot'}</button>
    </div>
    <p>Read-only snapshot. Recovery and funding require separate actions.</p>
    {loading && <p role="status">Reading operational evidence…</p>}
    {error && <p role="alert">Operational evidence could not be loaded. Refresh to try again.</p>}
    {report && <>
      <p><strong>{labels[report.status] || 'Evidence unavailable'}</strong> · Snapshot: <time dateTime={report.observedAt}>{report.observedAt}</time></p>
      <ul>
        <li>Trades: {labels[trades.status]}{trades.requests && ` · ${trades.requests.length}${trades.truncated ? '+' : ''} exceptions shown`}</li>
        <li>Indexer: {labels[indexer.status]}{indexer.headBlock != null && ` · chain head ${indexer.headBlock}`}</li>
        <li>Gas funding: {labels[gas.status]}{gas.balanceEth != null && ` · reserve wallet ${gas.balanceEth} ETH`}</li>
      </ul>
      {gas.dailyBudgetUsedEth != null && <p>24-hour budget reserved at maximum cost: {gas.dailyBudgetUsedEth} / {gas.globalDailyEth} ETH. This is a budget ceiling calculation, not actual gas spent.</p>}
      {gas.pendingTransfers != null && <p>Pending gas transfers: {gas.pendingTransfers} · Minimum funder reserve: {gas.reserveEth} ETH</p>}
      {gas.enabled && <p>Funding checks: configuration {gas.configured ? 'ready' : 'incomplete'} · ledger {gas.schemaReady ? 'accessible' : 'unavailable'} · prior signer transfer {gas.signerVerified ? 'verified' : 'unverified'}</p>}
      {indexer.factories?.map(f => <p key={f.version}>{f.version.toUpperCase()} · {short(f.address)} · checkpoint {f.lastBlock ?? 'unavailable'} · lag {f.lagBlocks ?? 'unavailable'} blocks</p>)}
      {report.issues.length > 0 && <ul aria-label="Operational exceptions">{report.issues.map(i => <li key={i.id}>
        <strong>{i.message}</strong> <span>{i.nextAction}</span>
      </li>)}</ul>}
      {trades.requests?.length > 0 && <div style={{ overflowX: 'auto' }}><table>
        <caption>Trade exceptions · operator reference IDs</caption>
        <thead><tr><th scope="col">Request</th><th scope="col">Wallet</th><th scope="col">Action / state</th><th scope="col">Nonce / step</th><th scope="col">Transaction</th></tr></thead>
        <tbody>{trades.requests.map(r => <tr key={r.id}>
          <td>{r.id}</td><td title={r.wallet}>{short(r.wallet)}</td><td>{r.action} / {r.reason}</td>
          <td>{r.nonce ?? '—'} / {r.step || '—'}</td><td>{r.txHash ? <a href={`https://sepolia.arbiscan.io/tx/${r.txHash}`} target="_blank" rel="noreferrer">{short(r.txHash)}</a> : 'Not broadcast'}</td>
        </tr>)}</tbody>
      </table></div>}
    </>}
  </section>;
}

export default function AdminOnchainOperations({ isAdmin }) {
  const { authenticated, user } = usePointsAuth();
  const execution = usePointsExecution();
  const owner = authenticated && isAdmin && execution.enabled && execution.durableTrades
    ? `${user?.suborgId || ''}:${user?.username || ''}` : null;
  const [state, setState] = useState({ owner: null, report: null, error: false, loading: true });
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!owner) return;
    const current = ++sequence.current;
    // Clear the previous snapshot on refresh/failure; never leave stale green
    // evidence visible beside a request error or after an account change.
    setState({ owner, report: null, error: false, loading: true });
    try {
      const report = await getJson('/api/points/admin/onchain-operations');
      if (current === sequence.current) setState({ owner, report, error: false, loading: false });
    } catch {
      if (current === sequence.current) setState({ owner, report: null, error: true, loading: false });
    }
  }, [owner]);
  useEffect(() => { refresh(); return () => { sequence.current++; }; }, [refresh]);
  if (!owner) return null;
  const visible = state.owner === owner ? state : { report: null, error: false, loading: true };
  return <OperationsPresentation {...visible} refresh={refresh} />;
}
