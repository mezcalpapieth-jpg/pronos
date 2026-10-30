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

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
        <FooterLink href="/">{t('footer.home')}</FooterLink>
        <FooterLink href="/privacy">{t('footer.privacy') || 'Privacidad'}</FooterLink>
        <FooterLink href="/terms">{t('footer.terms') || 'Términos'}</FooterLink>
      </div>
      <address style={{ width: '100%', boxSizing: 'border-box', fontStyle: 'normal', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', marginBottom: 12 }}>{t('footer.contact')}</div>
        <div style={{ display: 'flex', gap: '12px 24px', flexWrap: 'wrap' }}>
          <FooterLink href="https://www.instagram.com/pronos.latam/">Instagram · @pronos.latam</FooterLink>
          <FooterLink href="https://www.tiktok.com/@pronosmarkets">TikTok · @pronosmarkets</FooterLink>
          <FooterLink href="https://x.com/pronos_io">X · @pronos_io</FooterLink>
          <FooterLink href="mailto:hola@pronos.io">hola@pronos.io</FooterLink>
        </div>
      </address>
    </footer>
  );
}

function FooterLink({ href, children }) {
  const isExternal = href.startsWith('mailto:') || href.startsWith('http');
  const baseStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--text-muted)',
    letterSpacing: '0.06em',
    transition: 'color 0.2s',
    textDecoration: 'none',
  };
  return (
    <a
      href={href}
      style={baseStyle}
      onMouseOver={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
      onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
      {...(isExternal && !href.startsWith('mailto:') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  );
}
