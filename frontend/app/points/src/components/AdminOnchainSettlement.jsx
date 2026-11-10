import React, { useEffect, useRef, useState } from 'react';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { usePointsExecution } from '../lib/PointsExecution.jsx';
import { getJson, postJson } from '../lib/pointsApi.js';

const endpoint='/api/points/admin/onchain-settlement';
const labels={resolve:'Resolver',cancel:'Anular',dispute:'Abrir disputa',clear_dispute:'Cerrar disputa',correct_resolution:'Corregir resolución',cancel_refund:'Reembolsar anulación'};
const actions={active:['resolve','cancel'],resolved:['dispute'],disputed:['clear_dispute','correct_resolution','cancel']};
const pending=r=>['created','validated','pending','needs_reconciliation'].includes(r.status);
const box={border:'1px solid var(--border)',borderRadius:12,padding:20,marginBottom:18,overflowWrap:'anywhere'};
export const settlementStorageKey = owner => `pronos:admin-settlement:${owner}`;
export const savedSettlement = (storage, key) => JSON.parse(storage.getItem(key) || 'null');
export const settlementConfirmed = result => result.status === 'confirmed' || result.ok === true;
export const mxnp = units => (BigInt(units) / 1000000n).toString() + '.' + (BigInt(units) % 1000000n).toString().padStart(6, '0');

export function saveSettlement(storage, key, input, requestId) {
  const existing = savedSettlement(storage, key);
  if (existing && existing.requestId !== requestId) {
    throw Object.assign(new Error('settlement_already_saved'), { code: 'settlement_already_saved' });
  }
  const record = existing || { ...input, requestId: requestId || crypto.randomUUID() };
  storage.setItem(key, JSON.stringify(record));
  return record;
}

export function postSettlement(api, record) {
  if (record.action !== 'cancel_refund') return api.postJson(endpoint, record);
  const { action, ...refund } = record;
  return api.postJson('/api/points/admin/onchain-refunds', { ...refund, operation: 'execute' });
}

export function clearSettlement(storage, key, requestId) {
  if (savedSettlement(storage, key)?.requestId === requestId) storage.removeItem(key);
}

