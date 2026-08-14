import React from 'react';
import Ticker from '../components/Ticker.jsx';
import Nav from '../components/Nav.jsx';
import Hero from '../components/Hero.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import MarketsGrid from '../components/MarketsGrid.jsx';
import HowItWorks from '../components/HowItWorks.jsx';
import Footer from '../components/Footer.jsx';
import { useT } from '../lib/i18n.js';

// Same partner list the points-app surfaces — Turnkey/Bitso/MXNB/Chainlink.
// Inline so the MVP doesn't have to thread a new shared component file.
const PARTNERS = [
  { name: 'Turnkey',   href: 'https://turnkey.com', roleKey: 'points.partners.turnkey.role',   descKey: 'points.partners.turnkey.desc' },
  { name: 'Bitso',     href: 'https://bitso.com',   roleKey: 'points.partners.bitso.role',     descKey: 'points.partners.bitso.desc' },
  { name: 'MXNB',      href: 'https://mxnb.mx',     roleKey: 'points.partners.mxnb.role',      descKey: 'points.partners.mxnb.desc' },
  { name: 'Chainlink', href: 'https://chain.link',  roleKey: 'points.partners.chainlink.role', descKey: 'points.partners.chainlink.desc' },
];

function Partners() {
  const t = useT();
  return (
    <section id="partners" style={{
      padding: '48px 48px 72px',
      maxWidth: 1280,
      margin: '0 auto',
      borderTop: '1px solid var(--border)',
    }}>
      <div className="section-header" style={{ textAlign: 'center', marginBottom: 32 }}>
        <div className="section-eyebrow">{t('points.partners.eyebrow')}</div>
        <div className="section-title">{t('points.partners.title')}</div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
        maxWidth: 960,
        margin: '0 auto',
      }}>
        {PARTNERS.map(p => (
          <a
            key={p.name}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block',
              padding: '20px 22px',
              background: 'var(--surface1)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              textDecoration: 'none',
              transition: 'border-color 0.18s, transform 0.18s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--green)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              letterSpacing: '0.04em',
              color: 'var(--text-primary)',
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              {p.name}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              color: 'var(--green)',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}>
              {t(p.roleKey)}
            </div>
            <p style={{
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.55,
              margin: 0,
            }}>
              {t(p.descKey)}
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}

export default function Home({ onOpenLogin }) {
  const t = useT();

  return (
    <>
      {/* MVP Banner */}
      <div className="mvp-banner">
        {t('home.banner')}
      </div>

      <Ticker />
      <Nav onOpenLogin={onOpenLogin} />

      {/* Category bar — sticky; clicking a tab routes to /c/<slug> */}
      <div className="category-bar-sticky">
        <CategoryBar />
      </div>

      <main>
        <Hero onOpenLogin={onOpenLogin} />

        <section id="markets" style={{ padding: '40px 48px 60px', maxWidth: 1280, margin: '0 auto' }}>
          <MarketsGrid activeFilter="trending" onOpenLogin={onOpenLogin} />
        </section>

        <HowItWorks onOpenLogin={onOpenLogin} />

        <Partners />
      </main>

      <Footer />
    </>
  );
}
