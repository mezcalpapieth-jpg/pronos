import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { usePointsAuth } from '../lib/pointsAuth.js';
import {
  createPolymarketPilot, createPolymarketQuoteSession, polymarketQuoteExpired,
  polymarketTimestamp, polymarketWarningMessage,
} from '../lib/polymarketPilot.js';
import './PolymarketPilotPage.css';

const STATUS = {
  filled: 'Monto simulado cubierto por el libro visible',
  partial: 'Cobertura parcial en el libro visible',
  below_minimum: 'El monto no alcanza el mínimo del mercado',
  insufficient_depth: 'Profundidad visible insuficiente',
};

function money(value) {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('es-MX', { maximumFractionDigits: 6 }).format(amount) : '—';
}

function date(value) {
  if (value === null || value === undefined || value === '') return 'Sin fecha disponible';
  const time = new Date(polymarketTimestamp(value));
  return Number.isNaN(time.getTime()) ? 'Sin fecha disponible'
    : new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'America/Mexico_City' }).format(time);
}

function externalUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

function MarketRules({ market }) {
  const rules = Array.isArray(market.rules) ? market.rules : market.rules ? [market.rules] : [];
  const source = externalUrl(market.resolutionSource);
  return (
    <section className="polymarket-pilot-card" aria-labelledby="polymarket-market-rules">
      <h2 id="polymarket-market-rules">Reglas y resolución</h2>
      <p className="polymarket-pilot-market-title">{market.title}</p>
      <dl className="polymarket-pilot-facts">
        <div><dt>Plazo publicado · Ciudad de México</dt><dd>{date(market.endDate)}</dd></div>
        <div><dt>Versión del mercado</dt><dd>{market.version || 'Sin verificar'}</dd></div>
        <div><dt>Fuente de resolución</dt><dd>{source
          ? <a href={source} target="_blank" rel="noopener noreferrer">Ver fuente publicada</a>
          : market.resolutionSource || 'Consulta las reglas publicadas abajo.'}</dd></div>
      </dl>
      <p>El plazo publicado no garantiza el momento del pago. La resolución y cualquier disputa siguen las reglas de este mercado en Polymarket.</p>
      <details open>
        <summary>Leer las reglas completas</summary>
        {rules.length ? rules.map((rule, index) => <p className="polymarket-pilot-rules" key={index}>{String(rule)}</p>)
          : <p className="polymarket-pilot-rules">{market.description || 'El proveedor no devolvió reglas para este mercado.'}</p>}
      </details>
      {market.conditionId && <details><summary>Identificador del mercado</summary><code>{market.conditionId}</code></details>}
    </section>
  );
}

