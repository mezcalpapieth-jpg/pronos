import React from 'react';
import { setLang, useT } from '../lib/i18n.js';

export default function LegalLanguageSwitch({ currentLang }) {
  const t = useT();

  return (
    <div
      aria-label={t('legal.language.aria')}
      role="group"
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 8,
        marginBottom: 18,
      }}
    >
      {['es', 'en'].map((lang) => {
        const active = currentLang === lang;
        return (
          <button
            key={lang}
            type="button"
            onClick={() => setLang(lang)}
            aria-pressed={active}
            style={{
              background: active ? 'var(--orange, #FF5500)' : 'transparent',
              border: `1px solid ${active ? 'var(--orange, #FF5500)' : 'var(--border, rgba(255,255,255,0.18))'}`,
              borderRadius: 999,
              color: active ? '#050505' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono, ui-monospace)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.08em',
              padding: '8px 12px',
              textTransform: 'uppercase',
            }}
          >
            {t(`legal.language.${lang}`)}
          </button>
        );
      })}
    </div>
  );
}
