import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import {
  checkoutMarketKey, checkoutQuoteExpired, createMxnCheckoutClient,
  FUNDING_QUOTE_STATUS, QUOTE_STATUS, TICKETS_MXN, VENUES,
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

function fundingAmount(value) {
  if (!value) return 'Sin confirmar';
  const formatted = value.asset === 'MXN' ? money(value.amount) : amountLabel(value.amount);
  return `${formatted} ${value.asset}`;
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

function useQuoteExpired(expiresAt) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!expiresAt) return;
    const now = Date.now();
    setClock(now);
    const delay = Math.max(0, Date.parse(expiresAt) - now);
    const timeout = setTimeout(() => setClock(Date.now()), delay);
    return () => clearTimeout(timeout);
  }, [expiresAt]);
  return expiresAt != null && checkoutQuoteExpired({ expiresAt }, clock);
}

function QuoteResult({ quote, market, side }) {
  const expired = useQuoteExpired(quote.expiresAt);
  const isBuy = side === 'buy';
  const venueEstimate = quote.venueFeeStatus === 'scenario';
  const builderEstimate = quote.builderFeeStatus === 'scenario';

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
        La simulación parte de un saldo existente en {market.collateral}. Puedes <a href="#mxn-checkout-funding">cotizar un depósito o retiro</a> por separado.
      </p>
      {expired && <p role="status">Solicita una nueva cotización para consultar el libro actual.</p>}
    </section>
  );
}

const FUNDING_FEE_LABELS = {
  bitso_conversion: 'Conversión de Bitso',
  bitso_polygon_payout: 'Envío de USDC de Bitso',
  spei_in: 'Depósito por SPEI',
  spei_out: 'Retiro por SPEI',
  polygon_source_gas: 'Comisión de red en Polygon',
  cctp_protocol: 'Comisión del puente Circle',
  cctp_forwarding: 'Envío a HyperCore',
  cctp_withdrawal_max: 'Cargo máximo del puente Circle',
  hypercore_withdrawal: 'Retiro desde HyperCore',
  hypercore_activation: 'Activación de HyperCore en la primera salida',
  polymarket_bridge_cost: 'Comisión del puente de Polymarket',
  polymarket_bridge_gas: 'Comisión de red de Polymarket',
};

const FUNDING_REASON_LABELS = {
  partner_quote_required: 'Los importes finales dependen de la cotización de los proveedores.',
  provider_quote_unavailable: 'El proveedor de la ruta no devolvió una cotización vigente.',
  fx_unavailable: 'El tipo de cambio no está disponible.',
  below_provider_minimum: 'El monto queda por debajo del mínimo de la ruta.',
};

function FundingResult({ quote }) {
  const expired = useQuoteExpired(quote.expiresAt);
  const status = expired ? 'Cotización caducada' : FUNDING_QUOTE_STATUS[quote.status];
  const deposit = quote.direction === 'deposit';
  const separateFees = quote.fees.some(fee => !fee.includedInEstimate && fee.type !== 'hypercore_activation');
  const receiveLabel = separateFees ? 'Recepción estimada antes de costos adicionales' : 'Recepción estimada';
  const reason = Object.hasOwn(FUNDING_REASON_LABELS, quote.reason) ? FUNDING_REASON_LABELS[quote.reason] : null;
  const statusStyle = expired || quote.status !== 'indicative' ? ' mxn-checkout-flag-alert' : '';
  const eta = quote.estimatedSeconds;
  return (
    <section className="mxn-checkout-card mxn-checkout-result" aria-labelledby="mxn-funding-summary">
      <div className="mxn-checkout-result-head">
        <div>
          <h3 id="mxn-funding-summary">{deposit ? 'Depósito simulado' : 'Retiro simulado'}</h3>
          <p>{quote.route.join(' → ')}</p>
        </div>
        <span className={`mxn-checkout-flag${statusStyle}`} role="status">{status}</span>
      </div>
      <dl className="mxn-checkout-total">
        <div>
          <dt>{deposit ? 'Presupuesto de depósito' : 'Saldo estimado a debitar'}</dt>
          <dd>{fundingAmount(quote.debit)}</dd>
        </div>
        <div>
          <dt>{receiveLabel}{quote.estimatedFirstWithdrawalReceive && ' · cuenta activa'}</dt>
          <dd>{fundingAmount(quote.estimatedReceive)}</dd>
        </div>
      </dl>
      <dl className="mxn-checkout-costs">
        <div><dt>Mínimo a recibir</dt><dd>{quote.minimumReceive ? fundingAmount(quote.minimumReceive) : 'Sin garantía'}</dd></div>
        {quote.providerMinimum && (
          <div>
            <dt>Mínimo del puente</dt>
            <dd>{quote.providerMinimum.comparison === 'greater_than' ? 'Más de' : 'Desde'} {fundingAmount(quote.providerMinimum)}</dd>
          </div>
        )}
        {quote.estimatedFirstWithdrawalReceive && (
          <div>
            <dt>{receiveLabel} en la primera salida</dt>
            <dd>{fundingAmount(quote.estimatedFirstWithdrawalReceive)}</dd>
          </div>
        )}
        {quote.fxRate && <div><dt>Tipo de cambio indicativo de Bitso</dt><dd>{amountLabel(quote.fxRate)} MXN/USD</dd></div>}
        {quote.fxSpreadMxn != null && <div><dt>Diferencial cambiario incluido</dt><dd>{money(quote.fxSpreadMxn)} MXN</dd></div>}
        {quote.fees.map(fee => (
          <div key={`${fee.type}:${fee.asset}`}>
            <dt>
              {Object.hasOwn(FUNDING_FEE_LABELS, fee.type) ? FUNDING_FEE_LABELS[fee.type] : 'Cargo del proveedor'}
              {fee.status === 'indicative' && ' · estimado'}
              {fee.amount != null && fee.type !== 'hypercore_activation' && (fee.includedInEstimate ? ' · incluido' : ' · por separado')}
            </dt>
            <dd>{fundingAmount(fee.amount == null ? null : fee)}</dd>
          </div>
        ))}
        <div><dt>Comisión Pronos por el movimiento</dt><dd>{money(quote.pronosFeeMxn)} MXN</dd></div>
        <div><dt>Vigencia</dt><dd>{quote.expiresAt ? `${dateLabel(quote.expiresAt)} CDMX` : 'Sin confirmar'}</dd></div>
        <div>
          <dt>{quote.estimatedSecondsScope === 'provider_leg' ? 'Tiempo estimado del puente' : 'Tiempo estimado'}</dt>
          <dd>{eta == null ? 'Sin confirmar' : eta < 60 ? `${eta} s` : `${Math.ceil(eta / 60)} min`}</dd>
        </div>
      </dl>
      {reason && <p className="mxn-checkout-help">{reason}</p>}
      <p className="mxn-checkout-help">Los costos de conversión, red y proveedores corren por tu cuenta.</p>
      {expired && <p role="status">Solicita una nueva cotización para actualizar los importes.</p>}
    </section>
  );
}

