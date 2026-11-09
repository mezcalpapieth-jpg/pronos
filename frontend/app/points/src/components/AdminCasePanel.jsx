import React, { useEffect, useState } from 'react';
import { getJson, postJson } from '../lib/pointsApi.js';
import { formatAdminMarketDate } from '../lib/adminMarketFilters.js';
import '../pages/PointsAdminWorkspace.css';

function formatAmount(value) {
  return Number(value || 0).toLocaleString('es-MX', { maximumFractionDigits: 6 });
}

const marketStates = { active: 'Activo', resolved: 'Resuelto', canceled: 'Anulado' };

function positionState(position, market) {
  if (position.status === 'canceled') return 'Anulada';
  if (position.status === 'active') return 'Sin resultado';
  if (!position.isWinner) return 'Perdedora';
  if (Number(position.shares) <= 0) return 'Sin acciones restantes';
  if (!market.cycleAvailable) return 'Sin ciclo para cobrar';
  if (!position.redeemable) return 'Fuera del ciclo de cobro';
  if (position.dismissedAt) return 'Cobrable · oculta en el portafolio';
  if (!position.visibleShares) return 'Cobrable · debajo del mínimo visible';
  return 'Cobrable';
}

function SupportMarket({ market }) {
  return (
    <section className="pb-admin-operation" aria-label="Posiciones y cobros">
      <h3><a href={`/points/market?id=${market.id}`}>#{market.id} · {market.question} ↗</a></h3>
      <p>{marketStates[market.status] || market.status} · Cobrado {formatAmount(market.redeemedAmount)} MXNP
        {market.reversedCount > 0 && <> · {market.reversedCount} cobros con reversión</>}
        {Number(market.refundedAmount) > 0 && <> · Reembolsado {formatAmount(market.refundedAmount)} MXNP</>}
      </p>
      {market.positions.length > 0 ? <ul className="pb-admin-checks">
        {market.positions.map(position => (
          <li key={`${position.id}-${position.outcomeIndex}`}>
            <strong>{position.legLabel ? `${position.legLabel} · ` : ''}{position.positionLabel || 'Posición'}</strong>
            {' · '}{positionState(position, market)} · {formatAmount(position.shares)} acciones · Costo base {formatAmount(position.costBasis)} MXNP
          </li>
        ))}
      </ul> : <p>Esta cuenta no tiene posiciones registradas en el mercado.</p>}
    </section>
  );
}

export default function AdminCasePanel({ kind, subject, onChange }) {
  const [record, setRecord] = useState(null);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState('');
  const [marketInput, setMarketInput] = useState('');
  const identity = { kind, subject: String(subject) };

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    getJson(`/api/points/admin/cases?${new URLSearchParams(identity)}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setRecord(value); })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [kind, subject, revision]);

  async function save(action, value) {
    setWorking(true);
    setActionError(null);
    try {
      await postJson('/api/points/admin/cases', { ...identity, action, value });
      if (action === 'note') setNote('');
      if (action === 'link_market') setMarketInput('');
      setRevision(count => count + 1);
      onChange?.();
    } catch (error) {
      setActionError(error.code === 'market_not_found' ? 'No se encontró ese mercado de puntos.' : 'No se pudo guardar el cambio.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="pb-admin-operation pb-admin-case" aria-label="Seguimiento interno">
      <h3>Seguimiento interno</h3>
      {loadError ? <p role="alert">No se pudo abrir el caso. <button type="button" className="pb-admin-button" onClick={() => setRevision(value => value + 1)}>Reintentar</button></p>
        : !record ? <p role="status">Cargando caso…</p> : <>
          <label className="pb-admin-field">Responsable
            <select value={record.assignedTo || ''} disabled={working} onChange={event => save('assign', event.target.value || null)}>
              <option value="">Sin asignar</option>
              {[...new Set([...(record.assignedTo ? [record.assignedTo] : []), ...record.admins])].map(name =>
                <option key={name} value={name}>@{name}</option>
              )}
            </select>
          </label>
          {kind === 'support' && <>
            {record.market ? <>
              <SupportMarket market={record.market} />
              <button type="button" className="pb-admin-button" disabled={working} onClick={() => save('link_market', null)}>Desvincular mercado</button>
            </> : <>
              <form className="pb-admin-tools" onSubmit={event => { event.preventDefault(); save('link_market', marketInput.trim()); }}>
                <label className="pb-admin-field">ID del mercado
                  <input inputMode="numeric" pattern="[0-9]+" value={marketInput} onChange={event => setMarketInput(event.target.value)} required disabled={working} />
                </label>
                <button type="submit" className="pb-admin-button" disabled={working || !/^[1-9]\d*$/.test(marketInput)}>Vincular mercado</button>
              </form>
              {!!record.recentMarkets?.length && <label className="pb-admin-field">Mercados recientes de la cuenta
                <select value="" disabled={working} onChange={event => setMarketInput(event.target.value)}>
                  <option value="">Elegir mercado…</option>
                  {record.recentMarkets.map(market => <option key={market.id} value={market.id}>#{market.id} · {market.question}</option>)}
                </select>
              </label>}
            </>}
          </>}
          <form className="pb-admin-case-note" onSubmit={event => { event.preventDefault(); save('note', note); }}>
            <label className="pb-admin-field">Nota privada para administradores
              <textarea rows={2} minLength={2} maxLength={4000} required value={note} disabled={working} onChange={event => setNote(event.target.value)} />
            </label>
            <button type="submit" className="pb-admin-button" disabled={working || note.trim().length < 2}>Guardar nota privada</button>
          </form>
          {record.notes.length > 0 && <ol className="pb-admin-case-notes">
            {record.notes.map(entry => <li key={entry.id}>
              <strong>@{entry.author}</strong> · {formatAdminMarketDate(entry.createdAt, { timeZone: 'America/Mexico_City' })} CDMX
              <p>{entry.body}</p>
            </li>)}
          </ol>}
        </>}
      {actionError && <p className="pb-admin-error" role="alert">{actionError}</p>}
    </section>
  );
}
