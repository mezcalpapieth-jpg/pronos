import React, { useEffect, useRef, useState } from 'react';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { getJson, postJson } from '../lib/pointsApi.js';
import { clearSettlement, mxnp, postSettlement, saveSettlement, savedSettlement,
  settlementConfirmed, settlementStorageKey } from './AdminOnchainSettlement.jsx';

const errorMessages = {
  storage_unavailable: 'Activa el almacenamiento local para conservar la solicitud.',
  settlement_already_saved: 'Continúa la liquidación guardada en Sistema.',
  settlement_source_changed: 'Los datos del mercado cambiaron. Revisa la solicitud en Sistema antes de intentarlo de nuevo.',
  settlement_resolution_pool_shortfall: 'El saldo del pool cambió y ya no cubre los cobros estimados.',
  resolution_market_unavailable: 'El mercado ya no está disponible para resolución o sigue abierto en la cadena.',
  resolver_isolation_failed: 'La liquidación está desactivada en este preview.',
};

export function OnchainResolutionReview({ market, owner, onSettled, api = { getJson, postJson },
  storage = globalThis.localStorage, confirm = message => window.confirm(message) }) {
  const key = settlementStorageKey(owner);
  const [review, setReview] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const operation = useRef(null);

  useEffect(() => {
    mounted.current = true;
    try { setSaved(savedSettlement(storage, key)); }
    catch { setError('storage_unavailable'); }
    return () => { mounted.current = false; operation.current?.abort(); };
  }, [key, storage]);

  async function load() {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true); setReview(null); setError(null); setReason(''); setOutcome(null);
    try {
      const preview = await api.getJson(`/api/points/admin/onchain-resolution-preview?marketId=${market.id}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setReview(preview);
      setOutcome(preview.suggestedOutcome);
    } catch (e) {
      if (!controller.signal.aborted) setError(e.code || 'unavailable');
    } finally {
      if (mounted.current && !controller.signal.aborted) setBusy(false);
      if (operation.current === controller) operation.current = null;
    }
  }

  const payout = review?.estimate.payouts.find(row => row.outcome === outcome);
  const canSubmit = payout?.shortfallUnits === '0' && Boolean(reason.trim())
    && ['ready', 'manual'].includes(review?.status);
  const resumeHere = saved?.marketId === market.id && saved.action === 'resolve' && saved.reviewHash;

  async function submit() {
    if (operation.current || result?.confirmed || (!resumeHere && (saved || !canSubmit))) return;
    if (!resumeHere && !confirm(
      `¿Resolver #${market.id} en Arbitrum Sepolia con “${review.outcomes[outcome]}”?\n\nCobros estimados: ${mxnp(payout.payoutUnits)} MXNP.\nMotivo: ${reason.trim()}`,
    )) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true); setError(null);
    try {
      let record;
      try {
        const input = resumeHere ? saved : { marketId: market.id, action: 'resolve', outcome, reason: reason.trim(), reviewHash: review.reviewHash };
        record = saveSettlement(storage, key, input, resumeHere ? saved.requestId : undefined);
      } catch (e) {
        setError(e.code || 'storage_unavailable');
        return;
      }
      setSaved(record);
      const response = await postSettlement(api, record);
      const confirmed = settlementConfirmed(response);
      if (confirmed) clearSettlement(storage, key, record.requestId);
      if (!mounted.current) return;
      setResult({ confirmed, txHash: response.txHash });
      if (confirmed) {
        setSaved(null);
        onSettled?.(market.id);
      }
    } catch (e) {
      if (mounted.current) setError(e.code || 'unavailable');
    } finally {
      if (mounted.current) setBusy(false);
      if (operation.current === controller) operation.current = null;
    }
  }

  return <section aria-label="Revisión de resolución en Arbitrum Sepolia">
    <h3>Resolución en Arbitrum Sepolia</h3>
    {error && <p className="pb-admin-message pb-admin-error" role="alert">
      {errorMessages[error] || 'No se pudo completar la operación. Si hay una solicitud guardada, continúa con la misma.'}
    </p>}
    {result && <p role="status">
      {result.confirmed ? 'Resolución confirmada. Esperando al indexador.' : 'Solicitud pendiente. Continúa con la misma solicitud.'}
      {/^0x[\da-f]{64}$/i.test(result.txHash || '') && <> · <a href={`https://sepolia.arbiscan.io/tx/${result.txHash}`} target="_blank" rel="noreferrer">Ver transacción</a></>}
    </p>}
    {saved && <p>Solicitud guardada para el mercado #{saved.marketId} · <a href="?tab=launch">Ver liquidación en Sistema</a></p>}
    {resumeHere && <button type="button" className="pb-admin-button" onClick={submit} disabled={busy}>Continuar resolución guardada</button>}
    {!saved && !result?.confirmed && <>
      <button type="button" className="pb-admin-button" onClick={load} disabled={busy}>
        {busy ? 'Consultando…' : review ? 'Actualizar evidencia y cobros' : 'Consultar evidencia y cobros'}
      </button>
      {review && <>
        {review.criteria && <p>{review.criteria}</p>}
        <p>Fuente {review.evidence.provider || 'manual'}
          {review.evidence.url && <> · <a href={review.evidence.url} target="_blank" rel="noreferrer">Ver fuente</a></>}
          {review.evidence.score && <> · Resultado {review.evidence.score}</>}
          {review.evidence.observedAt && <> · Consultada <time dateTime={review.evidence.observedAt}>{new Date(review.evidence.observedAt).toLocaleString('es-MX')}</time></>}
        </p>
        {review.status === 'ready' && <p>Ganador sugerido <strong>{review.outcomes[review.suggestedOutcome]}</strong></p>}
        {review.status === 'deferred' && <p>La fuente aún no confirma un resultado. Actualiza la evidencia antes de resolver.</p>}
        {review.status === 'manual' && <label>Resultado verificado <select value={outcome ?? ''} disabled={busy}
          onChange={e => setOutcome(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">Seleccionar…</option>
          {review.outcomes.map((label, index) => <option key={index} value={index}>{label}</option>)}
        </select></label>}
        {payout && <p>Cobros estimados para los titulares {mxnp(payout.payoutUnits)} MXNP · Bloque {review.estimate.blockNumber}
          {payout.shortfallUnits !== '0' && <> · Faltan {mxnp(payout.shortfallUnits)} MXNP en el pool</>}
        </p>}
        {review.status !== 'deferred' && <form onSubmit={event => { event.preventDefault(); submit(); }}>
          <label>Motivo de la resolución <input maxLength={240} required value={reason} disabled={busy}
            onChange={e => setReason(e.target.value)} /></label>{' '}
          <button type="submit" className="pb-admin-button" disabled={busy || !canSubmit}>Confirmar resolución en Arbitrum Sepolia</button>
        </form>}
      </>}
    </>}
  </section>;
}

export default function AdminOnchainResolution({ market, onSettled }) {
  const { user } = usePointsAuth();
  const owner = `${user?.suborgId || ''}:${user?.username || ''}`;
  return <OnchainResolutionReview key={`${owner}:${market.id}`} market={market} owner={owner} onSettled={onSettled} />;
}
