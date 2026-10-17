import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLang } from '@app/lib/i18n.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { authorizeDelegation, fetchDelegationStatus, revokeDelegation, publicErrorMessage } from '../lib/pointsApi.js';

export default function PointsDelegationModal({ open, onClose, onAuthorized, manage = false }) {
  const en = useLang() === 'en';
  const { user, initOtp, verifyOtp } = usePointsAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const [intent, setIntent] = useState(null);
  const [otp, setOtp] = useState(null);
  const [code, setCode] = useState('');
  const [reauth, setReauth] = useState(false);
  const dialog = useRef(null);
  const title = useId();
  const text = (es, eng) => en ? eng : es;
  useEffect(() => {
    if (!open) return undefined;
    let canceled = false;
    setStatus(null); setError(''); setIntent(null); setOtp(null); setCode(''); setReauth(false);
    fetchDelegationStatus().then(value => { if (!canceled) setStatus(value); }).catch(() => {
      if (!canceled) setError(en ? 'Could not check authorization. Try again.' : 'No pudimos consultar tu autorización. Intenta de nuevo.');
    });
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { canceled = true; previous?.focus?.(); };
  }, [open, en]);
  if (!open) return null;

  async function run(action) {
    setBusy(true); setError(''); setIntent(action);
    try {
      const result = await (action === 'revoke' ? revokeDelegation() : authorizeDelegation());
      setStatus(await fetchDelegationStatus());
      setReauth(false); setOtp(null); setCode(''); setIntent(null);
      if (action === 'authorize') onAuthorized?.(result);
    } catch (e) {
      if (e.code === 'delegation_owner_login_required') setReauth(true);
      else setError(publicErrorMessage(e, en ? 'en' : 'es'));
    } finally { setBusy(false); }
  }
  async function sendCode() {
    setBusy(true); setError('');
    try {
      const result = await initOtp(user.email);
      if (result.suborgId !== user.suborgId) throw new Error('account_mismatch');
      setOtp(result);
    } catch (e) { setError(publicErrorMessage(e, en ? 'en' : 'es')); }
    finally { setBusy(false); }
  }
  async function confirmCode(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await verifyOtp({ ...otp, code: code.trim(), email: user.email });
      if (result.suborgId !== user.suborgId) throw new Error('account_mismatch');
      await run(intent || 'authorize');
    } catch (e) { setError(publicErrorMessage(e, en ? 'en' : 'es')); }
    finally { setBusy(false); }
  }
  const button = { padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text-primary)', cursor: busy ? 'wait' : 'pointer' };
  const active = status?.active;
  return createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 10020, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(0,0,0,.65)' }}
    onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget && !busy) onClose?.(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={title} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose?.(); }
        if (event.key !== 'Tab') return;
        const elements = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
      }}
      style={{ maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 26, borderRadius: 16, border: '1px solid var(--border)', background: 'var(--surface1)', color: 'var(--text-primary)' }}>
      <h2 id={title} style={{ marginTop: 0 }}>{text('Autorización de operaciones', 'Trading authorization')}</h2>
      {status == null && !error && <p role="status">{text('Consultando…', 'Checking…')}</p>}
      {active && <p role="status">{text('Activa · sin vencimiento', 'Active · no expiry')}</p>}
      <p>{text('Autoriza a Pronos a firmar tus compras, ventas y cobros en los mercados de prueba autorizados, sin confirmar cada operación.', 'Allow Pronos to sign buys, sells and redemptions in authorized test markets without confirming every trade.')}</p>
      <ul style={{ paddingLeft: 20, lineHeight: 1.6 }}>
        <li>{text('Permanece activa hasta que la revoques aquí.', 'Stays active until you revoke it here.')}</li>
        <li>{text('Solo opera en los contratos autorizados de Arbitrum Sepolia. No permite retiros, transferencias externas ni administrar tu cuenta.', 'Only authorized Arbitrum Sepolia contracts. No withdrawals, external transfers or account administration.')}</li>
        <li>{text('No hay un límite diario de gasto. Cada orden conserva su protección de precio.', 'There is no daily spending cap. Each order retains its price protection.')}</li>
        <li>{text('Si agregamos mercados fuera de esta autorización, te pediremos ampliarla.', 'If we add markets outside this authorization, we will ask you to extend it.')}</li>
      </ul>
      {reauth && <div style={{ padding: 14, background: 'var(--surface2)', borderRadius: 8 }}>
        <p>{text('Verifica tu correo para cambiar este permiso. Esta verificación no se pide para cada operación.', 'Verify your email to change this permission. This is not required for each trade.')}</p>
        {!otp ? <button style={button} disabled={busy} onClick={sendCode}>{text('Enviar código', 'Send code')}</button>
          : <form onSubmit={confirmCode}>
            <label>{text('Código enviado a', 'Code sent to')} {user?.email}<input autoFocus value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,12}" required disabled={busy} style={{ display: 'block', margin: '10px 0', padding: 10, width: '100%', boxSizing: 'border-box' }} /></label>
            <button style={button} disabled={busy}>{text('Verificar y continuar', 'Verify and continue')}</button>
          </form>}
      </div>}
      {error && <p role="alert" style={{ color: 'var(--danger, #ef4444)' }}>{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
        <button style={button} disabled={busy} onClick={onClose}>{text('Cerrar', 'Close')}</button>
        {!reauth && status && (!active || status.needsRefresh) && <button className="btn-primary" style={button} disabled={busy || !status.enabled} onClick={() => run('authorize')}>
          {busy ? text('Autorizando…', 'Authorizing…') : active ? text('Ampliar autorización', 'Extend authorization') : text('Autorizar operaciones', 'Authorize trading')}
        </button>}
        {!reauth && manage && status?.policyId && <button style={button} disabled={busy} onClick={() => run('revoke')}>{text('Revocar autorización', 'Revoke authorization')}</button>}
      </div>
    </div>
  </div>, document.body);
}