function FundingCheckout({ client, preferredVenue }) {
  const request = useRef(null);
  const [venue, setVenue] = useState(Object.hasOwn(VENUES, preferredVenue) ? preferredVenue : 'hip4');
  const [direction, setDirection] = useState('deposit');
  const [ticket, setTicket] = useState(300);
  const [quote, setQuote] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  function change(setter, value) {
    request.current?.abort();
    request.current = null;
    setQuote(null);
    setError('');
    setPending(false);
    setter(value);
  }

  async function estimate(event) {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setQuote(null);
    setError('');
    setPending(true);
    try {
      const result = await client.getFundingQuote({ venue, direction, amountMxn: ticket }, { signal: controller.signal });
      if (request.current === controller) setQuote(result);
    } catch (error) {
      if (request.current === controller) setError(error.message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return (
    <div className="mxn-checkout-layout" id="mxn-checkout-funding">
      <section className="mxn-checkout-card" aria-labelledby="mxn-funding-heading">
        <h2 id="mxn-funding-heading">Depósitos y retiros</h2>
        <form onSubmit={estimate} aria-busy={pending}>
          <SegmentedOptions label="Plataforma" name="mxn-funding-venue" value={venue}
            options={Object.entries(VENUES).map(([value, label]) => ({ value, label }))}
            onChange={value => change(setVenue, value)} />
          <SegmentedOptions label="Movimiento" name="mxn-funding-direction" value={direction}
            options={[{ value: 'deposit', label: 'Depositar' }, { value: 'withdrawal', label: 'Retirar' }]}
            onChange={value => change(setDirection, value)} />
          <SegmentedOptions label={direction === 'deposit' ? 'Presupuesto en MXN' : 'Valor de referencia en MXN'}
            name="mxn-funding-ticket" value={ticket} options={TICKETS_MXN.map(value => ({ value, label: `$${quantity.format(value)}` }))}
            onChange={value => change(setTicket, value)} />
          <p className="mxn-checkout-help">{direction === 'deposit'
            ? 'Consulta cuánto saldo recibirías con un depósito por SPEI.'
            : 'El monto en pesos determina cuánto saldo se simula retirar. El importe recibido depende de las comisiones.'}</p>
          <button className="btn-primary" type="submit" disabled={pending}>
            {pending ? 'Consultando la ruta…' : direction === 'deposit' ? 'Cotizar depósito' : 'Cotizar retiro'}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      </section>
      {quote && <FundingResult quote={quote} />}
    </div>
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
          <p>Simula compras y ventas en HIP-4 y Polymarket. <a href="#mxn-checkout-funding">Cotiza un depósito o retiro.</a></p>
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
        <FundingCheckout key={preferredVenue} client={client} preferredVenue={preferredVenue} />
        <p className="mxn-checkout-help mxn-checkout-disclosure">
          Pantalla de consulta. Cada plataforma tiene su propio saldo y cada mercado sus reglas.
        </p>
      </main>
      <Footer />
    </>
  );
}
