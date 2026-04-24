import React from 'react';
import Ticker from '../components/Ticker.jsx';
import Nav from '../components/Nav.jsx';
import Hero from '../components/Hero.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import MarketsGrid from '../components/MarketsGrid.jsx';
import HowItWorks from '../components/HowItWorks.jsx';
import Footer from '../components/Footer.jsx';
import { useT } from '../lib/i18n.js';

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
          <MarketsGrid activeFilter="trending" />
        </section>

        <HowItWorks onOpenLogin={onOpenLogin} />
      </main>

      <Footer />
    </>
  );
}
