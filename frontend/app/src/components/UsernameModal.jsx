import React, { useState } from 'react';

const API = '/api/user';

export default function UsernameModal({ privyId, onComplete }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isValid = /^[a-zA-Z0-9_]{3,20}$/.test(username);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privyId, username }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Error al guardar');
      } else {
        onComplete(data.username);
      }
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '48px 40px',
        width: '100%',
        maxWidth: 420,
        textAlign: 'center',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>

        {/* Logo */}
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 32,
          fontWeight: 900,
          letterSpacing: '0.05em',
          color: 'var(--text-primary)',
          marginBottom: 24,
        }}>
          PRONOS<span style={{ color: 'var(--green)' }}>*</span>
        </div>

        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 26,
          fontWeight: 800,
          color: 'var(--text-primary)',
          marginBottom: 10,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          Elige tu username
        </h2>

        <p style={{
          color: 'var(--text-secondary)',
          fontSize: 14,
          lineHeight: 1.6,
          marginBottom: 36,
        }}>
          Este será tu identidad en Pronos.<br />
          No lo podrás cambiar después.
        </p>

        <form onSubmit={handleSubmit}>
          {/* Input */}
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <span style={{
              position: 'absolute', left: 16, top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--green)',
              fontFamily: 'var(--font-mono)',
              fontSize: 18, fontWeight: 700,
              pointerEvents: 'none',
            }}>@</span>
            <input
              type="text"
              value={username}
              onChange={e => { setUsername(e.target.value); setError(''); }}
              placeholder="tu_username"
              maxLength={20}
              autoFocus
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'var(--surface2)',
                border: `1.5px solid ${
                  error ? 'var(--red)' :
                  isValid && username ? 'var(--green)' :
                  'var(--border)'
                }`,
                borderRadius: 12,
                padding: '14px 16px 14px 40px',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 17,
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
            />
          </div>

          {/* Hint */}
          <p style={{
            color: username && !isValid ? 'var(--gold)' : 'var(--text-muted)',
            fontSize: 12,
            marginBottom: 24,
            textAlign: 'left',
            fontFamily: 'var(--font-mono)',
          }}>
            3–20 caracteres · letras, números y _
          </p>

          {/* Error */}
          {error && (
            <div style={{
              color: 'var(--red)',
              fontSize: 13,
              marginBottom: 16,
              background: 'var(--red-dim)',
              padding: '10px 16px',
              borderRadius: 8,
              fontFamily: 'var(--font-mono)',
            }}>
              {error === 'Username already taken'
                ? '❌ Ese username ya está en uso'
                : `❌ ${error}`}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!isValid || loading}
            style={{
              width: '100%',
              padding: '15px 24px',
              borderRadius: 12,
              background: isValid && !loading ? 'var(--green)' : 'var(--surface3)',
              color: isValid && !loading ? '#000' : 'var(--text-muted)',
              fontFamily: 'var(--font-display)',
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              border: 'none',
              cursor: isValid && !loading ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              marginTop: 4,
            }}
          >
            {loading ? 'Guardando...' : 'Entrar a Pronos →'}
          </button>
        </form>
      </div>
    </div>
  );
}
