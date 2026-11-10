import React, { useEffect, useState } from 'react';
import { getJson } from '../lib/pointsApi.js';
import './AdminOnchainAccounting.css';

const api = '/api/points/admin/onchain-accounting';
const explorer = 'https://sepolia.arbiscan.io';
const integerFormat = new Intl.NumberFormat('es-MX');
const roles = {
  operations: 'Operaciones', owner: 'Administrador de contratos', resolver: 'Resolución', marketCreator: 'Creación de mercados',
  treasury: 'Tesorería', liquidityReserve: 'Reserva de liquidez', emergencyReserve: 'Reserva de emergencia',
  feeCollector: 'Recaudación de comisiones', gasFunder: 'Patrocinio de gas', feeVault: 'Bóveda de comisiones',
  incomingReserve: 'Reserva de ETH entrante',
  router: 'Router', v1Factory: 'Fábrica V1', v2Factory: 'Fábrica V2', additional: 'Wallet registrada',
};
const marketStatus = {
  open: 'Abierto o sin resolver', pending_recovery: 'Resuelto · recuperación pendiente',
  recovered: 'Liquidez liquidada', canceled: 'Cancelado · conciliación pendiente',
  disputed: 'En disputa', unavailable: 'Sin datos verificados',
};
const labels = {
  internal: 'Transferencia interna', incoming: 'Entrada externa', outgoing: 'Salida externa',
  mint: 'Emisión', burn: 'Quema', custody: 'Movimiento de colateral', seed: 'Liquidez al pool',
  seedFunding: 'Fondeo de liquidez', recovery: 'Recuperación de liquidez', commission: 'Comisión',
  refund: 'Reembolso', redemption: 'Pago a ganador', sale: 'Venta de posiciones', purchase: 'Compra de posiciones',
  feeDistribution: 'Distribución interna de comisiones', gasGrant: 'Subsidio automático de gas',
  gasFundingTransfer: 'Transferencia desde wallet de gas', networkFee: 'Comisión de red',
};
const warningCopy = {
  additional_wallets_invalid: 'Revisa la lista de wallets adicionales configuradas.',
  gas_funder_missing: 'La wallet de patrocinio de gas no está configurada.',
  operations_missing: 'La wallet de operaciones no está configurada.',
  factory_unavailable: 'No se pudieron verificar todas las fábricas configuradas.',
  other_collateral: 'Hay fábricas con otro token de colateral. La vista usa el token activo.',
  factory_roles_incomplete: 'No se pudieron leer todos los roles de las fábricas.',
  registry_incomplete: 'El registro indexado no coincide con el total de mercados onchain de todas las fábricas.',
  registry_unavailable: 'El registro de mercados está temporalmente inaccesible.',
  market_page: 'Los totales de mercado corresponden a los pools de esta página. Los saldos de wallets cubren todas las direcciones registradas.',
};
const defaultSearch = { kind: 'mxnp', wallet: '', through: '', tx: '' };

function number(value) {
  if (value == null) return 'Sin datos';
  const [whole, fraction] = value.replace(/^-/, '').split('.');
  const decimals = fraction?.replace(/0+$/, '');
  return (value.startsWith('-') ? '−' : '') + integerFormat.format(BigInt(whole)) + (decimals ? '.' + decimals : '');
}

function Amount({ value, symbol }) {
  if (value == null) return <span className="accounting-muted">Sin datos</span>;
  return <span className="accounting-amount">{number(value)}{symbol ? ' ' + symbol : ''}</span>;
}

function ExplorerLink({ value, type = 'address', short = false }) {
  if (!value) return <span aria-label="No aplica">—</span>;
  return <a href={explorer + '/' + type + '/' + value} target="_blank" rel="noreferrer" title={value}>
    <code>{short ? value.slice(0, 8) + '…' + value.slice(-6) : value}</code>
  </a>;
}

