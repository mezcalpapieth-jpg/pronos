import React, { useEffect, useState } from 'react';
import { useLang } from '@app/lib/i18n.js';
import { getJson, postJson } from '../lib/pointsApi.js';

const endpoint = '/api/points/resolution-review';
const panel = { border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBlock: 16, overflowWrap: 'anywhere' };
const text = {
  en: {
    title: 'Settlement review', open: 'Waiting for a proposed outcome', under_review: 'Outcome under review',
    disputed: 'Disputed · settlement paused', finalized: 'Outcome finalized', canceled: 'Market canceled',
    proposed: 'Proposed outcome', result: 'Final outcome', ends: 'Review window ends', approval: 'Reviewer approved',
    pending: 'Reviewer approval pending', evidence: 'Result and evidence', rules: 'Published resolution rules',
    awaiting: 'Document pending publication', report: 'Report an issue with this proposal',
    note: 'Explain what conflicts with the published rules or evidence. This sends a report to the reviewers.',
    send: 'Send objection', login: 'Sign in to report an issue', sent: 'Objection sent to reviewers.',
    stale: 'This proposal changed. Review the new outcome before reporting it.',
    duplicate: 'You already sent an objection for this proposal.',
    error: 'The request could not be completed. Try again.',
  },
  es: {
    title: 'Revisión de liquidación', open: 'En espera de una propuesta', under_review: 'Resultado en revisión',
    disputed: 'En disputa · liquidación pausada', finalized: 'Resultado finalizado', canceled: 'Mercado anulado',
    proposed: 'Resultado propuesto', result: 'Resultado final', ends: 'Fin del periodo de revisión', approval: 'Revisor aprobó',
    pending: 'Falta aprobación del revisor', evidence: 'Resultado y evidencia', rules: 'Reglas de resolución publicadas',
    awaiting: 'Documento pendiente de publicación', report: 'Reportar un problema con esta propuesta',
    note: 'Explica qué contradice las reglas o la evidencia publicada. El reporte se envía a los revisores.',
    send: 'Enviar objeción', login: 'Inicia sesión para reportar', sent: 'Objeción enviada a los revisores.',
    stale: 'La propuesta cambió. Revisa el nuevo resultado antes de reportarlo.',
    duplicate: 'Ya enviaste una objeción para esta propuesta.',
    error: 'No se pudo completar la solicitud. Inténtalo de nuevo.',
  },
};

export function useResolutionReview(marketId) {
  const [snapshot, setSnapshot] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!marketId) return undefined;
    const controller = new AbortController();
    let sequence = 0;
    async function load() {
      const request = ++sequence;
      try {
        const result = await getJson(`${endpoint}?marketId=${marketId}`, { signal: controller.signal });
        if (!controller.signal.aborted && request === sequence) setSnapshot({ marketId, review: result.review });
      } catch {
        if (!controller.signal.aborted && request === sequence) setSnapshot(null);
      }
    }
    void load();
    const interval = setInterval(load, 30000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [marketId, attempt]);
  return { review: marketId && snapshot?.marketId === marketId ? snapshot.review : null,
    refreshReview: () => setAttempt(value => value + 1) };
}

function Document({ title, hash, published, awaiting }) {
  if (!hash) return null;
  return <p>
    {published
      ? <a href={`${endpoint}?document=${hash}`} target="_blank" rel="noreferrer">{title}</a>
      : <span>{title} · {awaiting}</span>}
    {' '}<code>{hash}</code>
  </p>;
}

function ObjectionForm({ marketId, proposalId, copy, refreshReview }) {
  const [detail, setDetail] = useState('');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (sending || status === 'sent' || !detail.trim()) return;
    setSending(true);
    setStatus('');
    try {
      await postJson(endpoint, { action: 'object', marketId, proposalId, detail });
      setStatus('sent');
    } catch (error) {
      if (error.code === 'proposal_changed') { setStatus('stale'); refreshReview(); }
      else setStatus(error.code === 'objection_already_submitted' ? 'duplicate' : 'error');
    } finally { setSending(false); }
  }
  return <form onSubmit={submit}>
    <label>{copy.report}<br />
      <textarea required maxLength={2000} rows={3} value={detail}
        onChange={event => setDetail(event.target.value)} disabled={sending || status === 'sent'} />
    </label>
    <p>{copy.note}</p>
    <button type="submit" disabled={sending || !detail.trim() || status === 'sent'}>{copy.send}</button>
    {status && <p role={status === 'sent' ? 'status' : 'alert'}>{copy[status]}</p>}
  </form>;
}

