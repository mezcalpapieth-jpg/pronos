import React, { useEffect, useState } from 'react';
import { externalBookMarketId, watchHyperCoreBook, watchSkewBook } from '../lib/externalMarketBooks.js';
import './ExternalMarketBooks.css';

const CONNECTING = { status: 'connecting' };
const PHASE_LABELS = {
  open: ['Open', 'Abierto'],
  expired: ['Expired', 'Vencido'],
  settled: ['Settled', 'Liquidado'],
  unregistered: ['Unlisted on Skew', 'Sin registro en Skew'],
};
const SKEW_LAYERS = [
  {
    key: 'hl',
    title: ['HyperCore book via Skew', 'Libro de HyperCore vía Skew'],
    description: [
      'Skew displays the same HyperCore book on a 0.001 USDC price grid.',
      'Skew muestra el mismo libro de HyperCore con incrementos de 0.001 USDC.',
    ],
  },
  {
    key: 'pool',
    title: ['Skew held orders', 'Órdenes en reserva de Skew'],
    description: [
      'Maker orders held by Skew. Orders can fill partially, expire or be withdrawn.',
      'Órdenes de creadores de mercado en reserva en Skew. Pueden ejecutarse parcialmente, vencer o retirarse.',
    ],
  },
  {
    key: 'rfq',
    title: ['Skew RFQ', 'RFQ de Skew'],
    description: [
      'Indicative quote depth. A quote does not guarantee a fill.',
      'Profundidad indicativa de cotizaciones. Una cotización no garantiza una ejecución.',
    ],
  },
];

function Stamp({ time, lang, label }) {
  const date = new Date(time);
  const local = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-MX', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'America/Mexico_City',
  }).format(date);
  return (
    <p className="external-panel-note external-book-stamp">
      {label} · <time dateTime={date.toISOString()}>{local} (CDMX)</time>
    </p>
  );
}

function Status({ status, en }) {
  if (status === 'live') return null;
  const text = {
    connecting: en ? 'Waiting for book data…' : 'Esperando datos del libro…',
    stale: en ? 'Book data is out of date.' : 'Los datos del libro están desactualizados.',
    unavailable: en ? 'Book data is unavailable.' : 'Los datos del libro no están disponibles.',
  };
  return <p className="external-panel-note external-book-status" role="status">{text[status]}</p>;
}

function BookTable({ title, rows, en }) {
  const locale = en ? 'en-US' : 'es-MX';
  const price = new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 5 });
  const shares = new Intl.NumberFormat(locale);
  return (
    <table className="external-book-table">
      <caption>{title}</caption>
      <thead>
        <tr><th scope="col">{en ? 'Price (USDC)' : 'Precio (USDC)'}</th><th scope="col">{en ? 'Shares' : 'Acciones'}</th></tr>
      </thead>
      <tbody>
        {rows.length > 0 ? rows.slice(0, 5).map(level => (
          <tr key={level.price}><td>{price.format(level.price)}</td><td>{shares.format(level.shares)}</td></tr>
        )) : (
          <tr><td colSpan={2}>{en ? 'No orders' : 'Sin órdenes'}</td></tr>
        )}
      </tbody>
    </table>
  );
}

function BookSides({ book, lang }) {
  const en = lang === 'en';
  return (
    <div className="external-book-sides">
      <BookTable title={en ? 'Bids' : 'Compras'} rows={book.bids} en={en} />
      <BookTable title={en ? 'Asks' : 'Ventas'} rows={book.asks} en={en} />
    </div>
  );
}

function hasDepth(layer) {
  return Boolean(layer && (layer.bids.length || layer.asks.length));
}

function skewLayerStatus(view, key) {
  if (view.status !== 'live') return view.status;
  if (!view.feed) return 'connecting';
  const layer = view.book.layers[key];
  if (view.feed === 'down' || ['expired', 'settled'].includes(view.book.phase)
    || (key !== 'hl' && view.book.phase !== 'open')) return 'unavailable';
  if (layer?.stale || (key === 'hl' && view.feed === 'stale')) return 'stale';
  return !hasDepth(layer) || layer.reason ? 'unavailable' : 'live';
}

