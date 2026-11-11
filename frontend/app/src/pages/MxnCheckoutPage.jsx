import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import {
  checkoutMarketKey, checkoutQuoteExpired, createMxnCheckoutClient,
  QUOTE_STATUS, TICKETS_MXN, VENUES,
} from '../lib/mxnCheckout.js';
import './MxnCheckoutPage.css';

const cash = new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', maximumFractionDigits: 2,
});
const smallCash = new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', maximumFractionDigits: 6,
});
const quantity = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 6 });
const mexicoCity = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'America/Mexico_City',
});

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value) {
  const amount = number(value);
  if (amount === null) return '—';
  return (Math.abs(amount) > 0 && Math.abs(amount) < 0.01 ? smallCash : cash).format(amount);
}

function amountLabel(value) {
  const amount = number(value);
  return amount === null ? '—' : quantity.format(amount);
}

function dateLabel(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? mexicoCity.format(time) : 'Sin verificar';
}

function percentBps(bps) {
  return bps === null || bps === undefined ? '—' : `${amountLabel(Number(bps) / 100)}%`;
}

function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function SegmentedOptions({ label, name, value, options, onChange }) {
  return (
    <fieldset className="mxn-checkout-segments">
      <legend>{label}</legend>
      <div>
        {options.map(option => (
          <label key={option.value}>
            <input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function MarketTerms({ market }) {
  const deadline = market.cancellationDeadline;
  const isoDeadline = /^\d{4}-\d{2}-\d{2}T/.test(deadline ?? '') && Number.isFinite(Date.parse(deadline));
  const sourceUrl = httpsUrl(market.sourceUrl);
  return (
    <div className="mxn-checkout-terms">
      <strong>{VENUES[market.venue]} · {market.network} · {market.collateral}</strong>
      <p>Si el evento se cancela sin resultado según las reglas del mercado, cada participación paga 0.50 {market.collateral}.</p>
      {deadline && (
        <p>Plazo por falta de resultado · {isoDeadline
          ? <time dateTime={deadline}>{dateLabel(deadline)} CDMX</time>
          : <span lang="en">{deadline}</span>}</p>
      )}
      {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Ver fuente</a>}
    </div>
  );
}

function QuoteResult({ quote, market, side }) {
  const [clock, setClock] = useState(Date.now);
  const expired = checkoutQuoteExpired(quote, clock);
  const isBuy = side === 'buy';
  const venueEstimate = quote.venueFeeStatus === 'scenario';
  const builderEstimate = quote.builderFeeStatus === 'scenario';

  useEffect(() => {
    const now = Date.now();
    setClock(now);
    const delay = Math.max(0, Date.parse(quote.expiresAt) - now);
    const timeout = setTimeout(() => setClock(Date.now()), delay);
    return () => clearTimeout(timeout);
  }, [quote]);

  const status = expired ? 'Cotización caducada' : QUOTE_STATUS[quote.status];
  const statusStyle = expired || !quote.eligible ? ' mxn-checkout-flag-alert' : '';

  return (
    <section className="mxn-checkout-card mxn-checkout-result" aria-labelledby="mxn-checkout-summary">
      <div className="mxn-checkout-result-head">
        <div>
          <h2 id="mxn-checkout-summary">{isBuy ? 'Compra simulada' : 'Venta simulada'}</h2>
          <p>{market.title} · {VENUES[market.venue]}</p>
        </div>
        <span className={`mxn-checkout-flag${statusStyle}`} role="status">{status}</span>
      </div>
      <dl className="mxn-checkout-total">
        <div>
          <dt>{isBuy ? 'Gasto estimado' : 'Ingreso neto estimado'}</dt>
          <dd>{money(quote.netMxn)} <small>MXN</small></dd>
        </div>
        <div>
          <dt>Participaciones visibles</dt>
          <dd>{amountLabel(quote.filledShares)}{quote.requestedShares != null && ` / ${amountLabel(quote.requestedShares)}`}</dd>
        </div>
      </dl>
      <dl className="mxn-checkout-costs">
        <div><dt>Importe antes de comisiones</dt><dd>{money(quote.grossMxn)}</dd></div>
        <div><dt>Comisión {VENUES[market.venue]}{venueEstimate && ' estimada'}</dt><dd>{money(quote.venueFeeMxn)}</dd></div>
        <div>
          <dt>Comisión Pronos {builderEstimate ? 'estimada' : 'vigente'} · {percentBps(quote.builderFeeBps)}</dt>
          <dd>{money(quote.pronosFeeMxn)}</dd>
        </div>
        <div className="mxn-checkout-cap"><dt>Comisiones de trading · Límite {percentBps(quote.feeCapBps)}</dt><dd>{percentBps(quote.feeBps)}</dd></div>
        <div><dt>Tipo de cambio indicativo de Bitso</dt><dd>{amountLabel(quote.fxRate)} MXN/USD</dd></div>
        <div><dt>Impacto del diferencial cambiario incluido</dt><dd>{money(quote.fxCostMxn)}</dd></div>
        <div><dt>Fondeo y retiro</dt><dd>{quote.fundingCostMxn == null ? 'Sin cotizar' : money(quote.fundingCostMxn)}</dd></div>
        {isBuy && <div><dt>Presupuesto disponible después de la compra</dt><dd>{money(quote.remainingMxn)}</dd></div>}
        <div><dt>Vigencia</dt><dd>{dateLabel(quote.expiresAt)} CDMX</dd></div>
      </dl>
      <p className="mxn-checkout-help">
        La simulación parte de un saldo existente en {market.collateral}. Si necesitas fondear o retirar, esos costos se cotizan aparte y corren por tu cuenta.
      </p>
      {expired && <p role="status">Solicita una nueva cotización para consultar el libro actual.</p>}
    </section>
  );
}

export default function MxnCheckoutPage({ onOpenLogin }) {
  const { search } = useLocation();
  const preferredVenue = new URLSearchParams(search).get('venue');
  const client = useMemo(() => createMxnCheckoutClient(), []);
  const quoteController = useRef(null);
  const [markets, setMarkets] = useState([]);
  const [unavailable, setUnavailable] = useState([]);
  const [marketKey, setMarketKey] = useState('');
  const [outcomeIndex, setOutcomeIndex] = useState(0);
  const [side, setSide] = useState('buy');
  const [ticket, setTicket] = useState(300);
  const [quote, setQuote] = useState(null);
  const [catalogPending, setCatalogPending] = useState(true);
  const [quotePending, setQuotePending] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const [reload, setReload] = useState(0);
  const market = markets.find(item => checkoutMarketKey(item) === marketKey);

  const resetQuote = useCallback(() => {
    quoteController.current?.abort();
    quoteController.current = null;
    setQuote(null);
    setQuoteError('');
    setQuotePending(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    resetQuote();
    setCatalogPending(true);
    setCatalogError('');
    setUnavailable([]);
    client.getMarkets({ signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      const first = result.markets.find(item => item.venue === preferredVenue) || result.markets[0];
      setMarkets(result.markets);
      setUnavailable(result.unavailableVenues);
      setMarketKey(first ? checkoutMarketKey(first) : '');
      setOutcomeIndex(first?.outcomes[0].index ?? 0);
    }).catch(error => {
      if (!controller.signal.aborted) {
        setMarkets([]);
        setMarketKey('');
        setCatalogError(error.message);
      }
    }).finally(() => {
      if (!controller.signal.aborted) setCatalogPending(false);
    });
    return () => controller.abort();
  }, [client, preferredVenue, reload, resetQuote]);

  useEffect(() => () => {
    quoteController.current?.abort();
    quoteController.current = null;
  }, []);

  async function simulate(event) {
    event.preventDefault();
    if (!market || catalogPending || quoteController.current) return;
    setQuote(null);
    setQuoteError('');
    setQuotePending(true);
    const controller = new AbortController();
    quoteController.current = controller;
    try {
      const result = await client.getQuote({ market, outcomeIndex, side, amountMxn: ticket }, { signal: controller.signal });
      if (quoteController.current !== controller) return;
      setMarkets(items => items.map(item => checkoutMarketKey(item) === marketKey ? result.market : item));
      setQuote(result.quote);
    } catch (error) {
      if (quoteController.current === controller) setQuoteError(error.message);
    } finally {
      if (quoteController.current === controller) {
        quoteController.current = null;
        setQuotePending(false);
      }
    }
  }

  function change(setter, value) {
    resetQuote();
    setter(value);
  }

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <main className="mxn-checkout">
        <header>
          <h1>Cotiza en pesos mexicanos</h1>
          <p>Simula compras y ventas en los libros públicos de HIP-4 y Polymarket.</p>
        </header>
        <div className="mxn-checkout-layout">
          <section className="mxn-checkout-card" aria-labelledby="mxn-checkout-order">
            <h2 id="mxn-checkout-order">Datos de la operación</h2>
            <form onSubmit={simulate}>
              <label>Mercado
                <select value={marketKey} disabled={catalogPending || !markets.length} onChange={event => {
                  change(setMarketKey, event.target.value);
                  setOutcomeIndex(markets.find(item => checkoutMarketKey(item) === event.target.value)?.outcomes[0].index ?? 0);
                }}>
                  {!markets.length && <option value="">{catalogPending ? 'Consultando mercados…' : 'Sin mercados disponibles'}</option>}
                  {Object.entries(VENUES).map(([venue, label]) => {
                    const listings = markets.filter(item => item.venue === venue);
                    return listings.length > 0 && (
                      <optgroup key={venue} label={label}>
                        {listings.map(item => <option key={checkoutMarketKey(item)} value={checkoutMarketKey(item)}>{item.title}</option>)}
                      </optgroup>
                    );
                  })}
                </select>
              </label>
              <label>Resultado
                <select value={outcomeIndex} disabled={catalogPending || !market} onChange={event => change(setOutcomeIndex, Number(event.target.value))}>
                  {!market && <option value={0}>Selecciona un mercado</option>}
                  {market?.outcomes.map(item => <option key={item.index} value={item.index}>{item.label}</option>)}
                </select>
              </label>
              <SegmentedOptions label="Operación" name="mxn-checkout-side" value={side}
                options={[{ value: 'buy', label: 'Comprar' }, { value: 'sell', label: 'Vender' }]}
                onChange={value => change(setSide, value)} />
              <SegmentedOptions label={side === 'buy' ? 'Presupuesto en MXN' : 'Valor de referencia en MXN'}
                name="mxn-checkout-ticket" value={ticket} options={TICKETS_MXN.map(value => ({ value, label: `$${quantity.format(value)}` }))}
                onChange={value => change(setTicket, value)} />
              <p className="mxn-checkout-help">{side === 'buy'
                ? 'El presupuesto incluye las comisiones de trading.'
                : 'El monto de referencia determina cuántas participaciones se simulan. El ingreso puede variar.'}</p>
              <button className="btn-primary" type="submit" disabled={catalogPending || quotePending || !market}>
                {quotePending ? 'Consultando el libro…' : 'Cotizar'}
              </button>
              <button className="btn-ghost" type="button" disabled={catalogPending} onClick={() => {
                resetQuote();
                setCatalogPending(true);
                setReload(value => value + 1);
              }}>Actualizar mercados</button>
              {catalogError && <p role="alert">{catalogError}</p>}
              {unavailable.length > 0 && <p role="status">Sin respuesta de {unavailable.map(venue => VENUES[venue]).join(' y ')}.</p>}
              {quoteError && <p role="alert">{quoteError}</p>}
            </form>
            {market && <MarketTerms market={market} />}
          </section>
          {quote && market && <QuoteResult key={quote.expiresAt} quote={quote} market={market} side={side} />}
        </div>
        <p className="mxn-checkout-help mxn-checkout-disclosure">
          Las cotizaciones son indicativas. Cada plataforma tiene su propio saldo y cada mercado sus reglas. Esta pantalla no envía órdenes.
        </p>
      </main>
      <Footer />
    </>
  );
}
