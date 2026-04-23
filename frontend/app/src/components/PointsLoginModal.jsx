/**
 * PointsLoginModal — three-step login for the points-app.
 *
 * Steps:
 *   1. email        — user types email, we request an OTP
 *   2. code         — user enters 6-digit code, we verify + mint session
 *   3. username     — if first login, user picks a username
 *
 * The modal closes automatically when the user is fully signed in (step
 * reaches "done" and has a username). On outside click / ESC it resets
 * to step 1.
 *
 * Error messages come from short backend codes (e.g. `invalid_code`,
 * `username_taken`) mapped here to Spanish-language strings. Keeping
 * messages in this component means no i18n churn on the server.
 */

import React, { useEffect, useRef, useState } from 'react';
import { usePointsAuth } from '../lib/pointsAuth.js';

const ERRORS = {
  invalid_email:          'Ingresa un correo válido.',
  rate_limited:           'Demasiados intentos. Espera un minuto e intenta de nuevo.',
  turnkey_unavailable:    'Servicio de autenticación no disponible. Intenta más tarde.',
  invalid_code:           'Código incorrecto o expirado. Revisa tu correo.',
  session_failed:         'No se pudo establecer la sesión. Intenta de nuevo.',
  session_config_missing: 'Falta configurar el servidor. Avisa al equipo de Pronos.',
  invalid_input:          'Datos inválidos. Refresca e intenta de nuevo.',
  db_unavailable:         'Error del servidor. Intenta más tarde.',
  server_error:           'Error del servidor. Intenta más tarde.',
  invalid_username:       'Usuario inválido. 3–20 letras/números, debe empezar con letra.',
  username_taken:         'Ese usuario ya está en uso.',
  already_set:            'Ya tienes un usuario asignado.',
  not_authenticated:      'Tu sesión expiró. Vuelve a iniciar sesión.',
  default:                'Algo salió mal. Intenta de nuevo.',
};

function humanError(code, detail) {
  const base = code && ERRORS[code]
    ? ERRORS[code]
    : (code ? `${ERRORS.default} (${code})` : ERRORS.default);
  // Append server-provided detail when present (preview debugging aid;
  // strip this once we're confident in the flow).
  if (detail) return `${base}\n\n${detail}`;
  return base;
}