function NativeBook({ view, lang, fallback = false }) {
  const en = lang === 'en';
  return (
    <div className="external-book-layer">
      <h3>{fallback
        ? (en ? 'HyperCore book · direct connection' : 'Libro de HyperCore · conexión directa')
        : 'HyperCore'}</h3>
      <Status status={view.status} en={en} />
      {view.book && <Stamp time={view.book.time} lang={lang} label={en ? 'Last snapshot' : 'Última captura'} />}
      {view.status === 'live' && <BookSides book={view.book} lang={lang} />}
    </div>
  );
}

function SkewBooks({ native, skew, lang }) {
  const index = lang === 'en' ? 0 : 1;
  const en = index === 0;
  return (
    <>
      <p className="external-panel-note">{en
        ? 'All levels show the Yes side. Each source has a separate depth table.'
        : 'Todos los niveles corresponden al lado Sí. Cada fuente tiene su propia tabla de profundidad.'}</p>
      {skew.book && (
        <>
          <p className="external-book-phase">{PHASE_LABELS[skew.book.phase][index]}</p>
          <Stamp time={skew.book.time} lang={lang} label={en ? 'Last change from Skew' : 'Último cambio de Skew'} />
        </>
      )}
      {SKEW_LAYERS.map(layer => {
        const status = skewLayerStatus(skew, layer.key);
        return (
          <div className="external-book-layer" key={layer.key}>
            <h3>{layer.title[index]}</h3>
            <p className="external-panel-note">{layer.description[index]}</p>
            <Status status={status} en={en} />
            {status === 'live' && <BookSides book={skew.book.layers[layer.key]} lang={lang} />}
          </div>
        );
      })}
      {skewLayerStatus(skew, 'hl') !== 'live' && !['expired', 'settled'].includes(skew.book?.phase) && (
        <NativeBook view={native} lang={lang} fallback />
      )}
    </>
  );
}

function useNativeBook(marketId, side) {
  const [current, setCurrent] = useState({ marketId, side, view: CONNECTING });
  useEffect(() => watchHyperCoreBook(marketId, side, view => setCurrent({ marketId, side, view })), [marketId, side]);
  return current.marketId === marketId && current.side === side ? current.view : CONNECTING;
}

function useSkewBook(marketId, enabled) {
  const [current, setCurrent] = useState({ marketId, view: CONNECTING });
  useEffect(() => {
    if (enabled) return watchSkewBook(marketId, view => setCurrent({ marketId, view }));
    return undefined;
  }, [marketId, enabled]);
  return current.marketId === marketId ? current.view : CONNECTING;
}

function LiveBooks({ market, marketId, lang }) {
  const [side, setSide] = useState(0);
  const isSkew = market.venue === 'skew';
  const en = lang === 'en';
  const native = useNativeBook(marketId, side);
  const skew = useSkewBook(marketId, isSkew);
  return (
    <section className="external-panel external-book" aria-labelledby="external-book-title">
      <h2 id="external-book-title">{en ? 'Live order book' : 'Libro de órdenes en vivo'}</h2>
      {isSkew ? <SkewBooks native={native} skew={skew} lang={lang} /> : (
        <>
          <div className="external-market-filters external-book-outcomes" role="group" aria-label={en ? 'Outcome' : 'Resultado'}>
            {market.outcomes.map((outcome, index) => (
              <button key={outcome.label} type="button" aria-pressed={side === index} onClick={() => setSide(index)}>
                {en && outcome.label === 'Sí' ? 'Yes' : outcome.label}
              </button>
            ))}
          </div>
          <NativeBook view={native} lang={lang} />
        </>
      )}
    </section>
  );
}

export default function ExternalMarketBooks({ market, lang }) {
  const marketId = externalBookMarketId(market);
  return marketId ? <LiveBooks key={market.id} market={market} marketId={marketId} lang={lang} /> : null;
}
