import React from 'react';
import { useT } from '../lib/i18n.js';

export default function Footer() {
  const t = useT();
  return (
    <footer style={{
      borderTop: '1px solid var(--border)',
      padding: '40px 48px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>PRONOS</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>BETA</span>
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textAlign: 'center' }}>
        {t('footer.copyright')}
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        <a href="/" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em', transition: 'color 0.2s' }}
          onMouseOver={e => e.target.style.color = 'var(--text-secondary)'}
          onMouseOut={e => e.target.style.color = 'var(--text-muted)'}
        >
          {t('footer.home')}
        </a>
        <a href="mailto:hola@pronos.io" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em', transition: 'color 0.2s' }}
          onMouseOver={e => e.target.style.color = 'var(--text-secondary)'}
          onMouseOut={e => e.target.style.color = 'var(--text-muted)'}
        >
          {t('footer.contact')}
        </a>
      </div>
    </footer>
  );
}
