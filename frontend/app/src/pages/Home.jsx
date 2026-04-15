import React, { useState } from 'react';
import Ticker from '../components/Ticker.jsx';
import Nav from '../components/Nav.jsx';
import Hero from '../components/Hero.jsx';
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

      {/* Category bar — sticky right below the nav, like pronos.io */}
      <div className="category-bar-sticky">
        <CategoryBar activeFilter={activeFilter} onFilter={setActiveFilter} />
      </div>

      <main>
        <Hero />

        <section id="markets" style={{ padding: '40px 48px 60px', maxWidth: 1280, margin: '0 auto' }}>
          <MarketsGrid activeFilter={activeFilter} />
        </section>

        <HowItWorks />
      </main>

      <Footer />
    </>
  );
}
