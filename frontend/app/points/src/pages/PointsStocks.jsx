import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '@app/lib/i18n.js';
import { fetchStockAssets, fetchStockCandles, stocksEnabled, stockErrorMessage } from '../lib/stockApi.js';
import { StockBadge, StockChart, stockMoney, stockPercent } from '../components/StockShared.jsx';

export default function PointsStocks() {
  const lang = useLang();
  const en = lang === 'en';
  const [data, setData] = useState(null);
  const [sparks, setSparks] = useState({});
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  useEffect(() => {
    if (!stocksEnabled) return;
    let alive = true;
    async function load() {
      if (document.visibilityState === 'hidden') return;
      try { const result = await fetchStockAssets(); if (alive) { setData(result); setError(null); } }
      catch (e) { if (alive) setError(stockErrorMessage(e, lang)); }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [lang]);
  useEffect(() => {
    if (!data?.assets) return;
    let alive = true;
    async function load() {
      const results = await Promise.allSettled(data.assets.map(asset => fetchStockCandles(asset.ticker, 'SPARK')));
      if (alive) setSparks(Object.fromEntries(results.flatMap((result, i) => result.status === 'fulfilled'
        ? [[data.assets[i].ticker, result.value.candles]] : [])));
    }
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [Boolean(data?.assets)]); // Catalogue is stable; price ticks must not refetch all charts.
  const assets = (data?.assets || []).filter(asset => (category === 'all' || asset.category === category)
    && `${asset.name} ${asset.ticker}`.toLowerCase().includes(query.toLowerCase().trim()));
  return <main className="stocks-page">
    <div className="stock-eyebrow"><span className="stock-live-dot" />{en ? 'STOCKS IN POINTS' : 'ACCIONES EN PUNTOS'} · MXNP</div>
    <div className="stocks-heading"><div><h1>{en ? 'Buy stocks from 100 MXNP' : 'Compra acciones desde 100 MXNP'}</h1>
      <p>{en ? 'Put your portfolio to work, follow the market.' : 'Pon tu portafolio a trabajar, sigue el mercado.'}</p></div>
      <Link className="stock-secondary" to="/portfolio">{en ? 'My portfolio ↗' : 'Mi portafolio ↗'}</Link></div>
    <div className="stocks-controls"><div className="stock-filters" aria-label={en ? 'Asset category' : 'Categoría de activo'}>
      {[[ 'all', en ? 'All' : 'Todas' ], ['tecnologia', en ? 'Technology' : 'Tecnología'], ['indices', en ? 'Indices' : 'Índices'], ['materias-primas', en ? 'Commodities' : 'Materias primas'], ['crypto', 'Crypto'], ['etfs', 'ETFs']].map(([key, label]) =>
        <button type="button" key={key} aria-pressed={category === key} className={category === key ? 'active' : ''} onClick={() => setCategory(key)}>{label}</button>)}
    </div><input className="stock-search" aria-label={en ? 'Search stocks' : 'Buscar acción'} placeholder={en ? 'Search stocks…' : 'Buscar acción…'} value={query} onChange={e => setQuery(e.target.value)} /></div>
    {!stocksEnabled && <p className="stock-alert">{en ? 'Stocks will be available soon.' : 'Acciones estará disponible pronto.'}</p>}
    {data?.demo && <p className="stock-alert">DEMO · {en ? 'Synthetic prices for preview.' : 'Precios sintéticos para la vista previa.'}</p>}
    {error && <p className="stock-alert" role="status">{error} {data && (en ? 'Last received prices shown.' : 'Se muestran los últimos precios recibidos.')}</p>}
    {stocksEnabled && <div className="stocks-table"><div className="stocks-table-head"><span>{en ? 'Asset' : 'Activo'}</span><span>24H · USD</span><span>{en ? 'Price MXNP' : 'Precio MXNP'} · 24H</span></div>
      {!data && !error && <div className="stock-loading">{en ? 'Loading prices…' : 'Cargando precios…'}</div>}
      {assets.map(asset => <Link key={asset.ticker} className="stocks-row" to={`/stocks/${asset.ticker}`}>
        <div className="stock-identity"><StockBadge asset={asset} /><div><strong>{asset.name}</strong><span>{asset.ticker}{asset.readOnly ? en ? ' · Preview' : ' · Vista previa' : ''}</span></div></div>
        <StockChart candles={sparks[asset.ticker]} small positive={asset.change24h >= 0} />
        <div className="stock-row-price"><strong>{stockMoney(asset.priceMxn)}</strong><span className={asset.change24h >= 0 ? 'stock-up' : 'stock-down'}>{asset.available ? stockPercent(asset.change24h) : en ? 'Unavailable' : 'No disponible'}</span></div>
      </Link>)}
      {data && !assets.length && <p className="stock-loading">{en ? 'No matching assets.' : 'No encontramos activos.'}</p>}
    </div>}
    <p className="stock-note stocks-disclosure">{en ? 'Simulation with MXNP points. Reference prices from Hyperliquid; no ownership of shares or crypto. Trading depends on live price availability. ETFs are price previews.' : 'Simulación con puntos MXNP. Precios de referencia de Hyperliquid; no otorga propiedad de acciones ni crypto. Las operaciones dependen de la disponibilidad de precios. Los ETFs son vistas previas de precios.'}
      {data?.fx && <><br />{data.fx.source} · {data.fx.date} · {stockMoney(data.fx.rate)} MXN / USD</>}</p>
  </main>;
}