function QuoteDetails({ quote, expired, side, outcome, title }) {
  const warnings = Array.isArray(quote.warnings) ? quote.warnings : [];
  const builderFeeBps = Number(quote.builderFeeBps);
  const builderFeeLabel = Number.isFinite(builderFeeBps) && builderFeeBps >= 0
    ? `${money(builderFeeBps)} pb (${new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(builderFeeBps / 100)}%)`
    : 'tarifa pendiente de verificar';
  return (
    <section className="polymarket-pilot-card polymarket-pilot-result" aria-labelledby="polymarket-quote-result">
      <div className="polymarket-pilot-result-header">
        <h2 id="polymarket-quote-result">Resultado de la simulación</h2>
        <span className={expired ? 'polymarket-pilot-tag expired' : 'polymarket-pilot-tag'}>{expired ? 'Caducada' : 'Cotización indicativa'}</span>
      </div>
      <p>{title} · <strong>{outcome}</strong> · {side === 'buy' ? 'Comprar' : 'Vender'}</p>
      <p role="status">{STATUS[quote.status] || 'Revisa la cobertura y las comisiones.'}</p>
      <dl className="polymarket-pilot-facts">
        <div><dt>Participaciones visibles para la simulación</dt><dd>{money(quote.filledShares)}</dd></div>
        <div><dt>Cobertura del monto solicitado</dt><dd>{money(quote.coveragePct)}%</dd></div>
        <div><dt>Valor antes de comisiones</dt><dd>{money(quote.grossNotional)} pUSD</dd></div>
        <div><dt>Comisión de Polymarket</dt><dd>{money(quote.venueFee)} pUSD</dd></div>
        <div><dt>Comisión Pronos objetivo · {builderFeeLabel}</dt><dd>{money(quote.pronosFee)} pUSD</dd></div>
        <div><dt>Reembolsos de comisiones de Pronos</dt><dd>0 pUSD</dd></div>
        <div className="polymarket-pilot-total"><dt>{side === 'buy' ? 'Gasto total simulado' : 'Ingreso neto simulado'}</dt>
          <dd>{money(side === 'buy' ? quote.totalSpend : quote.netProceeds)} pUSD</dd></div>
        <div><dt>{side === 'buy' ? 'Presupuesto sin utilizar' : 'Participaciones sin cubrir'}</dt>
          <dd>{money(quote.remainingAmount)} {side === 'buy' ? 'pUSD' : 'participaciones'}</dd></div>
        <div><dt>Vigencia · Ciudad de México</dt><dd>{date(quote.expiresAt)}</dd></div>
      </dl>
      <p>Esta simulación usa la tarifa objetivo de Pronos. La tarifa efectiva debe consultarse antes de enviar una orden; el cobro y los abonos aún no se han verificado en este piloto.</p>
      <p>Las comisiones de la plataforma se muestran por separado y corren por cuenta del usuario. No se descuentan reembolsos ni incentivos de las comisiones mostradas.</p>
      <p>Costos de fondeo, retiro y conversión no incluidos; se cotizan por separado y los paga el usuario.</p>
      {warnings.length > 0 && <ul className="polymarket-pilot-warnings">{warnings.map((warning, index) => <li key={index}>{polymarketWarningMessage(warning)}</li>)}</ul>}
      {expired && <p role="status">El libro puede haber cambiado. Solicita una nueva simulación antes de comparar precios.</p>}
      <p>La profundidad publicada puede cambiar antes de enviar una orden. Una simulación completa no confirma una ejecución.</p>
    </section>
  );
}