export function ResolutionReview({ marketId, review, authenticated, onOpenLogin, refreshReview }) {
  const lang = useLang() === 'en' ? 'en' : 'es';
  const copy = text[lang];
  if (!review) return null;
  const pending = ['under_review', 'disputed'].includes(review.state);
  return <section style={panel} aria-label={copy.title}>
    <h2>{copy.title}</h2>
    <p><strong>{copy[review.state]}</strong></p>
    {review.outcome != null && review.state !== 'canceled' &&
      <p>{review.state === 'finalized' ? copy.result : copy.proposed} · {review.outcomes?.[review.outcome]}</p>}
    {review.state === 'under_review' && review.reviewEndsAt &&
      <p>{copy.ends} · <time dateTime={review.reviewEndsAt}>{new Date(review.reviewEndsAt).toLocaleString(lang === 'en' ? 'en-US' : 'es-MX', {
        timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short',
      })} (CDMX)</time>{' · '}{review.approved ? copy.approval : copy.pending}</p>}
    <Document title={copy.rules} hash={review.rulesHash} published={review.rulesDocument} awaiting={copy.awaiting} />
    <Document title={copy.evidence} hash={review.evidenceHash} published={review.evidenceDocument} awaiting={copy.awaiting} />
    {pending && review.proposalId && (authenticated
      ? <ObjectionForm key={review.proposalId} {...{ marketId, proposalId: review.proposalId, copy, refreshReview }} />
      : <button type="button" onClick={onOpenLogin}>{copy.login}</button>)}
  </section>;
}

export function AdminResolutionReview() {
  const [queue, setQueue] = useState(null);
  const [message, setMessage] = useState('');
  const [marketId, setMarketId] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  async function load(signal) {
    try { setQueue(await getJson(`${endpoint}?queue=1`, { signal })); }
    catch (error) {
      if (!signal?.aborted && error.status !== 404) setMessage('No se pudo cargar la cola de revisión.');
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);
  async function publish(event) {
    event.preventDefault();
    if (!file || busy) return;
    if (file.size > 32768) { setMessage('El documento supera 32 KB.'); return; }
    setBusy(true);
    setMessage('');
    try {
      const result = await postJson(endpoint, { action: 'publish', marketId, content: await file.text() });
      setMessage(`Documento verificado y publicado · ${result.hash}`);
    } catch (error) {
      setMessage(error.code === 'document_hash_mismatch'
        ? 'El archivo no coincide con el hash publicado en el contrato.'
        : 'No se pudo publicar el documento.');
    } finally { setBusy(false); }
  }
  if (!queue && !message) return null;
  return <section style={panel} aria-label="Revisión de liquidaciones">
    <h2>Revisión de liquidaciones · Arbitrum One</h2>
    <p>Verifica la evidencia y la propuesta exacta. El revisor firma las acciones de contrato en su Safe.</p>
    <button type="button" onClick={() => load()}>Actualizar cola</button>
    {queue?.truncated && <p>La cola muestra un subconjunto de las revisiones y objeciones.</p>}
    {queue?.markets?.map(market => <article key={market.marketId}>
      <p><a href={`/points/market?id=${market.marketId}`}>#{market.marketId} · {market.question}</a>
        {' · '}{text.es[market.review.state]}{' · '}{market.review.outcomes?.[market.review.outcome]}</p>
      <p>Contrato <code>{market.factoryAddress}</code> · Mercado {market.contractMarketId}
        {' · '}Propuesta <code>{market.review.proposalId}</code></p>
    </article>)}
    {queue && <>
      <h3>Objeciones</h3>
      {!queue.objections.length && <p>Sin objeciones registradas.</p>}
      {queue.objections.map(objection => <article key={objection.id}>
        <p><a href={`/points/market?id=${objection.marketId}`}>#{objection.marketId} · {objection.question}</a>
          {' · '}{objection.current ? text.es[objection.state] : 'Propuesta anterior'}</p>
        <p>{objection.detail || <code>{objection.objectionHash}</code>}</p>
        {objection.txHash && <p><a href={`https://arbiscan.io/tx/${objection.txHash}`} target="_blank" rel="noreferrer">Objeción on-chain</a></p>}
        <p>Propuesta <code>{objection.proposalId}</code></p>
      </article>)}
      <form onSubmit={publish}>
        <h3>Publicar reglas o evidencia</h3>
        <label>ID de mercado Points <input required inputMode="numeric" pattern="[0-9]+" value={marketId}
          onChange={event => setMarketId(event.target.value)} /></label>{' '}
        <label>Documento UTF-8 <input required type="file" onChange={event => setFile(event.target.files[0] || null)} /></label>{' '}
        <button type="submit" disabled={busy}>Verificar y publicar</button>
      </form>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