function Metric({ title, metric, symbol, caption, partial }) {
  const incomplete = partial || metric?.partial || metric?.known < metric?.count;
  const unavailable = metric?.known === 0 && (metric.count > 0 || incomplete);
  return <div className="accounting-metric">
    <span>{title}</span>
    <strong><Amount value={unavailable ? null : metric?.amount} symbol={symbol} /></strong>
    <small>{incomplete ? 'Parcial · ' : ''}{caption}</small>
  </div>;
}

function Table({ caption, columns, children }) {
  return <div className="accounting-scroll" tabIndex={0} role="region" aria-label={caption}>
    <table className="accounting-table">
      <caption>{caption}</caption>
      <thead><tr>{columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

function Summary({ report, jump, previousMarkets, nextMarkets }) {
  const { wallets, markets, metrics, symbol, warnings, sponsoredGas } = report;
  const partial = warnings.some(warning => ['factory_unavailable', 'factory_roles_incomplete', 'registry_incomplete', 'registry_unavailable', 'market_page', 'other_collateral'].includes(warning));
  const partialWallets = warnings.some(warning => ['factory_unavailable', 'factory_roles_incomplete', 'operations_missing',
    'gas_funder_missing', 'additional_wallets_invalid'].includes(warning));
  return <>
    {!!warnings.length && <ul className="accounting-warning">{warnings.map(warning => <li key={warning}>{warningCopy[warning] || warning}</li>)}</ul>}
    <div className="accounting-metrics">
      <Metric title="Resultado de trading realizado" metric={metrics.contribution} symbol={symbol} partial={partial}
        caption="Comisiones brutas + resultado de liquidez cerrada. Antes de gastos." />
      <Metric title="Comisiones brutas" metric={metrics.fees} symbol={symbol} partial={partial} caption="Cobradas por los pools. Las redistribuciones internas se cuentan una sola vez." />
      <Metric title="Resultado de liquidez cerrada" metric={metrics.realized} symbol={symbol} partial={partial}
        caption={metrics.realized.count + ' mercados liquidados · recuperación menos fondeo'} />
      <Metric title="Riesgo de liquidez pendiente" metric={metrics.openDownside} symbol={symbol} partial={partial}
        caption="Pérdida potencial con los saldos actuales. Los mercados cancelados requieren conciliación." />
      <Metric title="Fondeo de liquidez de Pronos" metric={metrics.seed} symbol={symbol} partial={partial} caption="Aportaciones verificadas en transacciones de creación." />
      <Metric title="Liquidez recuperada" metric={metrics.recovery} symbol={symbol} partial={partial} caption="Transferencias de recuperación a cuentas registradas." />
      <Metric title="Saldo en wallets" metric={metrics.walletMxnp} symbol={symbol} partial={partialWallets} caption="Saldo de las wallets registradas, separado de los contratos." />
      <Metric title="Saldo nativo en wallets" metric={metrics.walletEth} symbol="ETH" partial={partialWallets} caption="ETH de prueba para operaciones y gas." />
      <Metric title="Gas enviado a usuarios" metric={sponsoredGas} symbol="ETH" caption={sponsoredGas
        ? sponsoredGas.count + ' subsidios automáticos confirmados · comisiones de red aparte' : 'Subsidios automáticos del registro de gas.'} />
      <Metric title="Colateral en pools" metric={metrics.poolBalance} symbol={symbol} partial={partial} caption="Incluye fondos que respaldan posiciones y pagos a usuarios." />
      <Metric title="Pagos a ganadores" metric={metrics.winnerPayouts} symbol={symbol} partial={partial} caption="Cobros registrados por los pools. Los reembolsos aparecen en Movimientos." />
    </div>
    <section className="pb-admin-panel accounting-section">
      <h2>Wallets y contratos</h2>
      <p>Direcciones deduplicadas por rol. Las wallets de usuarios aparecen como contrapartes de movimientos.</p>
      <Table caption="Saldos al bloque de corte" columns={['Dirección', 'Roles', symbol, 'ETH', 'Historial']}>
        {wallets.map(wallet => <tr key={wallet.address}>
          <td><ExplorerLink value={wallet.address} /></td>
          <td>{wallet.roles.map(role => roles[role] || role).join(' · ')}{wallet.kind === 'contract' && <small>Contrato</small>}</td>
          <td><Amount value={wallet.mxnp} /></td><td><Amount value={wallet.eth} /></td>
          <td><button className="pb-admin-button" type="button" onClick={() => jump({ wallet: wallet.address })}>Ver movimientos</button></td>
        </tr>)}
      </Table>
      {!wallets.length && <p>No hay wallets verificadas para mostrar.</p>}
    </section>
    <section className="pb-admin-panel accounting-section">
      <h2>Liquidez por mercado</h2>
      <p>En mercados sin resolver, la recuperación estimada usa el escenario menos favorable con las posiciones del pool al bloque de corte.
        {report.factoryMarkets != null && <> {markets.length} de {report.factoryMarkets} mercados de las fábricas configuradas en esta página.</>}
      </p>
      <Table caption={'Importes en ' + symbol} columns={['Mercado y pool', 'Estado', 'Saldo pool', 'Pendiente a ganadores', 'Fondeo', 'Comisiones', 'Recuperado', 'Recuperable est.', 'Resultado realizado', 'Riesgo pendiente']}>
        {markets.map(market => <tr key={market.address}>
          <th scope="row">{market.question || 'Mercado #' + market.id}
            <small>{market.version.toUpperCase()} · #{market.id} · <ExplorerLink value={market.address} short /></small>
            {market.creationBlock && <small>Creación · <ExplorerLink type="block" value={String(market.creationBlock)} /></small>}
            {market.creationTx && <button className="pb-admin-button" type="button"
              onClick={() => jump({ tx: market.creationTx })}>Ver fondeo</button>}
            <button className="pb-admin-button" type="button" onClick={() => jump({ wallet: market.address })}>Movimientos</button>
          </th>
          <td>{marketStatus[market.status]}</td>
          <td><Amount value={market.poolBalance} />{/[1-9]/.test(market.eth || '') && <small><Amount value={market.eth} symbol="ETH" /></small>}</td>
          <td><Amount value={market.winnerBacking} /></td>
          <td><Amount value={market.seed} />
            {market.seedWallet && <small>{market.ownedSeed ? 'Pronos' : 'Origen fuera del registro'} · <ExplorerLink value={market.seedWallet} short /></small>}</td>
          <td><Amount value={market.fees} /></td>
          <td><Amount value={market.recovery} />
            {/[1-9]/.test(market.paidElsewhere || '')
              && <small><Amount value={market.paidElsewhere} /> a otras direcciones</small>}</td>
          <td><Amount value={market.recoverable} /></td><td><Amount value={market.realized} /></td>
          <td><Amount value={market.openDownside} /></td>
        </tr>)}
      </Table>
      {!markets.length && <p>No hay mercados indexados para mostrar.</p>}
      {(previousMarkets || nextMarkets) && <div className="accounting-actions">
        <button className="pb-admin-button" type="button" disabled={!previousMarkets} onClick={previousMarkets}>Mercados anteriores</button>
        <button className="pb-admin-button" type="button" disabled={!nextMarkets} onClick={nextMarkets}>Mercados más antiguos</button>
      </div>}
    </section>
  </>;
}

function rawMxnp(value) {
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const units = BigInt(whole + fraction.padEnd(6, '0'));
  return value.startsWith('-') ? -units : units;
}

function formatMxnp(units) {
  const digits = (units < 0n ? -units : units).toString().padStart(7, '0');
  return (units < 0n ? '-' : '') + digits.slice(0, -6) + '.' + digits.slice(-6);
}

function ConsolidatedMarkets({ report }) {
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState(null);
  const block = report.block;
  useEffect(() => {
    if (!request) return undefined;
    const controller = new AbortController();
    async function load() {
      const keys = ['contribution', 'fees', 'realized', 'openDownside', 'seed', 'recovery'];
      const metrics = Object.fromEntries(keys.map(key => [key, { units: 0n, known: 0, count: 0, partial: false }]));
      let cursor = null;
      let incomplete = false;
      let expected = null;
      let markets = 0;
      do {
        const params = new URLSearchParams({ block });
        if (cursor) params.set('marketBefore', cursor);
        const page = await getJson(api + '?' + params, { signal: controller.signal });
        if (cursor && page.nextMarketBefore >= cursor) throw new Error('accounting_cursor_repeated');
        cursor = page.nextMarketBefore;
        expected = page.factoryMarkets;
        markets += page.markets.length;
        incomplete ||= page.warnings.some(warning => warning !== 'market_page');
        for (const key of keys) {
          const part = page.metrics[key];
          const total = metrics[key];
          total.units += rawMxnp(part.amount);
          total.known += part.known;
          total.count += part.count;
          total.partial ||= Boolean(part.partial);
        }
      } while (cursor);
      for (const value of Object.values(metrics)) value.amount = formatMxnp(value.units);
      if (!controller.signal.aborted) setResult({ metrics, markets, partial: incomplete || expected !== markets });
    }
    load().catch(() => { if (!controller.signal.aborted) setResult({ error: true }); });
    return () => controller.abort();
  }, [block, request]);
  const loading = request > 0 && !result;
  const metrics = result?.metrics;
  return <section className="pb-admin-panel accounting-section">
    <h2>Totales de todas las páginas</h2>
    <p>Consolida el resultado de los mercados con el mismo bloque de corte.</p>
    <button className="pb-admin-button" type="button" disabled={loading}
      onClick={() => { setResult(null); setRequest(current => current + 1); }}>Calcular totales</button>
    {loading && <p role="status">Consolidando mercados…</p>}
    {result?.error && <p role="alert">No se completó el cálculo. Inténtalo de nuevo.</p>}
    {metrics && <>
      <p>{result.markets} mercados procesados.</p>
      <div className="accounting-metrics">
        {[
          ['contribution', 'Resultado de trading realizado', 'Comisiones + liquidez cerrada · antes de gastos'],
          ['fees', 'Comisiones brutas', 'Total cobrado por los pools'],
          ['realized', 'Resultado de liquidez cerrada', 'Recuperación menos fondeo'],
          ['openDownside', 'Riesgo de liquidez pendiente', 'Pérdida potencial con los saldos actuales'],
          ['seed', 'Fondeo de liquidez de Pronos', 'Aportaciones verificadas'],
          ['recovery', 'Liquidez recuperada', 'Transferencias a cuentas registradas'],
        ].map(([key, title, caption]) => <Metric key={key} title={title} metric={metrics[key]} caption={caption}
          symbol={report.symbol} partial={result.partial} />)}
      </div>
    </>}
  </section>;
}

const coverageCopy = {
  erc20: 'Transferencias del token verificadas en la cadena.',
  explorer: 'Transacciones ETH del explorador y comisiones de red verificadas por recibo.',
  explorerInternal: 'Transferencias ETH ejecutadas dentro de contratos, según el explorador.',
  indexedGas: 'Subsidios automáticos confirmados en el registro de gas.',
  explorerUnconfigured: 'El historial ETH completo requiere una clave API de Etherscan V2 en el preview.',
};

function MovementHistory({ report, draft, setDraft, active, setActive }) {
  const [pages, setPages] = useState([{}]);
  const [result, setResult] = useState(null);
  const params = new URLSearchParams({ kind: active.kind, block: report.block });
  if (report.marketBefore) params.set('marketBefore', report.marketBefore);
  if (active.wallet) params.set('wallet', active.wallet);
  if (active.kind === 'mxnp' && active.tx) params.set('tx', active.tx);
  if (active.kind === 'mxnp' && active.through && !active.tx) params.set('through', active.through);
  for (const [key, value] of Object.entries(pages.at(-1))) params.set(key, value);
  const url = api + '?' + params;
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    getJson(url, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setResult({ url, data }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ url, error: error.code || 'unavailable' }); });
    return () => controller.abort();
  }, [url]);
  const visible = result?.url === url ? result : null;
  const { data, error } = visible || {};
  const options = [...report.wallets.map(wallet => [wallet.address, wallet.roles.map(role => roles[role]).join(' · ')]),
    ...report.markets.map(market => [market.address, 'Pool · ' + market.question])];
  const currency = active.kind === 'mxnp' ? report.symbol : 'ETH';
  function change(field, value) {
    setDraft(current => ({ ...current, [field]: value }));
  }
  function submit(event) {
    event.preventDefault();
    setPages([{}]);
    setActive({ ...draft, through: draft.through.trim(), tx: draft.tx.trim() });
  }
  return <section className="pb-admin-panel accounting-section" id="accounting-history">
    <h2>Movimientos</h2>
    {report.warnings.includes('market_page') && <p>El filtro general incluye las wallets registradas y los pools de esta página.</p>}
    <form className="accounting-filters" onSubmit={submit}>
      <label>Tipo <select value={draft.kind} onChange={event => change('kind', event.target.value)}>
        <option value="mxnp">{report.symbol}</option>
        <option value="eth">ETH y comisiones de red</option>
        <option value="ethInternal">ETH dentro de contratos</option>
        <option value="gasGrants">Subsidios automáticos de gas</option>
      </select></label>
      <label>Wallet o pool <select value={draft.wallet} onChange={event => change('wallet', event.target.value)} required={draft.kind !== 'mxnp'}>
        <option value="">{draft.kind === 'mxnp' ? 'Todas las direcciones registradas' : 'Selecciona una dirección'}</option>
        {options.map(([address, label]) => <option key={address} value={address}>{label} · {address.slice(0, 10)}…</option>)}
      </select></label>
      {draft.kind === 'mxnp' && <>
        <label>Hasta el bloque <input value={draft.through} onChange={event => change('through', event.target.value)}
          disabled={Boolean(draft.tx)} inputMode="numeric" pattern="[0-9]+" maxLength={10} placeholder={String(report.block)} /></label>
        <label>Hash de transacción <input value={draft.tx} onChange={event => change('tx', event.target.value)} maxLength={66}
          pattern="0x[0-9a-fA-F]{64}" placeholder="0x…" /></label>
      </>}
      <button className="pb-admin-button" type="submit">Buscar</button>
    </form>
    {!report.nativeHistory && <p className="accounting-muted">{coverageCopy.explorerUnconfigured} Los subsidios automáticos ya tienen su propio historial.</p>}
    {!visible && <p role="status">Cargando movimientos…</p>}
    {error && <p role="alert">{error === 'invalid_accounting_query' ? 'Revisa la dirección, el bloque de corte o el hash.' : 'El historial está temporalmente inaccesible.'}</p>}
    {data && <>
      <p>{coverageCopy[data.coverage]}
        {data.fromBlock != null && <> Bloques {integerFormat.format(data.fromBlock)}–{integerFormat.format(data.toBlock)}.</>}
        {data.unclassified && <> Algunos recibos o movimientos están pendientes de verificar.</>}
      </p>
      {data.coverage === 'explorer' && <p>Comisiones de red en esta página <Amount value={data.gasSpent} symbol="ETH" /></p>}
      {data.items.length > 0 ? <Table caption={'Movimientos en ' + currency}
        columns={['Tipo', 'Desde', 'Hacia', 'Importe', 'Mercado', 'Bloque / transacción']}>
        {data.items.map(item => <tr key={item.id}>
          <td>{labels[item.category]}</td>
          <td><ExplorerLink value={item.from} short /></td>
          <td><ExplorerLink value={item.to} short /></td>
          <td><Amount value={item.amount} symbol={currency} /></td>
          <td>{item.market ? <ExplorerLink value={item.market.address} short /> : '—'}
            {item.market && <small>{item.market.question}</small>}</td>
          <td><ExplorerLink type="tx" value={item.tx} short />
            <small>{item.block != null ? integerFormat.format(item.block) : item.time ? new Date(item.time).toLocaleString('es-MX') : ''}</small></td>
        </tr>)}
      </Table> : <p>{data.coverage !== 'explorerUnconfigured' ? 'No hay movimientos en este tramo. Puedes consultar un bloque anterior o buscar un hash.' : 'Usa el enlace del explorador en la fila de la wallet.'}</p>}
      <div className="accounting-actions">
        <button className="pb-admin-button" type="button" disabled={pages.length === 1} onClick={() => setPages(current => current.slice(0, -1))}>Página anterior</button>
        <button className="pb-admin-button" type="button" disabled={!data.next} onClick={() => setPages(current => [...current, data.next])}>
          {data.next?.through && data.next.logIndex == null ? 'Bloques más antiguos' : 'Más movimientos'}
        </button>
      </div>
    </>}
  </section>;
}

