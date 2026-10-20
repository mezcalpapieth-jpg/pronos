import React, { useEffect, useState } from 'react';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useLang } from '@app/lib/i18n.js';
import { pointsExecution, publicErrorMessage } from '../lib/pointsApi.js';
import { emitPointsRefresh } from '../lib/pointsLiveRefresh.js';
import { usePointsExecution } from '../lib/PointsExecution.jsx';

export default function PendingTradeNotice() {
  const { authenticated, user } = usePointsAuth();
  const { durableTrades } = usePointsExecution();
  const lang = useLang(), en = lang === 'en';
  const [pending, setPending] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    if (!authenticated || !durableTrades) { setPending(null); setMessage(''); return undefined; }
    let canceled = false, sequence = 0;
    async function load() {
      const current = ++sequence;
      try {
        const state = await pointsExecution.pendingTrade();
        if (!canceled && current === sequence) setPending(state);
      } catch { /* Keep the saved request visible through temporary outages. */ }
    }
    load();
    window.addEventListener('pronos:trade-request', load);
    window.addEventListener('storage', load);
    const interval = window.setInterval(load, 10000);
    return () => { canceled = true; window.clearInterval(interval);
      window.removeEventListener('pronos:trade-request', load); window.removeEventListener('storage', load); };
  }, [authenticated, user?.suborgId, durableTrades]);
  if (!authenticated || !durableTrades || (!pending && !message)) return null;
  const completed = ['confirmed','indexed','rejected','reverted'].includes(pending?.status);
  async function resume() {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const result = await pointsExecution.resumeTrade();
      setPending(await pointsExecution.pendingTrade());
      if (result?.ok) {
        setMessage(en ? 'Trade confirmed. Your balance and history are updating.' : 'Operación confirmada. Tu saldo e historial se están actualizando.');
        emitPointsRefresh({ source: 'trade-recovery' });
      }
    } catch (error) {
      setMessage(publicErrorMessage(error, lang));
      try { setPending(await pointsExecution.pendingTrade()); } catch { /* Retain pending state. */ }
    } finally { setBusy(false); }
  }
  return <aside aria-live="polite" style={{ maxWidth: 1100, margin: '12px auto', padding: '12px 20px',
    border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card)' }}>
    <p style={{ margin: '0 0 8px' }}>{message || (pending?.status === 'indexed'
      ? (en ? 'Your trade is confirmed and your history is updated.' : 'Tu operación está confirmada y tu historial está actualizado.')
      : pending?.status === 'confirmed' ? (en ? 'Your trade is confirmed. Your history is updating.' : 'Tu operación está confirmada. El historial se está actualizando.')
        : ['rejected','reverted'].includes(pending?.status) ? (en ? 'This trade did not complete. Acknowledge to continue.' : 'Esta operación no se completó. Confirma para continuar.')
          : pending?.status === 'needs_reconciliation' ? (en ? 'We are checking the outcome of your trade. You can check again here.' : 'Estamos revisando el resultado de tu operación. Puedes volver a revisarlo aquí.')
        : (en ? 'You have a pending trade. Check it here before placing another one.' : 'Tienes una operación pendiente. Revísala aquí antes de enviar otra.'))}</p>
    {pending && <button className="btn-primary" disabled={busy} onClick={resume}>
      {busy ? (en ? 'Checking…' : 'Revisando…') : completed ? (en ? 'Acknowledge' : 'Entendido') : (en ? 'Check and resume' : 'Revisar y continuar')}
    </button>}
    {!pending && <button onClick={() => setMessage('')}>{en ? 'Close' : 'Cerrar'}</button>}
  </aside>;
}
