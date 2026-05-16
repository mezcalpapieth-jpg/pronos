import React, { useEffect, useState } from 'react';
import ChampionsLeagueHub from '@app/components/ChampionsLeagueHub.jsx';
import { findChampionsLeagueFinalMarket } from '@app/lib/championsLeague.js';
import { fetchMarkets } from '../lib/pointsApi.js';

export default function PointsChampionsLeaguePage() {
  const [finalMarket, setFinalMarket] = useState(null);
  const [loadingFinalMarket, setLoadingFinalMarket] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingFinalMarket(true);
    fetchMarkets({ status: 'active', category: 'deportes', limit: 2000, featured: 'all' })
      .then(markets => {
        if (!cancelled) setFinalMarket(findChampionsLeagueFinalMarket(markets));
      })
      .catch(() => {
        if (!cancelled) setFinalMarket(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingFinalMarket(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <ChampionsLeagueHub
      surfaceLabel="Points"
      finalMarket={finalMarket}
      finalMarketLoading={loadingFinalMarket}
    />
  );
}