export default function PointsLoginModal({ open, onClose, initialStep = 'email' }) {
  const { initOtp, verifyOtp, setUsername, refresh, user } = usePointsAuth();

  // `initialStep` lets a caller (e.g. MVP App.jsx) jump straight to the
  // username step when the user is already authed but missing a username.
  // Defaults to 'email' so existing callers behave unchanged.
  const [step, setStep] = useState(initialStep);    // 'email' | 'code' | 'username' | 'done'
  const [email, setEmail]   = useState('');
  const [code, setCode]     = useState('');
  const [uname, setUname]   = useState('');
  const [otpId, setOtpId]   = useState(null);
  const [suborgId, setSuborgId] = useState(null);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState('');
  const firstFieldRef = useRef(null);

  // Reset when the modal closes so the next open starts clean.
  useEffect(() => {
    if (!open) {
      setStep(initialStep);
      setEmail('');
      setCode('');
      setUname('');
      setOtpId(null);
      setSuborgId(null);
      setPending(false);
      setErr('');
    } else {
      // Small delay so the input exists before focusing.
      const id = setTimeout(() => firstFieldRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open, initialStep]);

  // ESC closes the modal.
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmitEmail(e) {
    e?.preventDefault();
    setErr('');
    setPending(true);
    try {
      const { otpId: id, suborgId: sub } = await initOtp(email.trim().toLowerCase());
      setOtpId(id);
      setSuborgId(sub);
      setStep('code');
      setTimeout(() => firstFieldRef.current?.focus(), 50);
    } catch (e) {
      setErr(humanError(e.code || e.message, e.detail));
    } finally {
      setPending(false);
    }
  }

  async function handleSubmitCode(e) {
    e?.preventDefault();
    setErr('');
    setPending(true);
    try {
      const r = await verifyOtp({ otpId, suborgId, code: code.trim(), email: email.trim().toLowerCase() });
      await refresh();
      if (r.needsUsername) {
        setStep('username');
        setTimeout(() => firstFieldRef.current?.focus(), 50);
      } else {
        setStep('done');
        onClose?.();
      }
    } catch (e) {
      setErr(humanError(e.code || e.message, e.detail));
    } finally {
      setPending(false);
    }
  }

  async function handleSubmitUsername(e) {
    e?.preventDefault();
    setErr('');
    setPending(true);
    try {
      await setUsername(uname.trim().toLowerCase());
      await refresh();
      setStep('done');
      onClose?.();
    } catch (e) {
      setErr(humanError(e.code || e.message, e.detail));
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        width: 'min(420px, 92vw)',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '32px 28px',
        boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
        fontFamily: 'var(--font-body)',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em',
          color: 'var(--green)', textTransform: 'uppercase', marginBottom: 6,
        }}>
          PRONOS
        </div>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontSize: 24,
          color: 'var(--text-primary)', marginBottom: 18,
          textTransform: 'uppercase', letterSpacing: '0.02em',
        }}>
          {step === 'email' && 'Crear cuenta o entrar'}
          {step === 'code' && 'Código enviado'}
          {step === 'username' && 'Elige tu usuario'}
        </h2>

        {step === 'email' && (
          <form onSubmit={handleSubmitEmail}>
            <label style={{
              display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--text-muted)', letterSpacing: '0.1em',
              textTransform: 'uppercase', marginBottom: 6,
            }}>
              Correo electrónico
            </label>
            <input
              ref={firstFieldRef}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="tu@correo.com"
              disabled={pending}
              style={inputStyle}
            />
            <p style={helperStyle}>
              Te enviaremos un código de 6 dígitos. Sin contraseña.
            </p>
            {err && <div style={errorStyle}>{err}</div>}
            <button type="submit" disabled={pending || !email} style={btnPrimaryStyle}>
              {pending ? 'Enviando…' : 'Enviar código'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleSubmitCode}>
            <label style={{
              display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--text-muted)', letterSpacing: '0.1em',
              textTransform: 'uppercase', marginBottom: 6,
            }}>
              Código de verificación
            </label>
            <input
              ref={firstFieldRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="123456"
              disabled={pending}
              style={{ ...inputStyle, letterSpacing: '0.5em', textAlign: 'center', fontSize: 22 }}
            />
            <p style={helperStyle}>
              Revisa tu correo ({email}). El código expira en 5 minutos.
            </p>
            {err && <div style={errorStyle}>{err}</div>}
            <button type="submit" disabled={pending || code.length !== 6} style={btnPrimaryStyle}>
              {pending ? 'Verificando…' : 'Verificar código'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('email'); setErr(''); setCode(''); }}
              disabled={pending}
              style={btnGhostStyle}
            >
              Cambiar correo
            </button>
          </form>
        )}

        {step === 'username' && (
          <form onSubmit={handleSubmitUsername}>
            <label style={{
              display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--text-muted)', letterSpacing: '0.1em',
              textTransform: 'uppercase', marginBottom: 6,
            }}>
              Usuario
            </label>
            <input
              ref={firstFieldRef}
              type="text"
              value={uname}
              onChange={(e) => setUname(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
              placeholder="mi_usuario"
              disabled={pending}
              maxLength={20}
              style={inputStyle}
            />
            <p style={helperStyle}>
              3–20 caracteres · letras, números y _ · no se puede cambiar después.
            </p>
            {err && <div style={errorStyle}>{err}</div>}
            <button type="submit" disabled={pending || uname.length < 3} style={btnPrimaryStyle}>
              {pending ? 'Guardando…' : 'Crear cuenta'}
            </button>
            <p style={{ ...helperStyle, marginTop: 10, fontSize: 10 }}>
              🎁 Recibes 500 MXNP de bienvenida al crear tu usuario.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Inline styles (keep the modal self-contained) ───────────────────────────
const inputStyle = {
  width: '100%',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '12px 14px',
  fontFamily: 'var(--font-body)',
  fontSize: 15,
  color: 'var(--text-primary)',
  outline: 'none',
  marginBottom: 8,
};

const helperStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--text-muted)',
  lineHeight: 1.5,
  marginBottom: 12,
};

const errorStyle = {
  background: 'rgba(239,68,68,0.1)',
  border: '1px solid rgba(239,68,68,0.3)',
  color: 'var(--red, #ef4444)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  padding: '10px 12px',
  borderRadius: 8,
  marginBottom: 12,
};

const btnPrimaryStyle = {
  width: '100%',
  padding: '12px 16px',
  background: 'var(--green)',
  color: '#000',
  border: 'none',
  borderRadius: 10,
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  transition: 'opacity 0.15s',
};

const btnGhostStyle = {
  width: '100%',
  marginTop: 10,
  padding: '10px 16px',
  background: 'transparent',
  color: 'var(--text-muted)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
