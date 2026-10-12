import React, { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '@app/lib/i18n.js';
import { candleTimeLabel, nearestStockCandle } from '../lib/stockChart.js';

export const stockMoney = value => value == null ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(Number(value));
export const stockPercent = value => value == null ? '—' : `${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
export function StockBadge({ asset }) {
  const [failedTicker, setFailedTicker] = useState(null);
  return <span className="stock-badge" style={{ '--stock-color': asset.color }} aria-hidden="true">
    {failedTicker === asset.ticker ? asset.monogram : <img src={`${import.meta.env.BASE_URL}stock-logos/${asset.ticker.toLowerCase()}.svg`} alt="" onError={() => setFailedTicker(asset.ticker)} />}
  </span>;
}

export function StockChart({ candles = [], small = false, positive = true, snapshotAt = Date.now() }) {
  const lang = useLang();
  const [selectedTime, setSelectedTime] = useState(null);
  const readoutId = useId();
  const inputSource = useRef(null);
  const values = candles.map(c => Number(c.close));
  if (values.length < 2) return <div className={small ? 'stock-spark-empty' : 'stock-chart-empty'}>{small ? '—' : lang === 'en' ? 'No chart data available.' : 'Gráfica no disponible.'}</div>;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = high - low || high * 0.01 || 1;
  const width = 600;
  const height = small ? 75 : 250;
  const start = candles[0].t;
  const duration = candles.at(-1).t - start || 1;
  const x = candle => 8 + (candle.t - start) / duration * (width - 16);
  const y = candle => 12 + (high - Number(candle.close)) / spread * (height - 24);
  const points = candles.map(c => `${x(c).toFixed(2)},${y(c).toFixed(2)}`).join(' ');
  const selectedIndex = selectedTime == null ? -1 : nearestStockCandle(candles, selectedTime);
  const selected = candles[selectedIndex];
  function selectPointer(event) {
    inputSource.current = 'pointer';
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const ratio = Math.max(0, Math.min(1, ((event.clientX - bounds.left) / bounds.width * width - 8) / (width - 16)));
    setSelectedTime(candles[nearestStockCandle(candles, start + ratio * duration)].t);
  }
  function selectKey(event) {
    let index = selectedIndex < 0 ? candles.length - 1 : selectedIndex;
    if (event.key === 'ArrowLeft') index = Math.max(0, index - 1);
    else if (event.key === 'ArrowRight') index = Math.min(candles.length - 1, index + 1);
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = candles.length - 1;
    else if (event.key === 'Escape') { setSelectedTime(null); return; }
    else return;
    event.preventDefault();
    inputSource.current = 'keyboard';
    setSelectedTime(candles[index].t);
  }
  const graph = <svg className={small ? 'stock-spark' : 'stock-chart'} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    role="img" tabIndex={small ? undefined : 0} aria-describedby={small ? undefined : readoutId}
    aria-label={`${lang === 'en' ? 'Price chart in USD' : 'Gráfica de precio en USD'}: ${values[0].toFixed(2)} → ${values.at(-1).toFixed(2)}${small ? '' : lang === 'en' ? '. Use arrow keys to inspect candles.' : '. Usa las flechas para consultar las velas.'}`}
    onPointerMove={small ? undefined : selectPointer} onPointerDown={small ? undefined : selectPointer}
    onPointerLeave={small ? undefined : event => { if (event.pointerType === 'mouse' && inputSource.current === 'pointer') setSelectedTime(null); }}
    onKeyDown={small ? undefined : selectKey} onFocus={small ? undefined : event => { if (event.currentTarget.matches(':focus-visible')) { inputSource.current = 'keyboard'; setSelectedTime(candles.at(-1).t); } }}
    onBlur={small ? undefined : () => setSelectedTime(null)}>
    {!small && [0.25, 0.5, 0.75].map(y => <line key={y} x1="8" x2="592" y1={height * y} y2={height * y} stroke="currentColor" strokeDasharray="4 6" opacity="0.15" />)}
    <polyline points={points} fill="none" stroke={small ? positive ? 'var(--yes)' : 'var(--red)' : 'var(--orange)'} strokeWidth={small ? 2 : 2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    {!small && selected && <g className="stock-chart-cursor" pointerEvents="none">
      <line x1={x(selected)} x2={x(selected)} y1="0" y2={height} stroke="#ff5500" strokeDasharray="3 4" opacity="0.6" />
      <ellipse cx={x(selected)} cy={y(selected)} rx="5" ry="5" fill="#ff5500" stroke="var(--surface1,#111)" strokeWidth="2" />
    </g>}
  </svg>;
  if (small) return graph;
  return <div className="stock-chart-wrap">
    <div id={readoutId} className="stock-chart-readout" role="status">
      {selected ? <><strong>{stockMoney(selected.close)} USD{selected.endTime >= snapshotAt ? lang === 'en' ? ' · Forming' : ' · En curso' : ''}</strong><span>{lang === 'en' ? 'Candle start' : 'Inicio de vela'}: <time dateTime={new Date(selected.t).toISOString()}>{candleTimeLabel(selected.t, lang)}</time></span></>
        : <span>{lang === 'en' ? 'Hover or tap for price and time. Arrow keys also work.' : 'Pasa el cursor o toca para ver precio y hora. También puedes usar las flechas.'}</span>}
    </div>
    {graph}
    <div className="stock-chart-axis"><time>{candleTimeLabel(start, lang)}</time><time>{candleTimeLabel(candles.at(-1).t, lang)}</time></div>
  </div>;
}

export function StockPositions({ data }) {
  const lang = useLang();
  if (!data) return null;
  return <section className="stock-portfolio-section">
    <div className="stock-section-title"><h2>{lang === 'en' ? 'Stocks' : 'Acciones'}</h2><Link to="/stocks">{lang === 'en' ? 'Explore →' : 'Explorar →'}</Link></div>
    {data.stale && <p className="stock-note">{lang === 'en' ? 'Last recorded valuation. Prices may be outdated.' : 'Última valuación registrada. Los precios pueden estar desactualizados.'}</p>}
    <p className="stock-note">{lang === 'en' ? 'Stock PnL counts in the tournament. Valuations update while you are offline; holdings reset with the points cycle.' : 'El PnL de acciones cuenta en el torneo. La valuación se actualiza aunque no estés conectado; las posiciones se reinician con el ciclo de puntos.'}</p>
    {data.positions.length === 0 ? <p className="stock-note">{lang === 'en' ? 'You do not hold any simulated stocks yet.' : 'Todavía no tienes posiciones simuladas de acciones.'}</p>
      : data.positions.map(position => <article className="stock-position" key={position.ticker}>
        <Link className="stock-position-identity" to={`/stocks/${position.ticker}`}><StockBadge asset={position} /><div><strong>{position.name}</strong><span>{Number(position.quantity).toLocaleString('es-MX', { maximumFractionDigits: 8 })} {position.ticker}</span>
          <span>{lang === 'en' ? 'Avg. cost' : 'Costo promedio'}: {stockMoney(Number(position.costBasis) / Number(position.quantity))} MXNP</span></div></Link>
        <div className="stock-position-value"><strong>{stockMoney(position.currentValue)} MXNP</strong><span className={Number(position.unrealizedPnl) >= 0 ? 'stock-up' : 'stock-down'}>{stockMoney(position.unrealizedPnl)} PnL · {stockPercent(position.unrealizedPnl != null && Number(position.costBasis) > 0 ? Number(position.unrealizedPnl) / Number(position.costBasis) * 100 : null)}</span></div>
        {!position.archived && <Link className="stock-secondary" to={`/stocks/${position.ticker}?side=sell`}>{lang === 'en' ? 'Sell' : 'Vender'}</Link>}
      </article>)}
    {data.positions.length > 0 && <p className="stock-note">{lang === 'en' ? 'Values before selling fees. Holdings belong to this points cycle.' : 'Valores antes de comisión de venta. Las posiciones pertenecen a este ciclo de puntos.'}</p>}
  </section>;
}

export function StockHistory({ data }) {
  const lang = useLang();
  if (!data?.trades?.length) return null;
  return <section className="stock-portfolio-section"><h2>{lang === 'en' ? 'Stock trades' : 'Operaciones de acciones'}</h2>
    <div className="stock-history"><table><thead><tr>{(lang === 'en' ? ['Date', 'Asset', 'Side', 'Units', 'Total MXNP', 'Fee'] : ['Fecha', 'Activo', 'Operación', 'Unidades', 'Total MXNP', 'Comisión']).map(title => <th key={title}>{title}</th>)}</tr></thead>
      <tbody>{data.trades.map(trade => <tr key={trade.id}><td>{new Date(trade.created_at).toLocaleString(lang === 'en' ? 'en-US' : 'es-MX')}</td><td>{trade.ticker}</td><td>{trade.side === 'buy' ? lang === 'en' ? 'Buy' : 'Compra' : lang === 'en' ? 'Sell' : 'Venta'}</td><td>{Number(trade.quantity)}</td><td>{stockMoney(trade.total)}</td><td>{stockMoney(trade.fee)}</td></tr>)}</tbody></table></div>
    {data.hasMoreTrades && <p className="stock-note">{lang === 'en' ? 'Showing the latest 200 trades.' : 'Mostrando las últimas 200 operaciones.'}</p>}
  </section>;
}
