import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJson, postJson } from '../lib/pointsApi.js';
import { formatAdminMarketDate } from '../lib/adminMarketFilters.js';

const diagnosticLabels = {
  awaiting_result: 'La fuente todavía no tiene un resultado verificable',
  resolved: 'Resuelto',
  canceled: 'Anulado',
  market_changed: 'El mercado cambió durante la consulta',
  manual_review: 'Hay una propuesta para revisar',
  manual_only: 'Este mercado requiere revisión manual',
  run_limit: 'La consulta quedó para el siguiente ciclo',
  configuration: 'Falta configurar un resolver válido',
  fixture_mismatch: 'La fuente no devolvió una coincidencia válida para el evento',
  transcript_unavailable: 'Todavía no hay una transcripción completa y verificable',
  invalid_result: 'La fuente devolvió un resultado inválido.',
  event_interrupted: 'El evento está suspendido o aplazado.',
  event_in_progress: 'La fuente aún no marca el evento como final',
  settlement_error: 'Hubo un error al guardar la resolución',
  provider_error: 'No se pudo verificar el resultado con la fuente',
  window_open: 'El mercado sigue dentro de su ventana de negociación',
  no_check_recorded: 'Todavía no hay una consulta registrada',
};

export const approvalIssueLabels = {
  incomplete_market: 'Faltan la pregunta o las opciones',
  expired_market: 'La hora de cierre ya pasó',
  missing_fixture_id: 'Falta el ID del partido en la configuración del resolver',
  source_disabled: 'La fuente está suspendida',
  english_review: 'Revisar la pregunta y las opciones en inglés',
  missing_criteria: 'Faltan criterios escritos de resolución',
  reviewed_market_shape_unsupported: 'La revisión de 24 horas requiere un solo pool de 2 a 8 opciones',
  manual_review: 'Falta un resolver. Revisa cómo se verificará el resultado',
  duplicate_market: 'Ya existe un mercado equivalente',
  similar_market: 'Hay un mercado parecido. Compara los criterios antes de aprobar',
};

const settlementActions = {
  resolve: ['Resolver mercado', '/api/points/admin/resolve-market', 'Pago potencial de posiciones ganadoras'],
  correct: ['Corregir resultado', '/api/points/admin/correct-resolution', 'Pago potencial de posiciones ganadoras'],
  cancel: ['Anular mercado', '/api/points/admin/cancel-market', 'Reembolso de costo base'],
  candidate: ['Confirmar propuesta', '/api/points/admin/resolution-candidates', 'Pago potencial de posiciones ganadoras'],
};

const money = amount => `${Number(amount || 0).toLocaleString('es-MX', { maximumFractionDigits: 6 })} MXNP`;
const timestamp = value => value ? Date.parse(value) : null;
const date = value => value ? `${formatAdminMarketDate(value, { timeZone: 'America/Mexico_City' })} CDMX` : 'Sin registro';
const staleCodes = ['market_changed', 'resolution_changed', 'candidate_changed', 'candidate_already_reviewed', 'market_not_active'];
const staleCopy = 'El mercado o la propuesta cambió. Vuelve a la cola para revisar la información actualizada.';
const errorMessage = error => [error.detail, approvalIssueLabels[error.code], error.code || error.message].filter(Boolean)[0];

