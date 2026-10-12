import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useLang } from '@app/lib/i18n.js';
import { fetchStockAssets, fetchStockCandles, fetchStockPortfolio, quoteStock, tradeStock, stocksEnabled, stockErrorMessage } from '../lib/stockApi.js';
import { StockBadge, StockChart, stockMoney, stockPercent } from '../components/StockShared.jsx';
import { emitPointsRefresh } from '../lib/pointsLiveRefresh.js';
import { STOCK_CHART_RANGES } from '../../../../api/_lib/stock-assets.js';
import { buildStockFill } from '../../../../api/_lib/stock-math.js';

export default function PointsStockDetail({ onOpenLogin }) {
  const { ticker: rawTicker } = useParams();
  const ticker = rawTicker.toUpperCase();
  const [params] = useSearchParams();
  const { authenticated, user, refresh } = usePointsAuth();
  const lang = useLang();
  const en = lang === 'en';
  const [data, setData] = useState(null);
  const [candles, setCandles] = useState([]);
  const [range, setRange] = useState('7D');
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState(false);
  const [side, setSide] = useState(params.get('side') === 'sell' ? 'sell' : 'buy');
  const [amount, setAmount] = useState('500');
  const [sellAll, setSellAll] = useState(false);
  const [holding, setHolding] = useState(null);
  const [quote, setQuote] = useState(null);
  const [message, setMessage] = useState(null);
  const [marketError, setMarketError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [now, setNow] = useState(Date.now());
  const attempt = useRef(null);
  const lock = useRef(false);
  const asset = data?.assets.find(item => item.ticker === ticker);
  const available = stocksEnabled && asset?.available && data?.book && !marketError && now - data.book.bookTime < 10000;
  const expired = quote && now >= quote.expiresAt;
  const choose = fn => { if (busy || retry) return; fn(); setQuote(null); attempt.current = null; setMessage(null); };
  // Indicative only; confirmation always uses the server's immutable quote.
  let estimate = null;
  let estimateError = null;
  if (available) {
    try {
      estimate = buildStockFill({ side, ...(sellAll && side === 'sell' ? { sellAll: true } : { amount }),
        positionQuantity: holding?.quantity || '0', quote: data.book });
      if (side === 'buy' && authenticated && Number(estimate.total) > Number(user?.balance || 0)) estimateError = { code: 'insufficient_balance' };
    } catch (error) { estimateError = error; }
  }
  const summary = quote || estimate;

  useEffect(() => {
    if (!stocksEnabled) return;
    let alive = true;
    setData(null); setQuote(null); setHolding(null); setMessage(null); setRetry(false); attempt.current = null;
    async function load() {
      if (document.visibilityState === 'hidden') return;
      const results = await Promise.allSettled([fetchStockAssets(ticker), authenticated ? fetchStockPortfolio() : Promise.resolve(null)]);
      if (!alive) return;
      if (results[0].status === 'fulfilled') { setData(results[0].value); setMarketError(null); }
      else setMarketError(stockErrorMessage(results[0].reason, lang));
      if (results[1].status === 'fulfilled') setHolding(results[1].value?.positions.find(item => item.ticker === ticker) || null);
    }
    load();
    const timer = setInterval(load, 5000);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => { alive = false; clearInterval(timer); clearInterval(clock); };
  }, [ticker, authenticated, lang]);
  useEffect(() => {
    if (!stocksEnabled) return;
    let alive = true;
    setCandles([]);
    async function load() {
      setChartLoading(true); setChartError(false);
      try { const result = await fetchStockCandles(ticker, range); if (alive) setCandles(result.candles); }
      catch { if (alive) setChartError(true); }
      finally { if (alive) setChartLoading(false); }
    }
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [ticker, range]);

  async function submit() {
    if (lock.current) return;
    if (!authenticated) { onOpenLogin?.(); return; }
    lock.current = true; setBusy(true); setMessage(null);
    let completed = false;
    try {
      if (!quote || (expired && !retry)) {
        const preview = await quoteStock({ ticker, side, ...(sellAll && side === 'sell' ? { sellAll: true } : { amount }) });
        setQuote(preview); setNow(Date.now()); attempt.current = { quoteId: preview.quoteId, idempotencyKey: crypto.randomUUID() };
      } else {
        const result = await tradeStock(side, attempt.current);
        completed = true;
        setQuote(null); setRetry(false); attempt.current = null;
        setMessage({ type: 'success', text: `${side === 'sell' ? en ? 'Received' : 'Cobraste' : en ? 'Operation completed' : 'Operación completada'} ${stockMoney(result.total)} MXNP · ${result.quantity} ${ticker}` });
        await refresh();
        emitPointsRefresh({ source: `stock_${side}` });
        const portfolio = await fetchStockPortfolio();
        setHolding(portfolio.positions.find(item => item.ticker === ticker) || null);
      }
    } catch (e) {
      // Keep the exact request for uncertain transport failures. Retrying it
      // replays the committed result instead of creating another purchase.
      if (completed) return;
      const uncertain = quote && (!e.status || e.status >= 500);
      setRetry(Boolean(uncertain));
      if (!uncertain) { setQuote(null); attempt.current = null; }
      setMessage({ type: 'error', text: uncertain ? en ? 'Confirmation interrupted. Retry to verify this same operation.' : 'La confirmación se interrumpió. Reintenta para verificar esta misma operación.' : stockErrorMessage(e, lang) });
    } finally { lock.current = false; setBusy(false); }
  }

  const category = asset?.category === 'indices' ? en ? 'Indices' : 'Índices' : asset?.category === 'materias-primas' ? en ? 'Commodities' : 'Materias primas' : en ? 'Technology' : 'Tecnología';
  const buttonLabel = busy ? en ? 'Processing…' : 'Procesando…' : retry ? en ? 'Retry confirmation' : 'Reintentar confirmación'
    : quote && !expired ? `${en ? 'Confirm' : 'Confirmar'} ${side === 'buy' ? en ? 'buy' : 'compra' : en ? 'sell' : 'venta'}`
      : `${en ? 'Review' : 'Revisar'} ${side === 'buy' ? en ? 'buy' : 'compra' : en ? 'sell' : 'venta'} ${sellAll && side === 'sell' ? en ? 'all' : 'total' : stockMoney(amount)} ${en ? 'of' : 'de'} ${asset?.name || ticker}`;
  return <main className="stocks-page stock-detail-page"><Link className="stock-back" to="/stocks">← {en ? 'STOCKS' : 'ACCIONES'}</Link>
    <div className="stock-eyebrow">{category} · 24/7 · {en ? 'POINTS SIMULATOR' : 'SIMULADOR DE PUNTOS'}</div>
    <div className="stock-detail-heading">{asset && <StockBadge asset={asset} />}<h1>{asset?.name || ticker} ({ticker})</h1></div>
    <div className="stock-hero-price"><strong>{stockMoney(asset?.priceMxn)}</strong><span>MXNP</span><span className={asset?.change24h >= 0 ? 'stock-up' : 'stock-down'}>{stockPercent(asset?.change24h)} · 24H USD</span></div>
    {!stocksEnabled && <p className="stock-alert">{en ? 'Stocks will be available soon.' : 'Acciones estará disponible pronto.'}</p>}
    {marketError && <p className="stock-alert" role="status">{marketError}</p>}
    {data?.demo && <p className="stock-alert">DEMO · {en ? 'Synthetic prices for preview.' : 'Precios sintéticos para la vista previa.'}</p>}
    <div className="stock-detail-grid"><section className="stock-chart-card">
      <div className="stock-chart-header"><span>{en ? 'PRICE IN USD' : 'PRECIO EN USD'}</span><div className="stock-ranges">{['4H', '24H', '7D', '30D'].map(value => <button type="button" key={value} aria-pressed={range === value} className={range === value ? 'active' : ''} onClick={() => setRange(value)}>{value}</button>)}</div></div>
      <p className="stock-note">{en ? 'Candle interval' : 'Intervalo de vela'}: {STOCK_CHART_RANGES[range].interval} · {en ? 'Refreshes every 60s' : 'Actualiza cada 60s'}</p>
      {chartLoading && !candles.length ? <div className="stock-chart-empty">{en ? 'Loading chart…' : 'Cargando gráfica…'}</div> : <StockChart key={`${ticker}:${range}`} candles={candles} />}
      {chartError && <p className="stock-note">{en ? 'Chart temporarily unavailable.' : 'Gráfica temporalmente no disponible.'}</p>}
      <div className="stock-book-labels"><span>{en ? 'Buy' : 'Compra'} <strong>{stockMoney(data?.book?.levels[1][0].px)} USD</strong></span><span>{en ? 'Sell' : 'Venta'} <strong>{stockMoney(data?.book?.levels[0][0].px)} USD</strong></span>
        <span>Vol. 24H <strong>{asset?.volumeUsd == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(asset.volumeUsd)} USD</strong></span></div>
      <p className="stock-note">{data?.demo ? 'DEMO' : 'Hyperliquid / xyz'} · {en ? 'Candle close prices; time is the candle start in UTC. The latest candle may still be forming.' : 'Precios de cierre de vela; la hora indica su inicio en UTC. La última vela puede estar en curso.'}</p>
    </section><section className="stock-order-card">
      <div className="stock-eyebrow">{en ? 'CHOOSE AN OPERATION' : 'ELIGE UNA OPERACIÓN'}</div>
      <div className="stock-side-switch">{['buy', 'sell'].map(value => <button type="button" disabled={busy || retry} key={value} className={side === value ? 'active' : ''} aria-pressed={side === value} onClick={() => choose(() => { setSide(value); setSellAll(false); })}>{value === 'buy' ? en ? 'Buy' : 'Comprar' : en ? 'Sell' : 'Vender'}</button>)}</div>
      <div className="stock-order-balance">{en ? 'Available' : 'Disponible'} <strong>{stockMoney(user?.balance)} MXNP</strong></div>
      {side === 'sell' && <div className="stock-order-balance">{en ? 'You hold' : 'Tienes'} <strong>{holding?.quantity || '0'} {ticker}</strong></div>}
      <label className="stock-amount-label" htmlFor="stock-amount">{en ? 'AMOUNT IN POINTS' : 'MONTO EN PUNTOS'}</label>
      <div className="stock-amount-wrap"><span>$</span><input id="stock-amount" inputMode="decimal" autoComplete="off" value={amount} disabled={busy || retry || sellAll} onChange={e => choose(() => setAmount(e.target.value))} /><span>MXNP</span></div>
      <div className="stock-presets">{[100, 500, 1000, 5000].map(value => <button type="button" disabled={busy || retry} key={value} onClick={() => choose(() => { setAmount(String(value)); setSellAll(false); })}>{stockMoney(value).replace('.00', '')}</button>)}</div>
      {side === 'sell' && <button type="button" className={`stock-secondary stock-sell-all ${sellAll ? 'active' : ''}`} aria-pressed={sellAll} disabled={busy || retry || !holding} onClick={() => choose(() => setSellAll(!sellAll))}>{en ? 'Sell all units' : 'Vender todo'}</button>}
      <dl className="stock-estimate"><div><dt>{side === 'buy' ? en ? 'Approx. units received' : 'Recibes aprox.' : en ? 'Units sold' : 'Unidades a vender'}</dt><dd>{summary ? `${summary.quantity} ${ticker}` : '—'}</dd></div>
        <div><dt>{en ? 'Pronos fee' : 'Comisión Pronos'} 0.10%</dt><dd>{summary ? `${stockMoney(summary.fee)} MXNP` : '—'}</dd></div>
        <div><dt>{side === 'buy' ? en ? 'Total debit' : 'Cargo total' : en ? 'Net proceeds' : 'Recibes neto'}</dt><dd>{summary ? `${stockMoney(summary.total)} MXNP` : '—'}</dd></div>
        <div><dt>{en ? 'Exchange rate' : 'Tipo de cambio'}</dt><dd>{stockMoney(quote?.fx?.rate || data?.fx?.rate)} MXN / USD</dd></div>
      </dl>
      {!quote && estimate && <p className="stock-note">{en ? 'Estimate updates with your amount. Review to get a confirmed quote.' : 'La estimación cambia con tu monto. Revisa para obtener una cotización confirmada.'}</p>}
      {!quote && estimateError && <p className="stock-note" role="status">{stockErrorMessage(estimateError, lang)}</p>}
      {quote && <p className="stock-note" role="status">{expired ? en ? 'Quote expired. Review again.' : 'Cotización vencida. Revisa de nuevo.' : `${en ? 'Quote valid for' : 'Cotización válida por'} ${Math.max(0, Math.ceil((quote.expiresAt - now) / 1000))}s`}
        {side === 'buy' && Number(quote.unspent) > 0 && <><br />{en ? 'Remainder kept in your balance' : 'Remanente en tu balance'}: {stockMoney(quote.unspent)} MXNP</>}</p>}
      {message && <p className={`stock-alert ${message.type === 'success' ? 'stock-success' : ''}`} role="status">{message.text}</p>}
      <button type="button" className="stock-primary" onClick={submit} disabled={busy || (authenticated && !retry && (!available || (side === 'sell' && !holding) || (!quote && estimateError) || (!sellAll && !(Number(amount) > 0))))}>{authenticated ? !available && !busy && !retry ? en ? 'Price unavailable' : 'Precio no disponible' : buttonLabel : en ? 'Sign in to trade' : 'Inicia sesión para operar'}</button>
      <p className="stock-note">{en ? 'Simulated holdings with MXNP points. No real shares or cash withdrawals. Holdings reset with the points cycle.' : 'Posiciones simuladas con puntos MXNP. Sin acciones reales ni retiros de dinero. Las posiciones se reinician con el ciclo de puntos.'}
        {data?.fx && <><br />{data.fx.source} · {data.fx.date}</>}</p>
    </section></div>
  </main>;
}
