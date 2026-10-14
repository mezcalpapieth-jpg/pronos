import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useLang } from '@app/lib/i18n.js';
import { fetchStockAssets, fetchStockCandles, fetchStockHoldings, quoteStock, tradeStock, stocksEnabled, stockErrorMessage } from '../lib/stockApi.js';
import { StockBadge, StockChart, stockMoney, stockPercent } from '../components/StockShared.jsx';
import { emitPointsRefresh } from '../lib/pointsLiveRefresh.js';
import { STOCK_CHART_RANGES, stockAsset } from '../../../../api/_lib/stock-assets.js';
import { buildStockFill, decimal, fixed } from '../../../../api/_lib/stock-math.js';
import { priceTimeLabel } from '../lib/stockChart.js';
import { stockFormRequest, stockQuantityAtPercent, stockSalePercent } from '../lib/stockOrder.js';
import { executeStockOrder, stockTradeNeedsRetry } from '../lib/stockExecution.js';

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
  const [chartFetchedAt, setChartFetchedAt] = useState(null);
  const [side, setSide] = useState(params.get('side') === 'sell' ? 'sell' : 'buy');
  const [amount, setAmount] = useState('500');
  const [quantity, setQuantity] = useState('');
  const [unitMode, setUnitMode] = useState(params.get('side') === 'sell' ? 'units' : 'money');
  const [sellPercent, setSellPercent] = useState(params.get('side') === 'sell' ? 100 : null);
  const [holding, setHolding] = useState(null);
  const [quote, setQuote] = useState(null);
  const [message, setMessage] = useState(null);
  const [marketError, setMarketError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [filledBalance, setFilledBalance] = useState(null);
  const [now, setNow] = useState(Date.now());
  const attempt = useRef(null);
  const lock = useRef(false);
  const holdingRevision = useRef(0);
  const screenRevision = useRef(0);
  const formTicker = useRef(ticker);
  const lastEstimate = useRef(null);
  const asset = data?.assets.find(item => item.ticker === ticker) || stockAsset(ticker);
  const canTrade = stocksEnabled && data?.tradingEnabled !== false && asset?.available;
  const bookFresh = data?.book && now - data.book.bookTime >= -2000 && now - data.book.bookTime < 10000;
  const available = canTrade && bookFresh;
  const balance = filledBalance ?? user?.balance;
  const choose = fn => { if (busy || retry) return; fn(); setQuote(null); attempt.current = null; setMessage(null); };
  const precision = data?.book?.szDecimals ?? 8;
  const heldQuantity = holding?.quantity || '0';
  let orderRequest;
  try { orderRequest = stockFormRequest({ ticker, side, unitMode, amount, quantity, sellPercent, positionQuantity: heldQuantity, precision }); }
  catch { orderRequest = { ticker, side, quantity: '0' }; }
  let fullSale = null;
  if (holding && data?.book) {
    try { fullSale = buildStockFill({ side: 'sell', sellAll: true, positionQuantity: heldQuantity, quote: data.book }); }
    catch { /* The server still checks current holdings and depth at execution. */ }
  }
  // Indicative only; execution always uses a fresh immutable server quote.
  let estimate = null;
  let estimateError = null;
  if (available) {
    try {
      estimate = buildStockFill({ ...orderRequest, positionQuantity: heldQuantity, quote: data.book });
      if (side === 'buy' && authenticated && Number(estimate.total) > Number(balance || 0)) estimateError = { code: 'insufficient_balance' };
    } catch (error) { estimateError = error; }
  }
  const summary = quote || estimate || (busy ? lastEstimate.current : null);
  const selectedPercent = sellPercent ?? stockSalePercent(orderRequest.quantity ?? summary?.quantity, heldQuantity);
  const inputValue = side === 'sell' && sellPercent !== null
    ? unitMode === 'units' ? stockQuantityAtPercent(heldQuantity, sellPercent, precision)
      : summary ? decimal(fixed(summary.gross) / 10000n, 2) : ''
    : unitMode === 'units' ? quantity : amount;

  function switchUnitMode(value) {
    choose(() => {
      setUnitMode(value);
      if (estimate) {
        setQuantity(estimate.quantity);
        setAmount(side === 'buy' ? estimate.total : estimate.gross);
      }
    });
  }

  function chooseSide(value) {
    choose(() => {
      setSide(value); setUnitMode(value === 'sell' ? 'units' : 'money');
      setSellPercent(value === 'sell' ? 100 : null); setAmount('500'); setQuantity('');
    });
  }

  useEffect(() => { if (estimate) lastEstimate.current = estimate; }, [estimate]);
  useEffect(() => { setFilledBalance(null); }, [user?.balance, user?.username]);
  useEffect(() => {
    if (formTicker.current === ticker) return;
    formTicker.current = ticker;
    setAmount('500'); setQuantity(''); setUnitMode(side === 'sell' ? 'units' : 'money');
    setSellPercent(side === 'sell' ? 100 : null);
  }, [ticker, side]);

  useEffect(() => {
    if (!stocksEnabled) return;
    let alive = true;
    let loading = false;
    screenRevision.current++;
    setData(null); setQuote(null); setMarketError(null); setMessage(null); setRetry(false); attempt.current = null; lastEstimate.current = null;
    async function load(initial = false) {
      if (loading || (!initial && document.visibilityState === 'hidden')) return;
      loading = true;
      try { const value = await fetchStockAssets(ticker); if (alive) { setData(value); setMarketError(null); } }
      catch (error) { if (alive) setMarketError(stockErrorMessage(error, lang)); }
      finally { loading = false; }
    }
    load(true);
    const timer = setInterval(load, 3000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => { alive = false; screenRevision.current++; clearInterval(timer); clearInterval(clock); document.removeEventListener('visibilitychange', onVisible); };
  }, [ticker, user?.username, lang]);
  useEffect(() => {
    let alive = true;
    let loading = false;
    setHolding(null); holdingRevision.current++;
    async function load(initial = false) {
      if (!authenticated || loading || (!initial && document.visibilityState === 'hidden')) return;
      loading = true;
      const revision = holdingRevision.current;
      try {
        const value = await fetchStockHoldings();
        if (alive && revision === holdingRevision.current) setHolding(value.positions.find(item => item.ticker === ticker) || null);
      } catch { /* Preserve the last holding; confirmation validates it on the server. */ }
      finally { loading = false; }
    }
    load(true);
    const timer = setInterval(load, 15000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [ticker, authenticated, user?.username]);
  useEffect(() => {
    if (!stocksEnabled) return;
    let alive = true;
    let loading = false;
    setCandles([]); setChartFetchedAt(null);
    async function load() {
      if (loading) return;
      loading = true; setChartLoading(true); setChartError(false);
      try { const result = await fetchStockCandles(ticker, range); if (alive) { setCandles(result.candles); setChartFetchedAt(result.fetchedAt || Date.now()); } }
      catch { if (alive) setChartError(true); }
      finally { loading = false; if (alive) setChartLoading(false); }
    }
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [ticker, range]);

  async function submit() {
    if (lock.current) return;
    if (!authenticated) { onOpenLogin?.(); return; }
    lock.current = true; setBusy(true); setMessage(null);
    const screen = screenRevision.current;
    let completed = false;
    let tradeAttempt = retry ? attempt.current : null;
    try {
      const result = await executeStockOrder({ request: orderRequest, pendingAttempt: tradeAttempt, quoteStock, tradeStock,
        isCurrent: () => screen === screenRevision.current,
        onQuote: (preview, nextAttempt) => {
          tradeAttempt = nextAttempt; attempt.current = nextAttempt;
          setQuote(preview); setNow(Date.now());
        },
      });
      if (!result) return;
      completed = true;
      if (screen !== screenRevision.current) { refresh(); emitPointsRefresh({ source: `stock_${side}` }); return; }
      holdingRevision.current++;
      setFilledBalance(result.balance);
      setHolding(Number(result.position?.quantity) > 0 ? { ...asset, ...result.position } : null);
      setQuote(null); setRetry(false); attempt.current = null;
      if (side === 'sell') { setSellPercent(100); setUnitMode('units'); setQuantity(''); }
      setMessage({ type: 'success', text: `${side === 'sell' ? en ? 'Sale completed · Received' : 'Venta realizada · Recibiste' : en ? 'Purchase completed · Spent' : 'Compra realizada · Cargo'} ${stockMoney(result.total)} MXNP · ${result.quantity} ${ticker}` });
      emitPointsRefresh({ source: `stock_${side}` });
      // The trade is committed. Refresh the wallet without holding the order
      // form in its processing state or waiting on portfolio valuation SQL.
      refresh();
    } catch (e) {
      // Keep the exact request for uncertain transport failures. Retrying it
      // replays the committed result instead of creating another purchase.
      if (completed || screen !== screenRevision.current) return;
      const uncertain = stockTradeNeedsRetry(e, tradeAttempt);
      setRetry(uncertain);
      if (!uncertain) { setQuote(null); attempt.current = null; }
      setMessage({ type: 'error', text: uncertain ? en ? 'Response interrupted. Retry to verify this same operation.' : 'La respuesta se interrumpió. Reintenta para verificar esta misma operación.' : stockErrorMessage(e, lang) });
    } finally { lock.current = false; setBusy(false); }
  }

  const category = asset?.category === 'crypto' ? 'Crypto' : asset?.category === 'indices' ? en ? 'Indices' : 'Índices' : asset?.category === 'materias-primas' ? en ? 'Commodities' : 'Materias primas' : en ? 'Technology' : 'Tecnología';
  const buttonLabel = busy ? en ? 'Processing…' : 'Procesando…' : retry ? en ? 'Retry operation' : 'Reintentar operación'
    : side === 'sell' ? `${en ? 'Sell' : 'Vender'}${summary ? ` · ${summary.quantity} ${ticker}` : ''}`
      : `${en ? 'Buy' : 'Comprar'} · ${unitMode === 'units' ? `${inputValue || '0'} ${ticker}` : `${stockMoney(orderRequest.amount)} MXNP`}`;
  return <main className="stocks-page stock-detail-page"><Link className="stock-back" to="/stocks">← {en ? 'STOCKS' : 'ACCIONES'}</Link>
    <div className="stock-eyebrow">{category} · {en ? 'POINTS SIMULATOR' : 'SIMULADOR DE PUNTOS'}</div>
    <div className="stock-detail-heading">{asset && <StockBadge asset={asset} />}<h1>{asset?.name || ticker} ({ticker})</h1></div>
    <div className="stock-hero-price"><strong>{stockMoney(asset?.priceMxn)}</strong><span>MXNP</span><span className={asset?.change24h >= 0 ? 'stock-up' : 'stock-down'}>{stockPercent(asset?.change24h)} · 24H USD</span></div>
    {!stocksEnabled && <p className="stock-alert">{en ? 'Stocks will be available soon.' : 'Acciones estará disponible pronto.'}</p>}
    {marketError && <p className="stock-alert" role="status">{marketError}</p>}
    {data?.tradingEnabled === false && <p className="stock-alert" role="status">{en ? 'Trading is temporarily paused. Your holdings and tournament PnL remain visible.' : 'Las operaciones están pausadas temporalmente. Tus posiciones y PnL del torneo siguen disponibles.'}</p>}
    {data?.demo && <p className="stock-alert">DEMO · {en ? 'Synthetic prices for preview.' : 'Precios sintéticos para la vista previa.'}</p>}
    <p className="stock-note">{en ? 'Stock PnL counts when you sell, after fees. Open PnL remains unrealized until sale. At tournament close, all holdings are sold automatically. Prices reference perpetuals; purchases use MXNP points.' : 'El PnL de acciones cuenta al vender, después de comisiones. El PnL abierto no está realizado hasta la venta. Al cierre del torneo todas las posiciones se venden automáticamente. Precios de referencia de perpetuos; compras con puntos MXNP.'}</p>
    <div className="stock-detail-grid"><section className="stock-chart-card">
      <div className="stock-chart-header"><span>{en ? 'PRICE IN USD' : 'PRECIO EN USD'}</span><div className="stock-ranges">{['4H', '24H', '7D', '30D'].map(value => <button type="button" key={value} aria-pressed={range === value} className={range === value ? 'active' : ''} onClick={() => setRange(value)}>{value}</button>)}</div></div>
      <p className="stock-note">{en ? 'Candle interval' : 'Intervalo de vela'}: {STOCK_CHART_RANGES[range].interval} · {en ? 'Refreshes every 60s' : 'Actualiza cada 60s'}
        {chartFetchedAt && <><br />{en ? 'Chart received' : 'Gráfica recibida'}: <time dateTime={new Date(chartFetchedAt).toISOString()}>{priceTimeLabel(chartFetchedAt, lang)}</time></>}</p>
      {chartLoading && !candles.length ? <div className="stock-chart-empty">{en ? 'Loading chart…' : 'Cargando gráfica…'}</div> : <StockChart key={`${ticker}:${range}`} candles={candles} snapshotAt={chartFetchedAt} />}
      {chartError && <p className="stock-note">{en ? 'Chart temporarily unavailable.' : 'Gráfica temporalmente no disponible.'}</p>}
      {candles.at(-1)?.endTime < chartFetchedAt - 60000 && <p className="stock-note" role="status">{en ? 'The latest candle is older: no trades were recorded in the more recent intervals. See the live buy/sell prices below.' : 'La última vela es anterior: no hubo operaciones registradas en los intervalos más recientes. Consulta los precios de compra/venta en vivo abajo.'}</p>}
      <div className="stock-book-labels"><span>{en ? 'Buy' : 'Compra'} <strong>{stockMoney(data?.book?.levels[1][0].px)} USD</strong></span><span>{en ? 'Sell' : 'Venta'} <strong>{stockMoney(data?.book?.levels[0][0].px)} USD</strong></span>
        <span>Vol. 24H <strong>{asset?.volumeUsd == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(asset.volumeUsd)} USD</strong></span></div>
      <p className="stock-note">{data?.demo ? 'DEMO' : asset?.dex ? `Hyperliquid / ${asset.dex}` : 'Hyperliquid'} · {en ? 'Candle prices; axis times show each candle’s start, not the latest update. A candle covering the current time is still forming.' : 'Precios de vela; el eje indica el inicio de cada vela, no su última actualización. Una vela que incluye la hora actual sigue en curso.'}</p>
      {data?.book && <p className="stock-note" role="status">{en ? 'Live buy/sell prices' : 'Precios de compra/venta en vivo'} · <time dateTime={new Date(data.book.bookTime).toISOString()}>{priceTimeLabel(data.book.bookTime, lang)}</time> · {bookFresh ? `${Math.max(0, Math.floor((now - data.book.bookTime) / 1000))}s` : en ? 'Refreshing…' : 'Actualizando…'}<br />{en ? 'Refreshes every 3s. Trading validates a new quote automatically.' : 'Actualiza cada 3s. Al operar se valida una nueva cotización automáticamente.'}</p>}
    </section><section className="stock-order-card">
      <div className="stock-eyebrow">{en ? 'CHOOSE AN OPERATION' : 'ELIGE UNA OPERACIÓN'}</div>
      <div className="stock-side-switch">{['buy', 'sell'].map(value => <button type="button" disabled={busy || retry} key={value} className={side === value ? 'active' : ''} aria-pressed={side === value} onClick={() => chooseSide(value)}>{value === 'buy' ? en ? 'Buy' : 'Comprar' : en ? 'Sell' : 'Vender'}</button>)}</div>
      <div className="stock-order-balance">{en ? 'Wallet balance' : 'Saldo en puntos'} <strong>{stockMoney(balance)} MXNP</strong></div>
      {side === 'sell' && <>
        <div className="stock-order-balance">{en ? 'You hold' : 'Tienes'} <strong>{decimal(fixed(heldQuantity, 18), 18)} {ticker}</strong></div>
        <div className="stock-order-balance">{en ? 'Available sale value' : 'Valor disponible para vender'} <strong>{fullSale ? `${stockMoney(fullSale.gross)} MXNP` : '—'}</strong></div>
      </>}
      <div className="stock-unit-switch" role="group" aria-label={en ? 'Enter order in' : 'Ingresar operación en'}>{['money', 'units'].map(value => <button type="button" key={value} disabled={busy || retry} aria-pressed={unitMode === value} className={unitMode === value ? 'active' : ''} onClick={() => switchUnitMode(value)}>{value === 'money' ? 'MXNP' : `${en ? 'Units' : 'Unidades'} · ${ticker}`}</button>)}</div>
      <label className="stock-amount-label" htmlFor="stock-amount">{unitMode === 'units' ? `${en ? 'UNITS TO' : 'UNIDADES A'} ${side === 'buy' ? en ? 'BUY' : 'COMPRAR' : en ? 'SELL' : 'VENDER'}` : side === 'buy' ? en ? 'BUDGET IN MXNP' : 'PRESUPUESTO EN MXNP' : en ? 'SALE VALUE IN MXNP' : 'VALOR A VENDER EN MXNP'}</label>
      <div className={`stock-amount-wrap ${unitMode === 'units' ? 'stock-amount-units' : ''}`}>
        {unitMode === 'money' && <span>$</span>}
        <input id="stock-amount" inputMode="decimal" autoComplete="off" value={inputValue} disabled={busy || retry} onChange={e => choose(() => { setSellPercent(null); unitMode === 'units' ? setQuantity(e.target.value) : setAmount(e.target.value); })} />
        <span>{unitMode === 'units' ? ticker : 'MXNP'}</span>
      </div>
      {side === 'buy' && unitMode === 'money' && <div className="stock-presets">{[100, 500, 1000, 5000].map(value => <button type="button" disabled={busy || retry} key={value} onClick={() => choose(() => setAmount(String(value)))}>{stockMoney(value).replace('.00', '')}</button>)}</div>}
      {side === 'sell' && <div className="stock-sell-selector">
        <div className="stock-slider-label"><label htmlFor="stock-sell-percent">{en ? 'Percentage of your holding' : 'Porcentaje de tu posición'}</label><output htmlFor="stock-sell-percent">{selectedPercent}%</output></div>
        <input id="stock-sell-percent" type="range" min="0" max="100" step="1" value={selectedPercent} disabled={busy || retry || !holding} onChange={e => choose(() => setSellPercent(Number(e.target.value)))} aria-valuetext={`${selectedPercent}% ${en ? 'of your holding' : 'de tu posición'}`} />
        <div className="stock-presets">{[25, 50, 75, 100].map(value => <button type="button" key={value} aria-pressed={sellPercent === value} className={sellPercent === value ? 'active' : ''} disabled={busy || retry || !holding} onClick={() => choose(() => setSellPercent(value))}>{value === 100 ? en ? 'Sell all' : 'Todo' : `${value}%`}</button>)}</div>
      </div>}
      <p className="stock-note stock-input-note">{side === 'sell' ? en ? 'Your sale uses the current price. Percentages round down to the asset’s minimum fraction.' : 'Vendes al precio actual. El porcentaje se ajusta hacia abajo a la fracción mínima del activo.' : en ? `Minimum buy: 100 MXNP. Units allow up to ${precision} decimal places.` : `Compra mínima: 100 MXNP. Las unidades permiten hasta ${precision} decimales.`}</p>
      <dl className="stock-estimate"><div><dt>{side === 'buy' ? en ? 'Approx. units received' : 'Recibes aprox.' : en ? 'Units sold' : 'Unidades a vender'}</dt><dd>{summary ? `${summary.quantity} ${ticker}` : '—'}</dd></div>
        <div><dt>{side === 'buy' ? en ? 'Purchase value' : 'Valor de compra' : en ? 'Sale value' : 'Valor de venta'}</dt><dd>{summary ? `${stockMoney(summary.gross)} MXNP` : '—'}</dd></div>
        <div><dt>{en ? 'Pronos fee' : 'Comisión Pronos'} 0.10%</dt><dd>{summary ? `${stockMoney(summary.fee)} MXNP` : '—'}</dd></div>
        <div><dt>{side === 'buy' ? en ? 'Total debit' : 'Cargo total' : en ? 'Net proceeds' : 'Recibes neto'}</dt><dd>{summary ? `${stockMoney(summary.total)} MXNP` : '—'}</dd></div>
        <div><dt>{en ? 'Exchange rate' : 'Tipo de cambio'}</dt><dd>{stockMoney(quote?.fx?.rate || data?.fx?.rate)} MXN / USD</dd></div>
      </dl>
      {!quote && estimate && <p className="stock-note">{en ? 'Estimate updates with your amount. The final price is validated when you trade.' : 'La estimación cambia con tu monto. El precio final se valida al operar.'}</p>}
      {!quote && estimateError && <p className="stock-note" role="status">{stockErrorMessage(estimateError, lang)}</p>}
      {quote && <p className="stock-note" role="status">{retry ? en ? 'Keep this operation to verify its result safely.' : 'Conservamos esta operación para verificar su resultado.' : en ? 'Updated quote. Processing operation…' : 'Cotización actualizada. Procesando operación…'}
        {side === 'buy' && Number(quote.unspent) > 0 && <><br />{en ? 'Remainder kept in your balance' : 'Remanente en tu balance'}: {stockMoney(quote.unspent)} MXNP</>}</p>}
      {message && <p className={`stock-alert ${message.type === 'success' ? 'stock-success' : ''}`} role="status">{message.text}</p>}
      <button type="button" className="stock-primary" onClick={submit} disabled={busy || (authenticated && !retry && (!canTrade || (side === 'sell' && !holding) || (!quote && estimateError) || (!orderRequest.sellAll && !(Number(orderRequest.amount ?? orderRequest.quantity) > 0))))}>{authenticated ? !canTrade && !busy && !retry ? !data && !marketError ? en ? 'Loading prices…' : 'Cargando precios…' : en ? 'Price unavailable' : 'Precio no disponible' : buttonLabel : en ? 'Sign in to trade' : 'Inicia sesión para operar'}</button>
      <p className="stock-note">{en ? 'Simulated holdings with MXNP points. No real shares or cash withdrawals. Holdings reset with the points cycle.' : 'Posiciones simuladas con puntos MXNP. Sin acciones reales ni retiros de dinero. Las posiciones se reinician con el ciclo de puntos.'}
        {data?.fx && <><br />{data.fx.source} · {data.fx.date}</>}</p>
    </section></div>
  </main>;
}
