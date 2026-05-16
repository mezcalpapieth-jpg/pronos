import React, { useEffect, useState } from 'react';
import Nav from '../components/Nav.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import Footer from '../components/Footer.jsx';
import ChampionsLeagueHub from '../components/ChampionsLeagueHub.jsx';
import { findChampionsLeagueFinalMarket } from '../lib/championsLeague.js';

const CHAIN_ID = Number(import.meta.env.VITE_ONCHAIN_CHAIN_ID || 42161);

export default function ChampionsLeaguePage({ onOpenLogin }) {
  const [finalMarket, setFinalMarket] = useState(null);
  const [loadingFinalMarket, setLoadingFinalMarket] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingFinalMarket(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/protocol/markets?status=active&limit=200&chainId=${CHAIN_ID}`,
          { credentials: 'include' },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'load_failed');
        if (!cancelled) {
          setFinalMarket(findChampionsLeagueFinalMarket(data?.markets || []));
        }
      } catch {
        if (!cancelled) setFinalMarket(null);
      } finally {
        if (!cancelled) setLoadingFinalMarket(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <div className="category-bar-sticky">
        <CategoryBar />
      </div>
      <ChampionsLeagueHub
        surfaceLabel="MVP on-chain"
        finalMarket={finalMarket}
        finalMarketLoading={loadingFinalMarket}
      />
      <Footer />
    </>
  );
}
