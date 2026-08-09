/**
 * /points/video — the door Fabian walks through.
 *
 * Verifies the password server-side, flags the session, then hard-navigates
 * to the points home. The full reload is deliberate: it guarantees the fetch
 * interceptor is installed from main.jsx before any component mounts and
 * fires its first request, instead of racing a client-side route change.
 */
import React, { useEffect, useState } from 'react';

const ORANGE = '#FF5500';

export default function VideoDemoGate() {
  const [password, setPassword] = useState('');
  const [state, setState] = useState('checking');
  const [error, setError] = useState('');

  useEffect(() => {
    // Belt and braces: this page must never be indexed, whatever the
    // crawler ignores in robots.txt.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/video-access', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : { ok: false }))
      .then(data => { if (!cancelled) setState(data.ok ? 'unlocked' : 'locked'); })
      .catch(() => { if (!cancelled) setState('locked'); });
    return () => { cancelled = true; };
  }, []);

  async function enterDemo() {
    const { markDemoActive } = await import('./installDemoBackend.js');
    markDemoActive();
    window.location.href = '/points/';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setState('submitting');
    try {
      const res = await fetch('/api/video-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        await enterDemo();
        return;
      }
      setError(data.error || 'Contraseña incorrecta');
      setState('locked');
    } catch {
      setError('No se pudo verificar el acceso.');
      setState('locked');
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: '#080808',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif", padding: 24,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 380, width: '100%' }}>
        <div style={{ fontSize: 36, fontFamily: "'Bebas Neue', sans-serif", color: '#fff', letterSpacing: '0.05em', marginBottom: 8 }}>
          PRONOS
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: ORANGE, display: 'inline-block', marginBottom: -12 }} />
        </div>
        <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 36 }}>
          MODO GRABACIÓN
        </div>

        {state === 'unlocked' ? (
          <>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Ya tienes acceso. Todo lo que veas adentro es información inventada
              para grabar — no toca la base de datos real.
            </p>
            <button
              type="button"
              onClick={enterDemo}
              style={{
                width: '100%', padding: 14, background: ORANGE, color: '#fff',
                border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600,
                cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              }}
            >
              Entrar a Pronos
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>
              {state === 'checking' ? 'Verificando acceso...' : 'Ingresa la contraseña'}
            </div>

            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Contraseña"
              autoFocus
              disabled={state === 'checking' || state === 'submitting'}
              style={{
                width: '100%', padding: '14px 18px', background: 'rgba(255,255,255,0.04)',
                border: error ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12, color: '#fff', fontSize: 16,
                fontFamily: "'DM Sans', sans-serif", outline: 'none',
              }}
            />

            {error && (
              <div style={{ color: '#ef4444', fontSize: 13, marginTop: 10 }}>{error}</div>
            )}

            <button
              type="submit"
              disabled={state === 'checking' || state === 'submitting'}
              style={{
                marginTop: 20, width: '100%', padding: 14,
                background: state === 'submitting' ? '#333' : ORANGE, color: '#fff',
                border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600,
                cursor: state === 'submitting' ? 'wait' : 'pointer',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              {state === 'submitting' ? '...' : 'Entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
