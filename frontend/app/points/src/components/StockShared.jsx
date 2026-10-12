import React from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '@app/lib/i18n.js';

export const stockMoney = value => value == null ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(Number(value));
export const stockPercent = value => value == null ? '—' : `${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
export function StockBadge({ asset }) {
  return <span className="stock-badge" style={{ '--stock-color': asset.color }} aria-hidden="true">{asset.monogram}</span>;
}

export function StockChart({ candles = [], small = false, positive = true }) {
  const lang = useLang();
  const values = candles.map(c => Number(c.close));
  if (values.length < 2) return <div className={small ? 'stock-spark-empty' : 'stock-chart-empty'}>{small ? '—' : lang === 'en' ? 'No chart data available.' : 'Gráfica no disponible.'}</div>;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = high - low || high * 0.01 || 1;
  const width = 600;
  const height = small ? 75 : 250;
  const start = candles[0].t;
  const duration = candles.at(-1).t - start || 1;
  const points = candles.map((c, i) => `${8 + (c.t - start) / duration * (width - 16)},${12 + (high - values[i]) / spread * (height - 24)}`).join(' ');
  return <svg className={small ? 'stock-spark' : 'stock-chart'} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    role="img" aria-label={`${lang === 'en' ? 'Price chart in USD' : 'Gráfica de precio en USD'}: ${values[0].toFixed(2)} → ${values.at(-1).toFixed(2)}`}>
    {!small && [0.25, 0.5, 0.75].map(y => <line key={y} x1="8" x2="592" y1={height * y} y2={height * y} stroke="currentColor" strokeDasharray="4 6" opacity="0.15" />)}
    <polyline points={points} fill="none" stroke={small ? positive ? '#00c778' : '#ed5353' : '#ff5500'} strokeWidth={small ? 2 : 2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
  </svg>;
}

export function StockPositions({ data }) {
  const lang = useLang();
  if (!data) return null;
  return <section className="stock-portfolio-section">
    <div className="stock-section-title"><h2>{lang === 'en' ? 'Stocks' : 'Acciones'}</h2><Link to="/stocks">{lang === 'en' ? 'Explore →' : 'Explorar →'}</Link></div>
    {data.stale && <p className="stock-note">{lang === 'en' ? 'Last recorded valuation. Prices may be outdated.' : 'Última valuación registrada. Los precios pueden estar desactualizados.'}</p>}
    {data.positions.length === 0 ? <p className="stock-note">{lang === 'en' ? 'You do not hold any simulated stocks yet.' : 'Todavía no tienes posiciones simuladas de acciones.'}</p>
      : data.positions.map(position => <article className="stock-position" key={position.ticker}>
        <StockBadge asset={position} /><div><strong>{position.name}</strong><span>{Number(position.quantity).toLocaleString('es-MX', { maximumFractionDigits: 8 })} {position.ticker}</span></div>
        <div className="stock-position-value"><strong>{stockMoney(position.currentValue)} MXNP</strong><span className={Number(position.unrealizedPnl) >= 0 ? 'stock-up' : 'stock-down'}>{stockMoney(position.unrealizedPnl)} PnL</span></div>
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
