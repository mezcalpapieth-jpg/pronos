import React, { useState, useEffect } from 'react';
import { useT } from '../lib/i18n.js';

const CORRECT = 'mezcal';
const STORAGE_KEY = 'pronos-mvp-access';

export default function PasswordGate({ children }) {
  const t = useT();
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(STORAGE_KEY) === '1') setUnlocked(true);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim().toLowerCase() === CORRECT) {
      sessionStorage.setItem(STORAGE_KEY, '1');
      setUnlocked(true);
    } else {
      setError(true);
      setTimeout(() => setError(false), 1500);
    }
  };

  if (unlocked) return children;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#080808',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <form onSubmit={handleSubmit} style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: '36px', fontFamily: "'Bebas Neue', sans-serif", color: '#fff', letterSpacing: '0.05em', marginBottom: '8px' }}>
          PRONOS
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#FF5500', display: 'inline-block', marginBottom: '-12px' }} />
        </div>
        <div style={{ fontSize: '11px', fontFamily: "'DM Mono', monospace", letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: '40px' }}>
          {t('gate.badge')}
        </div>

        <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)' }}>{t('gate.title')}</div>
        <div style={{ height: '16px' }} />

        <input
          type="password"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t('gate.password')}
          autoFocus
          style={{
            width: '100%', padding: '14px 18px',
            background: 'rgba(255,255,255,0.04)',
            border: error ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px', color: '#fff', fontSize: '16px',
            fontFamily: "'DM Sans', sans-serif",
            outline: 'none', transition: 'border 0.2s',
          }}
        />

        {error && (
          <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '10px' }}>
            {t('gate.wrong')}
          </div>
        )}

        <button type="submit" style={{
          marginTop: '20px', width: '100%', padding: '14px',
          background: '#FF5500', color: '#fff', border: 'none',
          borderRadius: '12px', fontSize: '15px', fontWeight: 600,
          cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
        }}>
          {t('gate.enter')}
        </button>
      </form>
    </div>
  );
}
