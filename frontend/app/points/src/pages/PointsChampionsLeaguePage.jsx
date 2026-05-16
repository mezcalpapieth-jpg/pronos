import React, { useEffect, useState } from 'react';
import ChampionsLeagueHub from '@app/components/ChampionsLeagueHub.jsx';
import { findChampionsLeagueFinalMarkets } from '@app/lib/championsLeague.js';
import { fetchMarkets } from '../lib/pointsApi.js';
import PointsBuyModal from '../components/PointsBuyModal.jsx';

export default function PointsChampionsLeaguePage() {
  const [finalMarkets, setFinalMarkets] = useState({ winner: null, goals: null, mvp: null });
  const [loadingFinalMarket, setLoadingFinalMarket] = useState(true);
  const [bet, setBet] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingFinalMarket(true);
    fetchMarkets({ status: 'active', category: 'deportes', limit: 2000, featured: 'all' })
      .then(markets => {
        if (!cancelled) setFinalMarkets(findChampionsLeagueFinalMarkets(markets));
      })
      .catch(() => {
        if (!cancelled) setFinalMarkets({ winner: null, goals: null, mvp: null });
      })
      .finally(() => {
        if (!cancelled) setLoadingFinalMarket(false);
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <>
      <ChampionsLeagueHub
        surfaceLabel="Points"
        finalMarket={finalMarkets.winner}
        finalMarkets={finalMarkets}
        finalMarketLoading={loadingFinalMarket}
        onFinalBet={setBet}
      />
      {bet && (
        <PointsBuyModal
          open={!!bet}
          variant="drawer"
          market={bet.market}
          outcomeIndex={bet.outcomeIndex}
          outcomeLabel={bet.outcome}
          onClose={() => setBet(null)}
          onSuccess={() => {
            setBet(null);
            setRefreshKey(key => key + 1);
          }}
        />
      )}
    </>
  );
}
