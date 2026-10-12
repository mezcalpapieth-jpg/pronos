import React, { useEffect, useState } from 'react';
import PointsTicker from './PointsTicker.jsx';
import { fetchStockAssets, stocksEnabled } from '../lib/stockApi.js';

// Reuse the existing ticker markup/styles above the Pronos header. The backend
// metadata cache also serves the list/detail polls.
export default function StockLiveTicker() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!stocksEnabled) return;
    let alive = true;
    async function load() {
      if (document.visibilityState === 'hidden') return;
      try {
        const result = await fetchStockAssets();
        if (alive) { setData(result); setFailed(false); }
      } catch { if (alive) setFailed(true); }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!stocksEnabled || !data) return null;
  const items = data.assets.map(asset => ({ label: asset.ticker,
    val: !failed && asset.available && asset.change24h != null ? `${asset.change24h >= 0 ? '+' : ''}${asset.change24h.toFixed(2)}%` : '—',
    className: !failed && asset.change24h != null ? asset.change24h >= 0 ? 'stock-up' : 'stock-down' : '',
  }));
  return <PointsTicker items={[...items, ...items]} badge={data.demo ? 'DEMO' : failed ? 'SIN DATOS' : 'EN VIVO'} />;
}