export default function PolymarketPilotPage({ onOpenLogin }) {
  const { authenticated, loading: accountLoading, user } = usePointsAuth();
  const client = useMemo(() => createPolymarketPilot(), []);
  const session = useMemo(() => createPolymarketQuoteSession(client), [client]);
  const [markets, setMarkets] = useState([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState('');
  const [marketId, setMarketId] = useState('');
  const [outcomeIndex, setOutcomeIndex] = useState(0);
  const [side, setSide] = useState('buy');
  const [amount, setAmount] = useState('10');
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const [reload, setReload] = useState(0);
  const quoteGeneration = useRef(0);
  const market = markets.find(item => String(item.id) === marketId);
  const expired = quote ? polymarketQuoteExpired(quote, clock) : false;
  const canQuote = market && market.active && !market.closed && market.acceptingOrders
    && Array.isArray(market.outcomes) && market.outcomes.length === 2;

  const resetQuote = useCallback(() => {
    quoteGeneration.current += 1;
    session.cancel();
    setQuote(null);
    setQuoteError('');
    setQuoteLoading(false);
  }, [session]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setMarketsLoading(true);
    setMarketsError('');
    resetQuote();
    client.getMarkets({ signal: controller.signal }).then(result => {
      if (!active) return;
      setMarkets(result.markets);
      setMarketId(String(result.markets[0]?.id || ''));
      setOutcomeIndex(0);
    }).catch(error => {
      if (!active || error?.name === 'AbortError') return;
      setMarkets([]);
      setMarketId('');
      setMarketsError(error?.message || 'No se pudieron consultar los mercados.');
    }).finally(() => { if (active) setMarketsLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [client, reload, resetQuote]);

  useEffect(() => () => session.cancel(), [session]);
  useEffect(() => {
    if (!quote) return undefined;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [quote]);

  async function simulate(event) {
    event.preventDefault();
    if (!canQuote || quoteLoading) return;
    resetQuote();
    const generation = quoteGeneration.current;
    setQuoteLoading(true);
    try {
      const result = await session.getQuote({ marketId, outcomeIndex, side, amount });
      if (generation !== quoteGeneration.current) return;
      setClock(Date.now());
      setQuote(result.quote);
    } catch (error) {
      if (generation !== quoteGeneration.current || error?.name === 'AbortError') return;
      setQuoteError(error?.message || 'No se pudo simular la operación.');
    } finally {
      if (generation === quoteGeneration.current) setQuoteLoading(false);
    }
  }

  function change(setter, value) { resetQuote(); setter(value); }

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <main className="polymarket-pilot">
        <header>
          <p className="polymarket-pilot-eyebrow">Polymarket · Polygon · pUSD</p>
          <h1>Explora y simula mercados</h1>
          <p>Consulta hasta cinco mercados deportivos binarios activos y compara compras o ventas con las comisiones por separado.</p>
          <p className="polymarket-pilot-notice">Piloto de consulta con datos públicos reales. Esta pantalla no firma, envía órdenes ni mueve fondos.</p>
        </header>

        <section className="polymarket-pilot-account" aria-label="Cuenta y moneda del piloto">
          <div>
            <p>El saldo y las posiciones de Polymarket son independientes del MXNB de Pronos y del USDC de HIP-4. Aquí se cotiza en pUSD sobre Polygon.</p>
            <p>El usuario cubre las comisiones de trading, conversión, fondeo y retiro que correspondan. Pronos no ofrece subsidios ni anticipos en este piloto.</p>
            <p>Firma y fondeo de Polymarket pendientes.</p>
            {authenticated && user?.walletAddress && <p>Cartera Pronos <code>{user.walletAddress}</code>. No se ha conectado una cuenta Polymarket.</p>}
            {!authenticated && !accountLoading && <p>Puedes explorar y simular sin iniciar sesión.</p>}
          </div>
          {!authenticated && !accountLoading && <button type="button" className="btn-ghost" onClick={onOpenLogin}>Iniciar sesión en Pronos</button>}
        </section>

        <div className="polymarket-pilot-status" aria-live="polite">
          {marketsLoading && <p role="status">Consultando los mercados deportivos…</p>}
          {marketsError && <p role="alert">{marketsError}</p>}
          {!marketsLoading && !marketsError && markets.length === 0 && <p role="status">No hay mercados disponibles para este piloto en este momento.</p>}
        </div>

        <div className="polymarket-pilot-grid">
          <section className="polymarket-pilot-card" aria-labelledby="polymarket-simulate">
            <h2 id="polymarket-simulate">Simular compra o venta</h2>
            <form onSubmit={simulate}>
              <label>Mercado deportivo
                <select value={marketId} disabled={marketsLoading || markets.length === 0} onChange={event => {
                  change(setMarketId, event.target.value); setOutcomeIndex(0);
                }}>
                  {!markets.length && <option value="">Sin mercados disponibles</option>}
                  {markets.map(item => <option key={item.id} value={String(item.id)}>{item.title}</option>)}
                </select>
              </label>
              <label>Opción
                <select value={outcomeIndex} disabled={!market} onChange={event => change(setOutcomeIndex, Number(event.target.value))}>
                  {(market?.outcomes || []).map((outcome, index) => <option key={outcome.tokenId || index} value={index}>{outcome.label}</option>)}
                </select>
              </label>
              <label>Operación
                <select value={side} onChange={event => change(setSide, event.target.value)}><option value="buy">Comprar</option><option value="sell">Vender</option></select>
              </label>
              <label>{side === 'buy' ? 'Presupuesto total (pUSD), incluidas comisiones' : 'Participaciones a vender'}
                <input type="text" inputMode="decimal" value={amount} required onChange={event => change(setAmount, event.target.value)} aria-describedby="polymarket-amount-help" />
              </label>
              <p id="polymarket-amount-help">{side === 'buy'
                ? 'La compra simulada debe caber dentro de este presupuesto después de las comisiones.'
                : 'La venta se simula con las participaciones indicadas. Aquí no se verifica que las tengas en tu cartera.'}</p>
              <button type="submit" className="btn-primary" disabled={!canQuote || quoteLoading || marketsLoading}>{quoteLoading ? 'Consultando el libro…' : side === 'buy' ? 'Simular compra' : 'Simular venta'}</button>
              <button type="button" className="btn-ghost" disabled={marketsLoading} onClick={() => setReload(value => value + 1)}>Actualizar mercados</button>
            </form>
            {market && !canQuote && <p role="status">Este mercado no acepta nuevas órdenes o no cumple los criterios del piloto.</p>}
            {quoteError && <p role="alert">{quoteError}</p>}
          </section>
          {market && <MarketRules market={market} />}
        </div>
        {quote && <QuoteDetails quote={quote} expired={expired} side={side} title={market?.title}
          outcome={market?.outcomes?.[outcomeIndex]?.label} />}
      </main>
      <Footer />
    </>
  );
}
