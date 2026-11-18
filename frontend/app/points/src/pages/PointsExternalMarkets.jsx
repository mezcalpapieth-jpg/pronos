import React, { useEffect, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLang, useT } from '@app/lib/i18n.js';
import { pointsPublicAssetSrc } from '@app/lib/publicAssets.js';
import { getExternalMarkets } from '../lib/externalMarkets.js';
import historyByMarket from '../lib/externalMarketHistory.json';
import { MARKET_CATEGORY_IMAGE_PLACEHOLDERS } from '../lib/marketImages.js';
import { normalizeSearchText } from '../lib/marketSearch.js';
import ExternalMarketHistory from '../components/ExternalMarketHistory.jsx';
import './PointsExternalMarkets.css';

const PREVIEW_PATH = '/external-markets';
const CARD_OUTCOME_LIMIT = 3;
const CATEGORY_ARTWORK = {
  cripto: 'crypto',
  economia: 'finanzas',
  sports: 'deportes',
  finance: 'finanzas',
};
const VENUE_NAMES = {
  polymarket: 'Polymarket',
  outcome: 'Outcome.xyz',
  'trade-xyz': 'Trade[XYZ] Events',
  skew: 'Skew',
};

function categoryArtwork(category) {
  const key = normalizeSearchText(category);
  const image = MARKET_CATEGORY_IMAGE_PLACEHOLDERS[CATEGORY_ARTWORK[key] || key];
  return pointsPublicAssetSrc(image || MARKET_CATEGORY_IMAGE_PLACEHOLDERS.general);
}

function sourceHref(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function formatDate(value, lang, showTime) {
  // A date-only field or timestamp without an offset has no verified time of day.
  if (typeof value !== 'string') return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dateOnly && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const options = {
    dateStyle: showTime ? 'long' : 'medium',
    timeZone: dateOnly ? 'UTC' : 'America/Mexico_City',
  };
  if (showTime && !dateOnly) options.timeStyle = 'short';
  const label = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-MX', options).format(date);
  return showTime && !dateOnly ? `${label} (CDMX)` : label;
}

function ScheduleValue({ entry, lang, showTime = false }) {
  const date = formatDate(entry.at, lang, showTime);
  if (date) return <time dateTime={entry.at}>{date}</time>;
  return entry.value || null;
}

function OutcomeRows({ outcomes, lang, compact = false }) {
  const en = lang === 'en';
  const visibleOutcomes = compact ? outcomes.slice(0, CARD_OUTCOME_LIMIT) : outcomes;

  return (
    <ul className={`external-outcome-list${compact ? ' external-outcome-list-compact' : ''}`}>
      {visibleOutcomes.map((outcome, index) => {
        const hasValue = outcome.value !== null && outcome.value !== undefined && outcome.value !== '';
        return (
          <li key={`${outcome.label}-${index}`}>
            <span>{outcome.label}</span>
            <span className={`external-outcome-value${hasValue ? '' : ' is-missing'}`}>
              {hasValue ? outcome.value : en ? 'Unavailable' : 'Sin referencia'}
            </span>
          </li>
        );
      })}
      {visibleOutcomes.length < outcomes.length && (
        <li className="external-outcome-overflow">
          +{outcomes.length - visibleOutcomes.length} {en ? 'more' : 'más'}
        </li>
      )}
    </ul>
  );
}

function PreviewCard({ market, search, lang }) {
  const en = lang === 'en';
  const firstDate = (market.schedule ?? []).find(entry => formatDate(entry.at, lang, false));
  const outcomes = market.outcomes ?? [];
  const titleId = `external-card-${market.id}`;

  return (
    <Link
      className="points-market-card mock-card external-market-card"
      aria-labelledby={titleId}
      to={{ pathname: `${PREVIEW_PATH}/${encodeURIComponent(market.id)}`, search }}
    >
      <div className="mock-card-header points-card-badges">
        <span className="points-card-category">{market.category}</span>
      </div>
      <div className="mock-card-body">
        <div className="external-card-heading">
          <img src={categoryArtwork(market.category)} alt="" width="46" height="46" />
          <h2 className="mock-card-title" id={titleId}>{market.title}</h2>
        </div>
        {outcomes.length > 0 && <OutcomeRows outcomes={outcomes} lang={lang} compact />}
      </div>
      <div className="mock-card-footer">
        <span className="mock-card-deadline">
          {firstDate && <>
            {firstDate.label} · <ScheduleValue entry={firstDate} lang={lang} />
          </>}
        </span>
        <span className="external-card-open">{en ? 'View market' : 'Ver mercado'} <span aria-hidden="true">→</span></span>
      </div>
    </Link>
  );
}

function PreviewList({ markets, headingRef, lang }) {
  const en = lang === 'en';
  const [params, setParams] = useSearchParams();
  const categories = Array.from(new Set(markets.map(market => market.category).filter(Boolean)));
  const selected = categories.find(category => params.get('category') === category);
  const query = normalizeSearchText(params.get('q'));
  const visible = markets.filter(market => {
    if (selected && market.category !== selected) return false;
    if (!query) return true;
    const fields = [market.title, market.officialTitle, market.category, ...(market.outcomes ?? []).map(outcome => outcome.label)];
    return fields.some(field => normalizeSearchText(field).includes(query));
  });

  function selectCategory(category) {
    const next = new URLSearchParams(params);
    if (category) next.set('category', category);
    else next.delete('category');
    setParams(next, { replace: true });
  }

  return (
    <main className="external-markets" aria-labelledby="external-markets-title">
      <header className="external-page-header">
        <h1 id="external-markets-title" ref={headingRef} tabIndex={-1}>{en ? 'Markets' : 'Mercados'}</h1>
        <p>{en ? 'Read-only preview. Prices are recorded references.' : 'Vista previa de solo consulta. Los precios son referencias registradas.'}</p>
      </header>
      {categories.length > 1 && (
        <div className="external-market-filters" role="group" aria-label={en ? 'Filter by category' : 'Filtrar por categoría'}>
          <button type="button" aria-pressed={!selected} onClick={() => selectCategory(null)}>
            {en ? 'All' : 'Todos'}
          </button>
          {categories.map(category => (
            <button key={category} type="button" aria-pressed={selected === category} onClick={() => selectCategory(category)}>
              {category}
            </button>
          ))}
        </div>
      )}
      <div className="external-market-grid">
        {visible.map(market => (
          <PreviewCard key={market.id} market={market} lang={lang} search={params.toString()} />
        ))}
      </div>
      {visible.length === 0 && (
        <p className="external-empty">{en ? 'No markets match.' : 'Sin coincidencias.'}</p>
      )}
    </main>
  );
}

function SourceLink({ href, children }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children} <span aria-hidden="true">↗</span></a>;
}