export default function AdminOnchainAccounting() {
  const [snapshot, setSnapshot] = useState(null);
  const [marketPage, setMarketPage] = useState({ block: null, cursors: [null] });
  const [draft, setDraft] = useState(defaultSearch);
  const [active, setActive] = useState(defaultSearch);
  const [historyRevision, setHistoryRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    const query = new URLSearchParams();
    if (marketPage.block) query.set('block', marketPage.block);
    if (marketPage.cursors.at(-1)) query.set('marketBefore', marketPage.cursors.at(-1));
    getJson(query.size ? api + '?' + query : api, { signal: controller.signal }).then(report => { if (!controller.signal.aborted) setSnapshot({ report }); })
      .catch(error => { if (!controller.signal.aborted) setSnapshot({ error: error.code || 'unavailable' }); });
    return () => controller.abort();
  }, [marketPage]);
  const { report, error } = snapshot || {};
  function jump(fields) {
    const filter = { ...defaultSearch, ...fields };
    setDraft(filter);
    setActive(filter);
    setHistoryRevision(current => current + 1);
    document.getElementById('accounting-history')?.scrollIntoView({ block: 'start' });
  }
  function changeMarketPage(block, cursors) {
    setSnapshot(null);
    setDraft(defaultSearch);
    setActive(defaultSearch);
    setMarketPage({ block, cursors });
  }
  return <div className="accounting">
    <div className="pb-admin-panel accounting-section accounting-intro">
      <div>
        <h2>Arbitrum Sepolia · Solo lectura</h2>
        <p>Contabilidad de trading con activos de prueba. Los gastos de red se muestran en ETH por separado. Los gastos fuera de cadena quedan fuera del resultado.</p>
        {report && <p>Corte al bloque <ExplorerLink type="block" value={String(report.block)} /> · <time dateTime={report.asOf}>{new Date(report.asOf).toLocaleString('es-MX')}</time>
          {' · Colateral '}<ExplorerLink value={report.collateral} short /></p>}
      </div>
      <button className="pb-admin-button" type="button" onClick={() => changeMarketPage(null, [null])} disabled={!snapshot}>Actualizar corte</button>
    </div>
    {!snapshot && <p role="status">Leyendo saldos, comisiones y liquidez…</p>}
    {error && <p role="alert">{error === 'onchain_accounting_disabled'
      ? 'Contabilidad disponible en el preview de Arbitrum Sepolia.' : 'No se pudo verificar el corte de contabilidad.'}</p>}
    {report && <>
      {report.warnings.includes('market_page') && <ConsolidatedMarkets key={report.block} report={report} />}
      <Summary report={report} jump={jump}
        previousMarkets={marketPage.cursors.length > 1 ? () => changeMarketPage(report.block, marketPage.cursors.slice(0, -1)) : null}
        nextMarkets={report.nextMarketBefore ? () => changeMarketPage(report.block, [...marketPage.cursors, report.nextMarketBefore]) : null} />
      <MovementHistory key={report.block + ':' + historyRevision} report={report} draft={draft} setDraft={setDraft}
        active={active} setActive={setActive} />
    </>}
  </div>;
}
