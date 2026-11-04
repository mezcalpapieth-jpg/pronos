import React, { useEffect, useRef, useState } from 'react';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { usePointsExecution } from '../lib/PointsExecution.jsx';
import { getJson, postJson } from '../lib/pointsApi.js';

const endpoint='/api/points/admin/onchain-settlement';
const labels={resolve:'Resolver',cancel:'Anular',dispute:'Abrir disputa',clear_dispute:'Cerrar disputa',correct_resolution:'Corregir resolución'};
const actions={active:['resolve','cancel'],resolved:['dispute'],disputed:['clear_dispute','correct_resolution','cancel']};
const pending=r=>['created','validated','pending','needs_reconciliation'].includes(r.status);
const box={border:'1px solid var(--border)',borderRadius:12,padding:20,marginBottom:18,overflowWrap:'anywhere'};

function MarketAction({market,busy,onSubmit}) {
  const options=actions[market.status]||[];
  const [action,setAction]=useState(options[0]||'resolve'),[outcome,setOutcome]=useState(0),[reason,setReason]=useState('');
  const selected=options.includes(action)?action:options[0];
  if(!market.settlementReady)return <p>Revisar el vínculo de este mercado o su configuración paralela antes de liquidar.</p>;
  if(!options.length)return null;
  return <form onSubmit={e=>{e.preventDefault();onSubmit({marketId:market.id,action:selected,
    outcome:['resolve','correct_resolution'].includes(selected)?Number(outcome):null,reason:reason.trim()});}}>
    <label>Acción <select aria-label={`Acción ${market.id}`} value={selected} onChange={e=>setAction(e.target.value)} disabled={busy}>
      {options.map(a=><option value={a} key={a}>{labels[a]}</option>)}
    </select></label>{' '}
    {['resolve','correct_resolution'].includes(selected)&&<label>Resultado <select aria-label={`Resultado ${market.id}`} value={outcome} onChange={e=>setOutcome(Number(e.target.value))} disabled={busy}>
      {market.outcomes.map((o,i)=><option value={i} key={i}>{o}</option>)}
    </select></label>}{' '}
    <label>Motivo <input aria-label={`Motivo ${market.id}`} required maxLength={240} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/></label>{' '}
    <button type="submit" disabled={busy||!reason.trim()||(['resolve','correct_resolution'].includes(selected)&&!market.outcomes.length)}>{busy?'Procesando…':'Confirmar acción'}</button>
  </form>;
}
export function SettlementPanel({owner,api={getJson,postJson},storage=globalThis.localStorage,confirm=message=>window.confirm(message)}) {
  const storageKey=`pronos:admin-settlement:${owner}`;
  const [report,setReport]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false),[saved,setSaved]=useState(null);
  const [message,setMessage]=useState('');
  const mounted=useRef(true),sequence=useRef(0);
  async function refresh() {
    const seq=++sequence.current;setReport(null);setError(null);
    try { const r=await api.getJson(endpoint);if(mounted.current&&seq===sequence.current)setReport(r); }
    catch(e){if(mounted.current&&seq===sequence.current)setError(e.code||'unavailable');}
  }
  useEffect(()=>{
    mounted.current=true;
    try {const value=storage.getItem(storageKey);if(value)setSaved(JSON.parse(value));}catch{setError('storage_unavailable');}
    refresh();return()=>{mounted.current=false;sequence.current++;};
  },[]);
  async function submit(input,requestId) {
    if(busy)return;
    if(!requestId&&!confirm(`${labels[input.action]} · mercado #${input.marketId}${input.outcome!=null?` · resultado ${input.outcome+1}`:''}\n\n${input.reason}\n\nLa anulación pausa el mercado; los reembolsos se procesan por separado. Las correcciones requieren una disputa y ningún cobro previo.`))return;
    const record={...input,requestId:requestId||crypto.randomUUID()};
    // Persist before POST: an ambiguous HTTP response never creates a new key.
    try {storage.setItem(storageKey,JSON.stringify(record));setSaved(record);}catch{setError('storage_unavailable');return;}
    setBusy(true);setError(null);setMessage('');
    try {
      const r=await api.postJson(endpoint,record);
      if(!mounted.current)return;
      if(r.status==='confirmed'||r.ok===true){storage.removeItem(storageKey);setSaved(null);setMessage('Transacción confirmada. Esperando la actualización del indexador.');}
      else setMessage('Solicitud pendiente. Continúa con la misma solicitud; no se crea otra transacción.');
      await refresh();
    } catch(e) {
      if(!mounted.current)return;
      // Retain the key on every error, including lost responses and transient
      // failures. Rejected requests are immutable and can be acknowledged.
      setError(e.code||'unavailable');
    } finally {if(mounted.current)setBusy(false);}
  }
  return <section style={box} aria-label="Onchain settlement">
    <h2>Liquidación onchain · Arbitrum Sepolia</h2>
    <p>El contrato confirma la operación y el indexador actualiza el estado. Anular no paga reembolsos automáticamente.</p>
    <button type="button" onClick={refresh} disabled={busy}>Actualizar liquidaciones</button>
    {message&&<p role="status">{message}</p>}
    {error&&<p role="alert">{error==='onchain_settlement_disabled'?'La liquidación está desactivada en este preview.':error==='storage_unavailable'?'Activa el almacenamiento local para conservar la solicitud antes de enviarla.':'No se pudo completar la consulta o solicitud. Actualiza o continúa la solicitud guardada.'}</p>}
    {saved&&<div><p>Solicitud guardada: {saved.requestId} · mercado #{saved.marketId}</p>
      <button type="button" disabled={busy} onClick={()=>{const{requestId,...input}=saved;submit(input,requestId);}}>Continuar solicitud guardada</button>
    </div>}
    {report&&<>
      <p>Resolver automático: {report.scheduler?.enabled?'habilitado':'desactivado'} · Último resultado: {report.scheduler?.latest?.status||'sin evidencia'}</p>
      {report.scheduler?.latest?.startedAt&&<p>Última ejecución: {report.scheduler.latest.startedAt}</p>}
      {report.requests.map(r=><div key={r.requestId}>
        <p>#{r.marketId} · {labels[r.action]} · {r.status} · índice: {r.indexingStatus}</p>
        {r.txHash&&<a href={`https://sepolia.arbiscan.io/tx/${r.txHash}`} target="_blank" rel="noreferrer">Ver transacción</a>}
        {pending(r)&&<button type="button" disabled={busy} onClick={()=>submit(r.input,r.requestId)}>Continuar {r.requestId}</button>}
        {saved?.requestId===r.requestId&&['confirmed','rejected','reverted'].includes(r.status)&&<button type="button" disabled={busy} onClick={()=>{storage.removeItem(storageKey);setSaved(null);}}>Reconocer resultado guardado</button>}
      </div>)}
      {(report.marketsTruncated||report.requestsTruncated)&&<p>Lista parcial; las solicitudes pendientes tienen prioridad.</p>}
      {report.markets.map(m=><article key={m.id} style={{borderTop:'1px solid var(--border)',paddingTop:12,marginTop:12}}>
        <h3>#{m.id} · {m.question}</h3><p>{m.status}</p>
        <MarketAction market={m} busy={busy||Boolean(saved)||report.requests.some(r=>r.marketId===m.id&&(pending(r)||r.awaitingIndexing))} onSubmit={submit}/>
      </article>)}
    </>}
  </section>;
}
export default function AdminOnchainSettlement({isAdmin}) {
  const {authenticated,user}=usePointsAuth(),execution=usePointsExecution();
  if(!authenticated||!isAdmin||!execution.enabled||!execution.durableTrades)return null;
  const owner=`${user?.suborgId||''}:${user?.username||''}`;
  return <SettlementPanel key={owner} owner={owner}/>;
}