function MarketDetail({ market, headingRef, lang }) {
  const en = lang === 'en';
  const t = useT();
  const [params] = useSearchParams();
  const venue = VENUE_NAMES[market.venue] || market.venue;
  const sourceUrl = sourceHref(market.sourceUrl);
  const rulesUrl = sourceHref(market.rulesUrl);
  const venueUrl = sourceHref(market.venueUrl);
  const resolutionSourceUrl = sourceHref(market.resolutionSourceUrl);
  const capturedAt = formatDate(market.capturedAt, lang, true);
  const priceCapturedAt = formatDate(market.priceCapturedAt, lang, true);
  const outcomes = market.outcomes ?? [];
  const schedule = (market.schedule ?? []).filter(entry => entry.value || formatDate(entry.at, lang, true));
  const rules = market.rules ?? [];
  const facts = market.facts ?? [];
  const showOriginalTitle = market.officialTitle && market.officialTitle !== market.title;

  return (
    <main className="external-markets external-market-detail" aria-labelledby="external-market-title">
      <Link className="external-market-back" to={{ pathname: PREVIEW_PATH, search: params.toString() }}>
        {t('points.detail.backToMarkets')}
      </Link>
      <header className="external-detail-header">
        <div className="external-venue-label"><span>{en ? 'Third-party market' : 'Mercado de terceros'}</span><strong>{venue}</strong></div>
        <div className="external-detail-title-row">
          <img src={categoryArtwork(market.category)} alt="" width="56" height="56" />
          <div>
            <p className="external-detail-category">{market.category}</p>
            <h1 id="external-market-title" ref={headingRef} tabIndex={-1}>{market.title}</h1>
          </div>
        </div>
        {showOriginalTitle && (
          <p className="external-original-title">{en ? 'Original title' : 'Título original'} · {market.officialTitle}</p>
        )}
      </header>

      <div className="external-detail-grid">
        <div className="external-detail-primary">
          <ExternalMarketHistory
            key={market.id}
            history={historyByMarket[market.id]}
            marketId={market.id}
            lang={lang}
          />
          <section className="external-panel" aria-labelledby="external-rules-title">
            <h2 id="external-rules-title">{en ? 'Market rules' : 'Reglas del mercado'}</h2>
            {market.description && <p>{market.description}</p>}
            {rules.length > 0 ? (
              <>
                <p className="external-panel-note">
                  {en ? 'Summary of the published rules.' : 'Resumen de las reglas publicadas.'}
                </p>
                {rules.map((rule, index) => (
                  <div className="external-rule" key={`${rule.title ?? ''}-${index}`}>
                    {rule.title && <h3>{rule.title}</h3>}
                    <p>{rule.text}</p>
                  </div>
                ))}
              </>
            ) : (
              <p>{en ? 'Full rules are unavailable in this snapshot.' : 'Las reglas completas no están disponibles en esta muestra.'}</p>
            )}
            {rulesUrl && (
              <div className="external-panel-links">
                <SourceLink href={rulesUrl}>
                  {market.rulesLabel || (en ? 'Read original rules' : 'Leer las reglas originales')}
                </SourceLink>
              </div>
            )}
          </section>

          <section className="external-panel" aria-labelledby="external-schedule-title">
            <h2 id="external-schedule-title">{en ? 'Schedule and deadlines' : 'Fechas y plazos'}</h2>
            {schedule.length > 0 ? (
              <dl className="external-market-facts">
                {schedule.map((entry, index) => (
                  <div key={`${entry.label}-${index}`}>
                    <dt>{entry.label}</dt><dd><ScheduleValue entry={entry} lang={lang} showTime /></dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>{en ? 'No verifiable deadlines in this source snapshot.' : 'La muestra de la fuente no incluye un plazo verificable.'}</p>
            )}
          </section>
        </div>

        <aside className="external-detail-secondary" aria-label={en ? 'Market information' : 'Información del mercado'}>
          {outcomes.length > 0 && (
            <section className="external-panel" aria-labelledby="external-outcomes-title">
              <h2 id="external-outcomes-title">{en ? 'Outcomes' : 'Resultados posibles'}</h2>
              <p className="external-panel-note">
                {en ? 'Recorded reference prices when available.' : 'Precios de referencia registrados cuando están disponibles.'}
                {priceCapturedAt && <> <time dateTime={market.priceCapturedAt}>{priceCapturedAt}</time></>}
              </p>
              <OutcomeRows outcomes={outcomes} lang={lang} />
            </section>
          )}
          <section className="external-panel" aria-labelledby="external-source-title">
            <h2 id="external-source-title">{en ? 'Market source' : 'Fuente del mercado'}</h2>
            <dl className="external-market-facts">
              <div><dt>{en ? 'Provider' : 'Proveedor'}</dt><dd>{venue}</dd></div>
              {market.network && <div><dt>{en ? 'Network' : 'Red'}</dt><dd>{market.network}</dd></div>}
              {(market.statusLabel || market.status) && (
                <div><dt>{en ? 'Recorded status' : 'Estado registrado'}</dt><dd>{market.statusLabel || market.status}</dd></div>
              )}
              {facts.map((fact, index) => (
                <div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
              ))}
              {capturedAt && (
                <div><dt>{en ? 'Recorded on' : 'Fecha de captura'}</dt><dd><time dateTime={market.capturedAt}>{capturedAt}</time></dd></div>
              )}
              {market.sourceId && (
                <div><dt>{en ? 'Source ID' : 'ID en la fuente'}</dt><dd><code>{market.sourceId}</code></dd></div>
              )}
            </dl>
            {(sourceUrl || venueUrl || resolutionSourceUrl) && (
              <div className="external-panel-links">
                {sourceUrl && (
                  <SourceLink href={sourceUrl}>
                    {market.sourceLabel || (market.sourceIsOfficial === false
                      ? en ? 'View indexed record' : 'Ver registro indexado'
                      : en ? 'View original market' : 'Ver mercado original')}
                  </SourceLink>
                )}
                {venueUrl && venueUrl !== sourceUrl && <SourceLink href={venueUrl}>{venue}</SourceLink>}
                {resolutionSourceUrl && resolutionSourceUrl !== sourceUrl && (
                  <SourceLink href={resolutionSourceUrl}>{en ? 'View resolution source' : 'Ver fuente de resolución'}</SourceLink>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

export default function PointsExternalMarkets() {
  const { id } = useParams();
  const lang = useLang();
  const t = useT();
  const headingRef = useRef(null);
  const markets = getExternalMarkets();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    headingRef.current?.focus({ preventScroll: true });
  }, [id]);

  if (id === undefined) return <PreviewList markets={markets} lang={lang} headingRef={headingRef} />;

  const market = markets.find(row => row.id === id);
  if (market) return <MarketDetail market={market} lang={lang} headingRef={headingRef} />;

  return (
    <main className="external-markets" aria-labelledby="external-market-unavailable">
      <Link className="external-market-back" to={PREVIEW_PATH}>{t('points.detail.backToMarkets')}</Link>
      <header className="external-page-header">
        <h1 id="external-market-unavailable" ref={headingRef} tabIndex={-1}>
          {lang === 'en' ? 'Market unavailable' : 'Mercado no disponible'}
        </h1>
      </header>
    </main>
  );
}
