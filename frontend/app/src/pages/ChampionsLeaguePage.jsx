import React from 'react';
import Nav from '../components/Nav.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import Footer from '../components/Footer.jsx';
import ChampionsLeagueHub from '../components/ChampionsLeagueHub.jsx';

export default function ChampionsLeaguePage({ onOpenLogin }) {
  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <div className="category-bar-sticky">
        <CategoryBar />
      </div>
      <ChampionsLeagueHub surfaceLabel="MVP on-chain" />
      <Footer />
    </>
  );
}