export function ResolverStatus({ market, onChange }) {
  const [data, setData] = useState(null);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [runError, setRunError] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    getJson(`/api/points/admin/resolve-diagnostic?market_id=${market.id}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [market.id, revision]);

  async function retry() {
    setWorking(true);
    setRunError(null);
    try {
      const result = await postJson('/api/points/admin/run-auto-resolve', { marketId: market.id });
      setRevision(value => value + 1);
      if (result.diagnosticsUnavailable) setRunError('La consulta terminó, pero no se pudo guardar el diagnóstico.');
      const proposed = result.diagnostic?.status === 'manual_review';
      if (result.resolved?.length || proposed) onChange();
    } catch (error) {
      setRunError(error.code === 'market_not_due_for_resolver'
        ? 'El mercado no está listo para una consulta automática. Revisa su estado y hora de cierre.'
        : `No se pudo ejecutar el resolver. ${errorMessage(error)}`);
    } finally {
      setConfirm(false);
      setWorking(false);
    }
  }

  return (
    <section className="pb-admin-operation" aria-label="Diagnóstico del resolver">
      <h3>Diagnóstico del resolver</h3>
      {loadError ? <p role="alert">No se pudo consultar el diagnóstico. <button type="button" className="pb-admin-button" onClick={() => setRevision(value => value + 1)}>Volver a cargar</button></p>
        : !data ? <p role="status">Consultando el resolver…</p> : <>
          <strong>{diagnosticLabels[data.status] || 'Estado pendiente de revisión'}</strong>
          <dl className="pb-admin-operation-facts">
            <div><dt>Proveedor</dt><dd>{data.provider || 'Sin fuente registrada'}</dd></div>
            <div><dt>Última consulta</dt><dd>{date(data.lastCheckedAt)}</dd></div>
            <div><dt>Última respuesta válida</dt><dd>{date(data.sourceResponseAt)}</dd></div>
            {data.providerState && <div><dt>Estado de la fuente</dt><dd>{data.providerState}</dd></div>}
          </dl>
          <div className="pb-admin-tools">
            {data.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noreferrer">Revisar fuente ↗</a>}
            {data.canRetry && !confirm && <button type="button" className="pb-admin-button" onClick={() => { setConfirm(true); setRunError(null); }}>Reintentar resolución</button>}
          </div>
          {confirm && <div className="pb-admin-operation">
            <p>El resolver comprobará solo este mercado y podrá resolverlo si encuentra evidencia válida.</p>
            <div className="pb-admin-tools">
              <button type="button" className="pb-admin-button pb-admin-primary" disabled={working} onClick={retry}>{working ? 'Consultando…' : 'Consultar y aplicar'}</button>
              <button type="button" className="pb-admin-button" disabled={working} onClick={() => setConfirm(false)}>Volver</button>
            </div>
          </div>}
        </>}
      {runError && <p className="pb-admin-error" role="alert">{runError}</p>}
    </section>
  );
}

export function SettlementReview({ action, market, indexes, candidate, initialScore, onConfirm, onClose }) {
  const ref = useRef(null);
  const [finalScore, setFinalScore] = useState(initialScore ?? market.finalScore ?? '');
  const [reason, setReason] = useState('');
  const [impact, setImpact] = useState(null);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);
  const [stale, setStale] = useState(false);
  const [revision, setRevision] = useState(0);
  const [title, endpoint, amountLabel] = settlementActions[action];
  const needsReason = action === 'cancel' || action === 'correct';
  const payload = action === 'candidate'
    ? { candidateId: candidate.id, action: 'confirm', outcomeIndex: indexes[0] }
    : { marketId: market.id, ...(action === 'cancel' ? {} : { winningOutcomeIndexes: indexes }) };

  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    let active = true;
    setError(null);
    setImpact(null);
    postJson(endpoint, { ...payload, preview: true })
      .then(result => {
        if (!active) return;
        if (!result.preview) throw new Error('Vista previa no disponible');
        const preview = result.preview;
        const marketChanged = action !== 'cancel' && (preview.question !== market.question
          || JSON.stringify(preview.outcomes) !== JSON.stringify(market.outcomes));
        const candidateChanged = candidate && (timestamp(preview.observedAt) !== timestamp(candidate.observedAt)
          || preview.suggestedScore !== (candidate.finalScore ?? null)
          || preview.suggestedOutcome !== (candidate.outcomeIndex ?? null)
          || preview.evidenceUrl !== (candidate.evidenceUrl ?? null));
        if (marketChanged || candidateChanged) {
          setStale(true);
          setError(staleCopy);
          return;
        }
        setImpact(result.preview);
      })
      .catch(err => {
        if (!active) return;
        const changed = staleCodes.includes(err.code);
        setStale(changed);
        setError(changed ? staleCopy : errorMessage(err));
      });
    return () => { active = false; };
  }, [endpoint, revision]);

  async function submit(event) {
    event.preventDefault();
    if (!impact || working || (needsReason && reason.trim().length < 2)) return;
    setWorking(true);
    setError(null);
    try {
      await onConfirm({
        finalScore: finalScore.trim(),
        reason: reason.trim(),
        expectedResolvedAt: impact.expectedResolvedAt,
        expectedCandidate: impact.expectedCandidate,
        expectedMarket: impact.expectedMarket,
      });
      onClose();
    } catch (err) {
      const changed = staleCodes.includes(err.code);
      if (changed) { setImpact(null); setStale(true); }
      setError(changed ? staleCopy : errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <dialog className="pb-admin-dialog" ref={ref} aria-labelledby="settlement-review-title"
      onCancel={event => { event.preventDefault(); if (!working) onClose(stale); }}>
      <form onSubmit={submit} className="pb-admin-operation">
        <h2 id="settlement-review-title">{title}</h2>
        <p><strong>#{market.id} · {market.question}</strong></p>
        {action !== 'cancel' && <p>Resultado seleccionado <strong>{(impact?.selectedLabels || indexes.map(index => market.outcomes[index] || `Opción ${index + 1}`)).join(', ')}</strong></p>}
        {impact ? <dl className="pb-admin-operation-facts">
          <div><dt>{amountLabel}</dt><dd>{money(impact.amount)} · {impact.holderCount} cuentas</dd></div>
          {action === 'correct' && <div><dt>Cobros a revertir</dt><dd>{money(impact.reversedTotal)} · {impact.reversedCount} cobros</dd></div>}
          <div><dt>Órdenes abiertas</dt><dd>{impact.orderCount} · {money(impact.reservedAmount)} reservados</dd></div>
        </dl> : !error && <p role="status">Calculando el impacto…</p>}
        {action !== 'cancel' && <label className="pb-admin-field">Resultado público (opcional)
          <input value={finalScore} maxLength={240} onChange={event => setFinalScore(event.target.value)} disabled={working} />
        </label>}
        {needsReason && <label className="pb-admin-field">Motivo {action === 'cancel' && '(aparece en el historial de reembolsos)'}
          <textarea value={reason} required minLength={2} rows={2} maxLength={action === 'cancel' ? 180 : 240}
            onChange={event => setReason(event.target.value)} disabled={working} />
        </label>}
        <p className="pb-admin-tools-note">La vista previa usa el estado actual. Las posiciones y órdenes pueden cambiar hasta que confirmes.</p>
        {error && <p className="pb-admin-error" role="alert">{error} {!impact && !stale && <button type="button" className="pb-admin-button" onClick={() => setRevision(value => value + 1)}>Actualizar cálculo</button>}</p>}
        <div className="pb-admin-tools">
          <button type="button" className="pb-admin-button" disabled={working} onClick={() => onClose(stale)}>Volver</button>
          <button type="submit" className="pb-admin-button pb-admin-primary" disabled={!impact || working || (needsReason && reason.trim().length < 2)}>
            {working ? 'Aplicando…' : title}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export async function checkProposalApproval(id, { previewApprovalMode, signal } = {}) {
  const query = new URLSearchParams({ check_id: id });
  if (previewApprovalMode) query.set('previewApprovalMode', previewApprovalMode);
  const result = await getJson(`/api/points/admin/pending-markets?${query}`, { signal });
  if (!Array.isArray(result?.checks)) throw new Error('No se pudo verificar la propuesta.');
  return result;
}

export function ProposalApproval({ row, revision, disabled, onApprove, previewApprovalMode, reviewedSepolia }) {
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setConfirm(false);
    checkProposalApproval(row.id, { signal: controller.signal, previewApprovalMode })
      .then(result => { if (!controller.signal.aborted) setState(result); })
      .catch(() => { if (!controller.signal.aborted) setState(false); });
    return () => controller.abort();
  }, [row.id, revision, attempt, previewApprovalMode, reviewedSepolia]);

  const checks = state?.checks;
  const rules = state?.resolutionRules;
  const approvalKey = previewApprovalMode === 'onchain' ? state?.oneClickApprovalKey : null;
  const needsConfirmation = reviewedSepolia || !approvalKey;
  const blocked = checks?.some(issue => issue.severity === 'block');
  return (
    <section className="pb-admin-operation pb-admin-approval" aria-label="Verificación de la propuesta">
      <h3>Verificación antes de publicar</h3>
      {state === null && <p role="status">Revisando la propuesta…</p>}
      {state === false && <p role="alert">No se pudo verificar la propuesta. <button className="pb-admin-button" type="button" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></p>}
      {checks?.length > 0 && <ul className="pb-admin-checks">
        {checks.map(issue => (
          <li key={`${issue.code}-${issue.marketId || ''}`}><strong>{issue.severity === 'block' ? 'Bloquea' : 'Revisar'}</strong> {approvalIssueLabels[issue.code] || issue.code}
            {issue.marketId && <> · <Link to={`/admin?tab=markets&status=all&q=%23${issue.marketId}&item=${issue.marketId}`}>#{issue.marketId}</Link></>}
          </li>
        ))}
      </ul>}
      {checks?.length === 0 && <p>La verificación no encontró incidencias.</p>}
      {rules && <>
        <h4>{rules.generated ? 'Criterios de resolución generados' : 'Criterios de resolución'}</h4>
        <p>{rules.criteria}</p>
        {rules.sourceUrl && <a href={rules.sourceUrl} target="_blank" rel="noreferrer">Fuente en ESPN</a>}
      </>}
      {confirm && <p role="status">Se publicará la propuesta #{row.id} “{row.question}”
        {previewApprovalMode === 'onchain' ? ' en Arbitrum Sepolia' : ''}.
        {reviewedSepolia && ' La revisión de 24 horas comienza cuando se propone un resultado.'}</p>}
      <div className="pb-admin-tools">
        <button className="pb-admin-button pb-admin-primary" type="button" disabled={!checks || blocked || disabled}
          onClick={() => (!needsConfirmation || confirm) ? onApprove(approvalKey || undefined) : setConfirm(true)}>
          {confirm ? 'Confirmar publicación' : approvalKey ? 'Publicar en Arbitrum Sepolia' : 'Aprobar propuesta'}
        </button>
        {confirm && <button type="button" className="pb-admin-button" disabled={disabled} onClick={() => setConfirm(false)}>Volver</button>}
      </div>
    </section>
  );
}
