import React, { useState } from 'react';
import Ticker from '../components/Ticker.jsx';
import Nav from '../components/Nav.jsx';
import Hero from '../components/Hero.jsx';
import FeaturedStrip from '../components/FeaturedStrip.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import MarketsGrid from '../components/MarketsGrid.jsx';
import HowItWorks from '../components/HowItWorks.jsx';
import Footer from '../components/Footer.jsx';
import { useT } from '../lib/i18n.js';

export default function Home() {
  const t = useT();
  const [activeFilter, setActiveFilter] = useState('trending');

  return (
    <>
      {/* MVP Banner */}
      <div className="mvp-banner">
        {t('home.banner')}
      </div>

      <Ticker />
      <Nav />

      <main>
        <Hero />

        {/* Featured markets carousel — sticky just below the nav */}
        <FeaturedStrip />

        <section id="markets" style={{ padding: '48px 48px 60px', maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 8 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 3vw, 40px)', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
              {t('home.markets')}
            </h2>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>{t('home.live')}</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32 }}>
            {t('home.subtitle')}
          </p>

          <CategoryBar activeFilter={activeFilter} onFilter={setActiveFilter} />

          <div style={{ marginTop: 32 }}>
            <MarketsGrid activeFilter={activeFilter} />
          </div>
        </section>

        <HowItWorks />
      </main>

      <Footer />
    </>
  );
}
