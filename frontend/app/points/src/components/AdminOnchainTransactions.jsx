import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { usePointsExecution } from '../lib/PointsExecution.jsx';
import { getJson } from '../lib/pointsApi.js';

const emptyFilters={ username:'',wallet:'',market:'',tx:'',action:'all',status:'all',from:'',to:'' };
const labels={ pending:'Pending',confirmed:'Confirmed',failed:'Failed',needs_reconciliation:'Needs reconciliation' };
const short=value=>value ? `${value.slice(0,8)}…${value.slice(-6)}` : '—';
const style={ border:'1px solid var(--border)',borderRadius:12,padding:20,marginBottom:18,background:'var(--surface1)',overflowWrap:'anywhere' };
const txLink=hash=>hash ? <a href={`https://sepolia.arbiscan.io/tx/${hash}`} target="_blank" rel="noreferrer" title={hash}>{short(hash)}</a> : 'Not broadcast';

export function TransactionsPresentation({ filters,change,submit,report,loading,error,refresh,next,previous,canPrevious }) {
  return <section style={style} aria-label="Onchain transactions">
    <h2>Transactions · Arbitrum Sepolia</h2>
    <p>Trading requests, indexed trades/redemptions and automatic gas top-ups. Dates use UTC. External wallet transfers and other admin contract actions are outside this history.</p>
    <form onSubmit={submit} style={{ display:'flex',gap:12,flexWrap:'wrap',alignItems:'end' }}>
      {['username','wallet','market','tx','from','to'].map(name=><label key={name}>
        <span style={{ display:'block' }}>{({ username:'Username',wallet:'Wallet address',market:'Market ID or question',tx:'Transaction hash',from:'From (UTC)',to:'Through (UTC)' })[name]}</span>
        <input type={name==='from'||name==='to' ? 'date' : 'text'} name={name} value={filters[name]} maxLength={name==='username' ? 64 : 120} onChange={e=>change(name,e.target.value)} />
      </label>)}
      <label>Action <select name="action" value={filters.action} onChange={e=>change('action',e.target.value)}>
        {['all','buy','sell','redeem','gas_topup'].map(v=><option key={v} value={v}>{v==='gas_topup' ? 'Gas top-up' : v}</option>)}
      </select></label>
      <label>Status <select name="status" value={filters.status} onChange={e=>change('status',e.target.value)}>
        {['all','pending','confirmed','failed','needs_reconciliation','awaiting_indexing','indexed'].map(v=><option key={v} value={v}>{({ all:'All',awaiting_indexing:'Confirmed, awaiting indexing',indexed:'Indexed' })[v] || labels[v]}</option>)}
      </select></label>
      <button type="submit" disabled={loading}>Search</button>
      <button type="button" onClick={refresh} disabled={loading}>Refresh history</button>
    </form>
    {loading && <p role="status">Loading transaction history…</p>}
    {error && <p role="alert">{error==='invalid_transaction_filters' ? 'Check the filters or refresh to start a new history snapshot.' : 'Transaction history is unavailable. Refresh to try again.'}</p>}
    {report && <>
      <p>Snapshot started: <time dateTime={report.asOf}>{report.asOf}</time>. Statuses may update between pages.</p>
      {!report.items.length && <p>No activity matches these filters.</p>}
      {!!report.items.length && <div style={{ overflowX:'auto' }}><table>
        <caption>Read-only transaction history</caption>
        <thead><tr>{['Recorded at (UTC)','Account','Market / action','Execution / indexing','Amounts','Trading fee','Recorded receipt fee','Details'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{report.items.map(row=><tr key={row.id}>
          <td><time dateTime={row.occurredAt}>{row.occurredAt}</time></td>
          <td>{row.username ? `@${row.username}` : 'Unlinked wallet'}<br/><a href={`https://sepolia.arbiscan.io/address/${row.wallet}`} target="_blank" rel="noreferrer" title={row.wallet}>{short(row.wallet)}</a></td>
          <td>{row.action==='gas_topup' ? 'Gas top-up' : row.action}<br/>{row.market ? <span>#{row.market.id} · {row.market.question}</span> : row.action==='gas_topup' ? 'Automatic funding' : 'Market unavailable'}
            {row.outcomeIndex!=null && <span> · outcome {row.outcomeIndex}</span>}</td>
          <td>{labels[row.status] || row.status}<br/>{row.indexed===true ? 'Indexed' : row.indexed===false ? (row.status==='confirmed' ? 'Awaiting indexing' : 'Not indexed') : 'Indexing not applicable'}</td>
          <td>{row.requested && <div>{row.action==='gas_topup' && row.status==='confirmed' ? 'Confirmed top-up' : 'Requested'}: {row.requested.amount} {row.requested.unit}</div>}
            {row.executed ? <div>{row.action==='buy' ? 'Paid' : 'Received'}: {row.executed.collateral} MXNP<br/>Shares: {row.executed.shares}</div>
              : row.action!=='gas_topup' && <div>Executed amount unavailable</div>}</td>
          <td>{row.executed?.fee!=null ? `${row.executed.fee} MXNP` : 'Unavailable'}</td>
          <td>{row.receiptFeeEth!=null ? `${row.receiptFeeEth} ETH` : 'Unavailable'}</td>
          <td><details><summary>Transaction details</summary>
            <p>Reference: {row.id}<br/>Source: {row.source}<br/>Stored state: {row.requestState || 'Indexed event'}</p>
            <p>Economic transaction: {txLink(row.txHash)}</p>
            {row.steps.map((step,i)=><p key={`${step.step}:${i}`}>{step.step} · {step.status} · nonce {step.nonce}<br/>{txLink(step.txHash)}<br/>
              {step.receiptFeeEth!=null && `Receipt fee: ${step.receiptFeeEth} ETH`}</p>)}
            {row.funder && <p>Gas funder: {row.funder}</p>}
            {row.budgetMaxCostEth!=null && <p>Maximum budget reservation: {row.budgetMaxCostEth} ETH. This is not gas spent.</p>}
          </details></td>
        </tr>)}</tbody>
      </table></div>}
      <p>Recorded receipt fees use stored gas used × effective gas price, including available approval steps. Missing receipts show “Unavailable”. Gas top-up amounts and budget reservations are separate from transaction fees.</p>
      <div style={{ display:'flex',gap:12 }}><button type="button" onClick={previous} disabled={loading||!canPrevious}>Previous page</button>
        <button type="button" onClick={next} disabled={loading||!report.nextCursor}>Next page</button></div>
    </>}
  </section>;
}

export default function AdminOnchainTransactions({ isAdmin }) {
  const { authenticated,user }=usePointsAuth();
  const execution=usePointsExecution();
  const owner=authenticated&&isAdmin&&execution.enabled&&execution.durableTrades ? `${user?.suborgId||''}:${user?.username||''}` : null;
  if (!owner) return null;
  // Remount the whole history, including filters and page cursors, on account
  // changes. Pending responses from the old session cannot populate this view.
  return <TransactionHistory key={owner} />;
}

function TransactionHistory() {
  const [draft,setDraft]=useState(emptyFilters);
  const [search,setSearch]=useState({ filters:emptyFilters,cursors:[null],revision:0 });
  const [state,setState]=useState({ report:null,error:null,loading:true,search:null });
  const sequence=useRef(0);
  const load=useCallback(async()=>{
    const current=++sequence.current;
    setState({ report:null,error:null,loading:true,search });
    const query=new URLSearchParams(Object.entries(search.filters).filter(([,v])=>v&&v!=='all'));
    if (search.cursors.at(-1)) query.set('cursor',search.cursors.at(-1));
    try {
      const report=await getJson(`/api/points/admin/onchain-transactions${query.size ? `?${query}` : ''}`);
      if (current===sequence.current) setState({ report,error:null,loading:false,search });
    } catch(error) {
      if (current===sequence.current) setState({ report:null,error:error.code||'unavailable',loading:false,search });
    }
  },[search]);
  useEffect(()=>{ load();return()=>{ sequence.current++; }; },[load]);
  const visible=state.search===search ? state : { report:null,error:null,loading:true };
  return <TransactionsPresentation filters={draft} change={(name,value)=>setDraft(prev=>({ ...prev,[name]:value }))}
    submit={event=>{ event.preventDefault();setSearch({ filters:{ ...draft },cursors:[null],revision:search.revision+1 }); }}
    refresh={()=>setSearch(prev=>({ filters:{ ...draft },cursors:[null],revision:prev.revision+1 }))}
    next={()=>{ if (visible.report?.nextCursor) setSearch(prev=>({ ...prev,cursors:[...prev.cursors,visible.report.nextCursor] })); }}
    previous={()=>setSearch(prev=>({ ...prev,cursors:prev.cursors.slice(0,-1) }))} canPrevious={search.cursors.length>1} {...visible} />;
}
