import React from 'react';
import './AdminStocksAudit.css';

const number = value => Number(value || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const pnlClass = value => value == null ? '' : Number(value) >= 0 ? 'positive' : 'negative';

export default function AdminStocksAudit({ data, formatMoney, formatSigned, formatDate }) {
  const summary = data?.summary || {};
  const users = data?.users || [];
  const assets = data?.assets || [];
  const trades = data?.recentTrades || [];
  const money = value => value == null ? '—' : formatMoney(value);
  const signed = value => value == null ? '—' : formatSigned(value);
  if (!data?.available) return <p className="admin-stocks-empty">Stock no está disponible en este ciclo.</p>;
  return <section className="admin-stocks-audit" aria-label="Actividad Stock">
    <dl className="admin-stocks-metrics">
      <div><dt>Inversores</dt><dd>{number(summary.investors)}</dd><small>{number(summary.activeInvestors)} activos en 24 h</small></div>
      <div><dt>Participación</dt><dd>{number(summary.adoptionPercent)}%</dd><small>de {number(summary.participants)} operadores del ciclo</small></div>
      <div><dt>Operaciones</dt><dd>{number(summary.trades)}</dd><small>{number(summary.buys)} compras · {number(summary.sells)} ventas</small></div>
      <div><dt>Volumen operado</dt><dd>{money(summary.volume)}</dd><small>Compras + ventas, sin comisiones</small></div>
      <div><dt>Valor en posiciones</dt><dd>{money(summary.currentValue)}</dd><small>{number(summary.holders)} usuarios con posición</small></div>
      <div><dt>PnL realizado</dt><dd className={pnlClass(summary.realizedPnl)}>{signed(summary.realizedPnl)}</dd><small>Suma al torneo</small></div>
      <div><dt>PnL abierto</dt><dd className={pnlClass(summary.unrealizedPnl)}>{signed(summary.unrealizedPnl)}</dd><small>No realizado</small></div>
      <div><dt>Comisiones</dt><dd>{money(summary.fees)}</dd><small>Compras {money(summary.invested)} · ventas {money(summary.proceeds)}</small></div>
    </dl>
    {summary.staleHolders > 0 && <p className="admin-stocks-warning" role="status">
      {number(summary.staleHolders)} inversores con valuaciones desactualizadas. Los valores abiertos usan la última marca guardada.
    </p>}
    {summary.trades === 0 && <p className="admin-stocks-empty">Todavía no hay operaciones Stock en este ciclo.</p>}
    <h3>Por activo</h3>
    <div className="admin-stocks-scroll" role="region" aria-label="Stock por activo" tabIndex={0}>
      <table><thead><tr><th>Activo</th><th>Inversores</th><th>Operaciones</th><th>Volumen</th><th>Valor abierto</th><th>PnL realizado</th></tr></thead>
        <tbody>{assets.map(asset => <tr key={asset.ticker}>
          <th scope="row">{asset.ticker}</th><td>{number(asset.investors)}</td>
          <td>{number(asset.buys)} C / {number(asset.sells)} V</td><td>{money(asset.volume)}</td>
          <td>{money(asset.currentValue)}<small>{number(asset.holders)} con posición</small></td>
          <td className={pnlClass(asset.realizedPnl)}>{signed(asset.realizedPnl)}</td>
        </tr>)}</tbody></table>
    </div>
    <h3>Inversores <span>{number(data.userCount)}</span></h3>
    <div className="admin-stocks-scroll" role="region" aria-label="Inversores Stock" tabIndex={0}>
      <table><thead><tr><th>Usuario</th><th>Operaciones</th><th>Volumen</th><th>Valor abierto</th><th>PnL realizado</th><th>Última operación</th></tr></thead>
        <tbody>{users.map(user => <tr key={user.username}>
          <th scope="row">@{user.username}<small>{number(user.activeDays)} días · {number(user.tickers)} activos</small></th>
          <td>{number(user.buys)} C / {number(user.sells)} V</td><td>{money(user.volume)}</td>
          <td>{money(user.currentValue)}{user.stale && <small className="warning">Marca desactualizada</small>}</td>
          <td className={pnlClass(user.realizedPnl)}>{signed(user.realizedPnl)}</td><td>{formatDate(user.lastTrade)}</td>
        </tr>)}</tbody></table>
    </div>
    {data.userCount > users.length && <p className="admin-stocks-empty">Mostrando {users.length} de {data.userCount} inversores por volumen.</p>}
    <h3>Últimas operaciones</h3>
    <div className="admin-stocks-scroll" role="region" aria-label="Últimas operaciones Stock" tabIndex={0}>
      <table><thead><tr><th>Fecha</th><th>Usuario</th><th>Activo</th><th>Movimiento</th><th>Importe neto</th><th>PnL realizado</th></tr></thead>
        <tbody>{trades.map(trade => <tr key={trade.id}>
          <td>{formatDate(trade.createdAt)}</td><th scope="row">@{trade.username}</th><td>{trade.ticker}</td>
          <td>{trade.origin === 'tournament_close' ? 'Cierre del torneo' : trade.side === 'buy' ? 'Compra' : 'Venta'}</td>
          <td>{money(trade.total)}</td><td className={pnlClass(trade.realizedPnl)}>{signed(trade.realizedPnl)}</td>
        </tr>)}</tbody></table>
    </div>
  </section>;
}
