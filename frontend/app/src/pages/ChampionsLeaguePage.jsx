import React, { useEffect, useState } from 'react';
import Nav from '../components/Nav.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import Footer from '../components/Footer.jsx';
import ChampionsLeagueHub from '../components/ChampionsLeagueHub.jsx';
import BetModal from '../components/BetModal.jsx';
import { findChampionsLeagueFinalMarkets } from '../lib/championsLeague.js';

const CHAIN_ID = Number(import.meta.env.VITE_ONCHAIN_CHAIN_ID || 42161);

export default function ChampionsLeaguePage({ onOpenLogin }) {
  const [finalMarkets, setFinalMarkets] = useState({ winner: null, goals: null, mvp: null });
  const [loadingFinalMarket, setLoadingFinalMarket] = useState(true);
  const [bet, setBet] = useState(null);

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
          setFinalMarkets(findChampionsLeagueFinalMarkets(data?.markets || []));
        }
      } catch {
        if (!cancelled) setFinalMarkets({ winner: null, goals: null, mvp: null });
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
        finalMarket={finalMarkets.winner}
        finalMarkets={finalMarkets}
        finalMarketLoading={loadingFinalMarket}
        onFinalBet={setBet}
      />
      {bet && (
        <BetModal
          open={!!bet}
          variant="drawer"
          onClose={() => setBet(null)}
          outcome={bet.outcome}
          outcomePct={bet.outcomePct}
          outcomeIndex={bet.outcomeIndex}
          marketId={bet.market?.id}
          marketTitle={bet.market?.question}
          market={bet.market}
          onOpenLogin={onOpenLogin}
        />
      )}
      <Footer />
    </>
  );
}