function MarketAction({market,busy,onSubmit}) {
  const options=(actions[market.status]||[]).filter(action => !market.reviewed || action === 'cancel');
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
export function RefundReview({market,api,busy,onSubmit}) {
  const [holders,setHolders]=useState(''),[review,setReview]=useState(null),[error,setError]=useState('');
  const [loading,setLoading]=useState(false),[cursor,setCursor]=useState(''),[finished,setFinished]=useState(false),[reason,setReason]=useState('');
  async function discover() {
    setLoading(true);setError('');setReview(null);
    try {const r=await api.getJson(`/api/points/admin/onchain-refunds?marketId=${market.id}${cursor?`&cursor=${cursor}`:''}`);
      setHolders(r.holders.join('\n'));setCursor(r.nextCursor||'');setFinished(!r.nextCursor);
    }catch(e){setError(e.code||'unavailable');}finally{setLoading(false);}
  }
  async function preview() {
    setLoading(true);setError('');setReview(null);
    try {setReview(await api.postJson('/api/points/admin/onchain-refunds',{operation:'preview',marketId:market.id,
      holders:holders.split(/[\s,]+/).filter(Boolean)}));}catch(e){setError(e.code||'unavailable');}finally{setLoading(false);}
  }
  return <div aria-label={`Reembolsos ${market.id}`}>
    <p>Revisar hasta 5 titulares por lote. Los importes provienen del contrato; no se pueden editar. La búsqueda recorre los traders indexados.</p>
    <button type="button" disabled={busy||loading||finished} onClick={discover}>Cargar siguientes titulares</button>
    <label>Wallets <textarea aria-label={`Wallets reembolso ${market.id}`} value={holders} disabled={busy||loading}
      onChange={e=>{setHolders(e.target.value);setReview(null);}}/></label>
    <button type="button" disabled={busy||loading||!holders.trim()} onClick={preview}>Previsualizar reembolsos</button>
    {error&&<p role="alert">{error}</p>}
    {review&&<div><p>Bloque {review.blockNumber} · Total {mxnp(review.payoutUnits)} MXNP · Faltante {mxnp(review.shortfallUnits)} MXNP</p>
      {review.refunds.map(r=><p key={r.holder}>{r.holder}: {mxnp(r.payout)} MXNP</p>)}
      {review.skipped.map(r=><p key={r.holder}>{r.holder}: {r.reason}</p>)}
      <label>Motivo <input maxLength={240} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
      <button type="button" disabled={busy||loading||!review.refunds.length||review.shortfallUnits!=='0'||!reason.trim()}
        onClick={()=>onSubmit({action:'cancel_refund',marketId:market.id,holders:review.holders,blockNumber:review.blockNumber,
          blockHash:review.blockHash,planHash:review.planHash,reason:reason.trim()})}>Confirmar reembolsos revisados</button>
    </div>}
  </div>;
}
export function SettlementPanel({owner,api={getJson,postJson},storage=globalThis.localStorage,confirm=message=>window.confirm(message)}) {
  const storageKey=settlementStorageKey(owner);
  const [report,setReport]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false),[saved,setSaved]=useState(null);
  const [message,setMessage]=useState(''),[resolutionPreview,setResolutionPreview]=useState(null);
  const mounted=useRef(true),sequence=useRef(0);
  async function refresh() {
    const seq=++sequence.current;setReport(null);setError(null);
    try { const r=await api.getJson(endpoint);if(mounted.current&&seq===sequence.current)setReport(r); }
    catch(e){if(mounted.current&&seq===sequence.current)setError(e.code||'unavailable');}
  }
  useEffect(()=>{
    mounted.current=true;
    try {setSaved(savedSettlement(storage,storageKey));}catch{setError('storage_unavailable');}
    refresh();return()=>{mounted.current=false;sequence.current++;};
  },[]);
  async function submit(input,requestId) {
    if(busy)return;
    if(!requestId&&!confirm(`${labels[input.action]} · mercado #${input.marketId}${input.outcome!=null?` · resultado ${input.outcome+1}`:''}\n\n${input.reason}\n\n${input.action==='cancel_refund'?'Se pagarán los importes revisados y se quemarán las posiciones correspondientes.':'La anulación pausa el mercado; los reembolsos se procesan por separado. Las correcciones requieren una disputa y ningún cobro previo.'}`))return;
    let record;
    // Persist before POST: an ambiguous HTTP response never creates a new key.
    try {record=saveSettlement(storage,storageKey,input,requestId);setSaved(record);}catch(e){setError(e.code||'storage_unavailable');return;}
    setBusy(true);setError(null);setMessage('');
    try {
      const r=await postSettlement(api,record);
      if(!mounted.current)return;
      if(settlementConfirmed(r)){clearSettlement(storage,storageKey,record.requestId);setSaved(null);setMessage('Transacción confirmada. Esperando la actualización del indexador.');}
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
    <button type="button" disabled={busy} onClick={async()=>{setBusy(true);setResolutionPreview(null);setError(null);
      try{const r=await api.getJson('/api/points/admin/onchain-resolution-preview');if(mounted.current)setResolutionPreview(r);}
      catch(e){if(mounted.current)setError(e.code||'unavailable');}finally{if(mounted.current)setBusy(false);}}}>Inspeccionar resolución automática</button>
    {resolutionPreview&&<div><p>Inspección de fuentes · Sin transacciones · {resolutionPreview.checked} mercados</p>
      {resolutionPreview.candidates.map(r=><p key={r.marketId}>#{r.marketId} · {r.status} · {r.reason||`Resultado ${r.input.outcome+1}`}</p>)}
      {resolutionPreview.truncated&&<p>Vista parcial de la cola. El worker recorre los mercados por lotes.</p>}
    </div>}
    {message&&<p role="status">{message}</p>}
    {error&&<p role="alert">{error==='onchain_settlement_disabled'?'La liquidación está desactivada en este preview.':error==='storage_unavailable'?'Activa el almacenamiento local para conservar la solicitud antes de enviarla.':'No se pudo completar la consulta o solicitud. Actualiza o continúa la solicitud guardada.'}</p>}
    {saved&&<div><p>Solicitud guardada: {saved.requestId} · mercado #{saved.marketId}</p>
      <button type="button" disabled={busy} onClick={()=>{const{requestId,...input}=saved;submit(input,requestId);}}>Continuar solicitud guardada</button>
    </div>}
    {report&&<>
      <p>Resolver automático: {report.scheduler?.enabled?'habilitado':'desactivado'} · Último resultado: {report.scheduler?.latest?.status||'sin evidencia'}</p>
      {report.scheduler?.latest?.startedAt&&<p>Última ejecución: {report.scheduler.latest.startedAt}</p>}
      {report.requests.map(r=><div key={r.requestId}>
        <p>#{r.marketId} · {r.proposalId ? 'Proponer resultado' : labels[r.action]} · {r.status} · índice: {r.indexingStatus}</p>
        {r.txHash&&<a href={`https://sepolia.arbiscan.io/tx/${r.txHash}`} target="_blank" rel="noreferrer">Ver transacción</a>}
        {pending(r)&&<button type="button" disabled={busy||Boolean(saved&&saved.requestId!==r.requestId)} onClick={()=>submit(r.input,r.requestId)}>Continuar {r.requestId}</button>}
        {saved?.requestId===r.requestId&&['confirmed','rejected','reverted'].includes(r.status)&&<button type="button" disabled={busy} onClick={()=>{clearSettlement(storage,storageKey,r.requestId);setSaved(null);}}>Reconocer resultado guardado</button>}
      </div>)}
      {(report.marketsTruncated||report.requestsTruncated)&&<p>Lista parcial; las solicitudes pendientes tienen prioridad.</p>}
      {report.markets.map(m=><article key={m.id} style={{borderTop:'1px solid var(--border)',paddingTop:12,marginTop:12}}>
        <h3>#{m.id} · {m.question}</h3><p>{m.status}</p>
        {m.reviewed && <p>Propón el resultado en Por resolver. Revisa la propuesta en Revisión de liquidaciones.</p>}
        {m.status==='canceled'&&m.settlementReady&&<RefundReview market={m} api={api} busy={busy||Boolean(saved)||report.requests.some(r=>r.marketId===m.id&&(pending(r)||r.awaitingIndexing))} onSubmit={submit}/>}
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
