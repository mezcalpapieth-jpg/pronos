import React, { useState } from 'react';
import Ticker from '../components/Ticker.jsx';
import Nav from '../components/Nav.jsx';
import Hero from '../components/Hero.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import MarketsGrid from '../components/MarketsGrid.jsx';
import HowItWorks from '../components/HowItWorks.jsx';
import Footer from '../components/Footer.jsx';

export default function Home() {
  const [activeFilter, setActiveFilter] = useState('trending');

  return (
    <>
      {/* MVP Banner */}
      <div className="mvp-banner">
        ⚡ BETA — Mercados en vivo · Powered by Polymarket · Trading con USDC real
      </div>

      <Ticker />
      <Nav />

      <main>
        <Hero />

        <section id="markets" style={{ padding: '60px 48px', maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 8 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 3vw, 40px)', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
              Mercados
            </h2>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>EN VIVO</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32 }}>
            Predicciones en tiempo real de Polymarket + mercados locales.
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
