import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ADMIN_BASEBALL_LEAGUES, ADMIN_COMBATE_LEAGUES, ADMIN_CRYPTO_FILTERS,
  ADMIN_ENTERTAINMENT_TOPIC_FILTERS, ADMIN_GEO_FILTERS, ADMIN_INFRASTRUCTURE_TOPIC_FILTERS, ADMIN_MEXICO_TOPIC_FILTERS,
  ADMIN_SOCCER_LEAGUES, ADMIN_SPORT_FILTERS, MARKET_CATEGORY_FILTERS, adminMarketCategoryLabel, formatAdminMarketDate,
} from '../lib/adminMarketFilters.js';
import { getJson } from '../lib/pointsApi.js';
import './PointsAdminWorkspace.css';

const SECTIONS = [
  ['Operación', [
    ['overview', 'Resumen'],
    ['markets', 'Mercados', 'Revisa mercados activos, pendientes de resolución e históricos.'],
    ['pending', 'Por aprobar', 'Revisa las propuestas antes de publicarlas.'],
    ['resolution', 'Por resolver', 'Revisa resultados propuestos y mercados que ya cerraron.'],
  ]],
  ['Usuarios', [
    ['support', 'Soporte', 'Lee las conversaciones y da seguimiento a tickets abiertos y cerrados.'],
    ['social', 'Tareas sociales'],
    ['risk', 'Riesgo'],
    ['api', 'Uso de API'],
  ]],
  ['Administración', [
    ['cycles', 'Ciclos'],
    ['stats', 'Estadísticas'],
    ['launch', 'Sistema'],
    ['strategies', 'Estrategias'],
    ['deck', 'Deck'],
  ]],
];

export function adminTab(params) {
  const tab = params.get('tab');
  if (tab === 'markets' && params.get('status') === 'pending') return 'resolution';
  if (tab === 'create' || (!tab && params.has('question'))) return 'create';
  return tab !== 'resolution' && SECTIONS.some(([, items]) => items.some(([id]) => id === tab))
    ? tab
    : 'overview';
}

const TAB_TITLES = Object.fromEntries(SECTIONS.flatMap(([, items]) => items.map(([id, title]) => [id, title])));
const SECTION_TONES = ['brand', 'info', 'violet'];
const TAB_DESCRIPTIONS = Object.fromEntries(SECTIONS.flatMap(([, items]) => items.map(([id, , description]) => [id, description])));

function adminHref(tab) {
  if (tab === 'overview') return '/admin';
  if (tab === 'resolution') return '/admin?tab=markets&status=pending';
  return `/admin?tab=${tab}`;
}

export function AdminWorkspace({ tab, username, children }) {
  const main = useRef(null);
  const [moreSections, setMoreSections] = useState(() =>
    SECTIONS.slice(1).some(([, items]) => items.some(([id]) => id === tab)));
  const title = tab === 'overview' ? 'Panel de administración' : TAB_TITLES[tab] || 'Nuevo mercado';
  const showPreview = import.meta.env.VITE_VERCEL_ENV === 'preview'
    && !['pronos.io', 'www.pronos.io'].includes(window.location.hostname);

  function holdViewport() {
    const content = main.current;
    if (window.scrollY && content) {
      // A loading or empty queue still needs enough height to hold the current viewport.
      content.style.minHeight = `${Math.max(0, Math.ceil(window.innerHeight - content.getBoundingClientRect().top))}px`;
    }
  }

  useEffect(() => {
    const content = main.current;
    function releaseViewport() {
      if (!content.style.minHeight) return;
      const minimum = Math.ceil(window.innerHeight - content.getBoundingClientRect().top);
      if (!window.scrollY || minimum <= 0) content.style.minHeight = '';
      else if (minimum < parseFloat(content.style.minHeight)) content.style.minHeight = `${minimum}px`;
    }
    window.addEventListener('scroll', releaseViewport, { passive: true });
    return () => window.removeEventListener('scroll', releaseViewport);
  }, []);

  return (
    <div className="pb-admin">
      <div className="pb-admin-shell">
        <header className="pb-admin-context">
          <nav className="pb-admin-breadcrumbs" aria-label="Ruta de navegación">
            <Link to="/">Inicio de Pronos</Link>
            <span aria-hidden="true">/</span>
            {tab === 'overview'
              ? <span aria-current="page">Administración</span>
              : <><Link to="/admin">Administración</Link><span aria-hidden="true">/</span><span aria-current="page">{title}</span></>}
          </nav>
          {username && <span className="pb-admin-user">@{username}</span>}
        </header>
        <nav className="pb-admin-sidebar" aria-label="Secciones de administración">
          <AdminNavGroup section={SECTIONS[0]} tone={SECTION_TONES[0]} tab={tab} />
          <button type="button" className="pb-admin-more" aria-controls="pb-admin-secondary-sections" aria-expanded={moreSections}
            onClick={() => setMoreSections(value => !value)}>
            Usuarios y administración <span aria-hidden="true">{moreSections ? '−' : '+'}</span>
          </button>
          <div id="pb-admin-secondary-sections" className="pb-admin-secondary" data-expanded={moreSections}>
            {SECTIONS.slice(1).map((section, index) => (
              <AdminNavGroup key={section[0]} section={section} tone={SECTION_TONES[index + 1]} tab={tab} />
            ))}
          </div>
        </nav>
        <main className="pb-admin-main" ref={main}
          onClickCapture={holdViewport} onSubmitCapture={holdViewport}
          onChangeCapture={event => { if (event.target.tagName === 'SELECT') holdViewport(); }}>
          <div className="pb-admin-heading">
            <div>
              <h1>{title}</h1>
              <p>{tab === 'overview' ? 'Revisa lo que requiere atención y abre el catálogo de mercados.' : TAB_DESCRIPTIONS[tab]}</p>
            </div>
            {tab !== 'create' && <Link className="pb-admin-button pb-admin-primary" to="/admin?tab=create">+ Nuevo mercado</Link>}
          </div>
          {showPreview && (
            <p className="pb-admin-preview"><QueueBadge status={['Vista previa', 'info']} /> El catálogo y los tickets pueden diferir de producción.</p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

function AdminNavGroup({ section: [group, items], tone, tab }) {
  return (
    <div className="pb-admin-nav-group" data-tone={tone}>
      <span>{group}</span>
      <div className="pb-admin-nav-links">
        {items.map(([id, label]) => (
          <Link key={id} to={adminHref(id)} aria-current={id === tab ? 'page' : undefined}>{label}</Link>
        ))}
      </div>
    </div>
  );
}

function marketQueueLink(row, pending = false) {
  const params = new URLSearchParams({
    tab: pending ? 'pending' : 'markets', status: 'pending', q: `#${row.id}`, item: row.id,
  });
  return `/admin?${params}`;
}

export function adminMarketStatus(row, proposal = false) {
  if (proposal) {
    if (row.status === 'approved') return ['Aprobado', 'success'];
    if (row.status === 'rejected') return ['Rechazado', 'neutral'];
    return ['Por aprobar', 'warning'];
  }
  if (row.archivedAt) return ['Archivado', 'neutral'];
  if (row.status === 'resolved') return ['Resuelto', 'success'];
  if (row.status === 'canceled') return ['Anulado', 'neutral'];
  if (row.onchainResolution) return [row.onchainResolution.issue ? 'Revisión onchain' : 'Cerrado en Sepolia', 'warning'];
  if (row.resolutionCandidate) return ['Propuesta para revisar', 'success'];
  if (row.endTime && new Date(row.endTime).getTime() <= Date.now()) return ['Cerrado · sin propuesta', 'warning'];
  if (row.startTime && new Date(row.startTime).getTime() > Date.now()) return ['Programado', 'neutral'];
  return ['Activo', 'success'];
}

export function QueueBadge({ status }) {
  return <span className="pb-admin-badge" data-tone={status[1]}>{status[0]}</span>;
}

export function AdminOverview({ counts, loading, onRefresh }) {
  const cards = [
    ['pending', 'Por aprobar', 'Propuestas de mercado', '/admin?tab=pending', 'brand'],
    ['markets', 'Por resolver', null, '/admin?tab=markets&status=pending', 'warning'],
    ['support', 'Soporte', 'Tickets abiertos · Ver todos', '/admin?tab=support', 'info'],
    ['social', 'Tareas sociales', 'Enviadas para revisión', '/admin?tab=social', 'violet'],
  ];
  const resolutions = counts?.marketPreview || [];
  const proposals = counts?.pendingPreview || [];

  return (
    <>
      <div className="pb-admin-metrics" aria-label="Resumen de pendientes" aria-busy={loading}>
        {cards.map(([id, label, caption, href, tone]) => (
          <Link className="pb-admin-metric" data-tone={tone} to={href} key={id}>
            <span>{label} <span className="pb-admin-chevron" aria-hidden="true">↗</span></span>
            <strong>{counts?.[id] == null ? '—' : `${counts[id]}${counts.capped?.[id] ? '+' : ''}`}</strong>
            {id === 'markets' && counts?.resolutionReady != null && counts?.closedWithoutCandidate != null
              ? <small>{counts.resolutionReady} para revisar · {counts.closedWithoutCandidate} {counts.closedWithoutCandidate === 1 ? 'cerrado' : 'cerrados'} sin propuesta</small>
              : <small>{loading && !counts ? 'Cargando…' : counts?.[id] == null ? 'Conteo no disponible' : caption || 'Mercados que requieren revisión'}</small>}
          </Link>
        ))}
      </div>
      <section className="pb-admin-panel pb-admin-catalog" aria-labelledby="pb-admin-catalog-heading">
        <div className="pb-admin-panel-heading">
          <div>
            <h2 id="pb-admin-catalog-heading">Catálogo de mercados</h2>
            <p>Abre los mercados activos por categoría o consulta el historial.</p>
          </div>
          <Link className="pb-admin-button" to="/admin?tab=markets" preventScrollReset>Ver todos los mercados <span aria-hidden="true">→</span></Link>
        </div>
        <div className="pb-admin-chips">
          {MARKET_CATEGORY_FILTERS.map(({ key, label }) => (
            <Link className="pb-admin-chip" data-category={key} key={key}
              to={`/admin?tab=markets&status=active${key === 'all' ? '' : `&category=${key}`}`}>
              {key === 'all' ? 'Todos los activos' : label}
            </Link>
          ))}
        </div>
      </section>
      <section className="pb-admin-panel" aria-labelledby="pb-admin-work-heading">
        <div className="pb-admin-panel-heading">
          <div>
            <h2 id="pb-admin-work-heading">Cola de trabajo</h2>
            {counts?.checkedAt && <p>Actualizado a las {formatAdminMarketDate(counts.checkedAt, { timeZone: 'America/Mexico_City', timeOnly: true })} CDMX</p>}
          </div>
          <button className="pb-admin-button" type="button" onClick={onRefresh} disabled={loading}>Actualizar</button>
        </div>
        {counts?.partial && <p className="pb-admin-message" role="status">Algunas colas no pudieron actualizarse. Puedes abrirlas por separado o volver a intentar.</p>}
        {[...resolutions.map(row => [row, false]), ...proposals.map(row => [row, true])].map(([row, proposal]) => (
          <Link className="pb-admin-row" key={`${proposal}-${row.id}`} to={marketQueueLink(row, proposal)}>
            <span>
              <strong>{row.question}</strong>
              <small>{proposal ? 'Propuesta' : 'Mercado'} #{row.id}{row.league ? ` · ${row.league}` : ''}</small>
            </span>
            <QueueBadge status={adminMarketStatus(row, proposal)} />
          </Link>
        ))}
        {!resolutions.length && !proposals.length && (
          <p className="pb-admin-message">
            {loading ? 'Cargando mercados…' : counts?.partial ? 'No hay mercados disponibles para mostrar.' : 'No hay mercados pendientes de aprobación o resolución.'}
          </p>
        )}
      </section>
    </>
  );
}

const MARKET_STATUSES = [
  ['all', 'Todos'], ['active', 'Activos'], ['pending', 'Por resolver'], ['resolved', 'Resueltos'], ['canceled', 'Anulados'],
];
const PROPOSAL_STATUSES = [
  ['pending', 'Pendientes'], ['approved', 'Aprobados'], ['rejected', 'Rechazados'], ['all', 'Todos'],
];
const FILTER_KEYS = ['category', 'sport', 'league', 'geo', 'topic', 'crypto_type', 'feature'];
const STATUS_TONES = {
  active: 'success', approved: 'success', pending: 'warning', rejected: 'danger', resolved: 'success',
};

export function useAdminQueueFilters(proposal = false) {
  const [params, setParams] = useSearchParams();
  const statuses = proposal ? PROPOSAL_STATUSES : MARKET_STATUSES;
  const requestedStatus = params.get('status');
  const status = statuses.some(([key]) => key === requestedStatus) ? requestedStatus : statuses[0][0];
  const values = Object.fromEntries(FILTER_KEYS.map(key => [key, params.get(key) || 'all']));
  const search = (params.get('q') || '').trim().slice(0, 120);
  const hasFilters = Boolean(search) || FILTER_KEYS.some(key => values[key] !== 'all');

  function update(key, value) {
    const current = key === 'status' ? status : key === 'q' ? search : values[key];
    if (value === current) return;
    const next = new URLSearchParams(params);
    if (value && (key === 'status' || key === 'q' || value !== 'all')) next.set(key, value);
    else next.delete(key);
    next.delete('item');
    if (key === 'category') for (const filter of FILTER_KEYS.slice(1, -1)) next.delete(filter);
    if (key === 'sport') next.delete('league');
    setParams(next, { preventScrollReset: true });
  }
  function reset() {
    const next = new URLSearchParams(params);
    for (const key of [...FILTER_KEYS, 'q', 'item']) next.delete(key);
    setParams(next, { preventScrollReset: true });
  }

  return { statuses, status, values, search, update, reset, hasFilters };
}

export function useAdminQueueData(url, field, { keepPrevious = false, reloadKey = 0 } = {}) {
  const [state, setState] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const revision = `${reloadKey}:${refresh}`;

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    getJson(url, { signal: controller.signal }).then(
      data => {
        if (controller.signal.aborted) return;
        const rows = data?.[field];
        setState({ url, revision, data, rows: Array.isArray(rows) ? rows : null, error: !Array.isArray(rows) });
      },
      () => {
        if (!controller.signal.aborted) setState({ url, revision, rows: null, error: true });
      },
    );
    return () => controller.abort();
  }, [url, field, revision]);

  const current = state?.url === url && (keepPrevious || state?.revision === revision) ? state : null;
  return {
    rows: current?.rows,
    data: current?.data,
    loading: Boolean(url) && current?.revision !== revision,
    error: current?.error,
    reload: () => setRefresh(value => value + 1),
    setRows: update => setState(prev => prev?.url === url && prev.rows
      ? { ...prev, rows: update(prev.rows) }
      : prev),
  };
}

export function AdminFilterGroup({ label, options, value, onChange, categories = false }) {
  return (
    <div className="pb-admin-filter-group" role="group" aria-label={label}>
      <span className="pb-admin-filter-label">{label}</span>
      <div className="pb-admin-chips">
        {options.map(({ key, label: option }) => (
          <button className="pb-admin-chip" type="button" key={key} aria-pressed={value === key}
            data-category={categories ? key : undefined} onClick={() => onChange(key)}>{option}</button>
        ))}
      </div>
    </div>
  );
}

export function AdminQueueToolbar({ queue, proposal = false, searchAction, children }) {
  const { statuses, status, values, search, update, reset, hasFilters } = queue;
  const [draft, setDraft] = useState(search);
  useEffect(() => { setDraft(search); }, [search]);
  const group = (label, key, options) => <AdminFilterGroup label={label} options={options}
    value={values[key]} onChange={value => update(key, value)} categories={key === 'category'} />;
  const leagues = { soccer: ADMIN_SOCCER_LEAGUES, baseball: ADMIN_BASEBALL_LEAGUES, combate: ADMIN_COMBATE_LEAGUES };

  return (
    <div className="pb-admin-panel pb-admin-toolbar">
      <div className="pb-admin-statuses" role="group" aria-label="Estado">
        {statuses.map(([key, label]) => (
          <button type="button" key={key} data-tone={STATUS_TONES[key]} aria-pressed={status === key}
            onClick={() => update('status', key)}>{label}</button>
        ))}
      </div>
      <div className="pb-admin-filter-row">
        <form className="pb-admin-search" onSubmit={event => { event.preventDefault(); update('q', draft.trim()); }}>
          <label className="pb-admin-field">
            <span>Buscar mercados</span>
            <input type="search" placeholder="Título, #ID o ID del evento" value={draft}
              onChange={event => setDraft(event.target.value)} maxLength={120} />
          </label>
          <button type="submit" className="pb-admin-button">Buscar</button>
        </form>
        {searchAction}
        {(hasFilters || draft) && <button type="button" className="pb-admin-button" onClick={() => { setDraft(''); reset(); }}>Limpiar filtros</button>}
      </div>
      <div className="pb-admin-filters">
        {group('Categoría', 'category', MARKET_CATEGORY_FILTERS)}
        {values.category === 'deportes' && group('Deporte', 'sport', ADMIN_SPORT_FILTERS)}
        {values.category === 'deportes' && leagues[values.sport] && group('Liga', 'league', leagues[values.sport])}
        {values.category === 'mexico' && group('Región', 'geo', ADMIN_GEO_FILTERS)}
        {values.category === 'mexico' && group('Tema', 'topic', ADMIN_MEXICO_TOPIC_FILTERS)}
        {values.category === 'musica' && group('Subcategoría', 'topic', ADMIN_ENTERTAINMENT_TOPIC_FILTERS)}
        {values.category === 'infraestructura' && group('Subcategoría', 'topic', ADMIN_INFRASTRUCTURE_TOPIC_FILTERS)}
        {values.category === 'crypto' && group('Tipo', 'crypto_type', ADMIN_CRYPTO_FILTERS)}
        {proposal && group('Visibilidad', 'feature', [
          { key: 'all', label: 'Todas' }, { key: 'featured', label: 'Trending' }, { key: 'tournament', label: 'Torneo' },
        ])}
      </div>
      {children}
    </div>
  );
}

export function focusAdminQueuePanel(element) {
  element?.focus({ preventScroll: !window.matchMedia('(max-width: 820px)').matches });
}

export function AdminMarketQueue({ rows, queue, proposal = false, loading, error, onRetry, renderRowActions, renderRowDetails, children }) {
  const [params, setParams] = useSearchParams();
  const detail = useRef(null);
  const activeRow = useRef(null);
  const selectedId = params.get('item');
  const selected = rows?.find(row => String(row.id) === selectedId);
  const displayed = selected || rows?.[0];
  const shouldFocusDetail = useRef(false);
  const returnToRow = useRef(null);

  function select(id) {
    const next = new URLSearchParams(params);
    if (id == null) {
      returnToRow.current = selectedId;
      next.delete('item');
    } else {
      if (String(id) === selectedId) {
        focusAdminQueuePanel(detail.current);
        return;
      }
      shouldFocusDetail.current = true;
      next.set('item', id);
    }
    setParams(next, { preventScrollReset: true });
  }

  useEffect(() => {
    if (shouldFocusDetail.current && selected) {
      shouldFocusDetail.current = false;
      focusAdminQueuePanel(detail.current);
    } else if (returnToRow.current && !selectedId) {
      returnToRow.current = null;
      focusAdminQueuePanel(activeRow.current);
    }
  }, [selected, selectedId]);

  if (loading) return <p className="pb-admin-message" role="status">Cargando mercados…</p>;
  if (error) return <div className="pb-admin-message pb-admin-error" role="alert">
    No se pudieron cargar los mercados.
    <button className="pb-admin-button" onClick={onRetry} type="button">Reintentar</button>
  </div>;
  if (!displayed) return (
    <div className="pb-admin-panel pb-admin-empty" role="status">
      <strong>{queue.hasFilters ? 'Sin coincidencias' : proposal ? 'Sin propuestas en esta vista' : 'Sin mercados en esta vista'}</strong>
      {queue.hasFilters
        ? <button className="pb-admin-button" onClick={queue.reset} type="button">Quitar filtros</button>
        : !proposal && queue.status !== 'all' && <Link className="pb-admin-button" to="/admin?tab=markets" preventScrollReset>Ver todos los mercados</Link>}
    </div>
  );
  return (
    <div className="pb-admin-queue" data-selected={Boolean(selected)}>
      <section className="pb-admin-panel pb-admin-list" data-proposal={proposal || undefined} aria-label="Resultados">
        <div className="pb-admin-panel-heading"><h2>{proposal ? 'Propuestas' : 'Mercados'}</h2><small>{rows.length} en esta vista</small></div>
        <div className="pb-admin-list-rows">
          {rows.map(row => {
            const actions = renderRowActions?.(row);
            const details = renderRowDetails?.(row);
            const pressed = row.id === displayed.id;
            return (
              <div key={row.id} className="pb-admin-queue-row" data-selected={pressed} data-has-details={details ? true : undefined}>
                <button className="pb-admin-row" type="button" onClick={() => select(row.id)}
                  ref={String(row.id) === returnToRow.current ? activeRow : null} aria-pressed={pressed}
                  aria-controls="pb-admin-queue-detail">
                  <span>
                    <strong>{row.question}</strong>
                    <small>#{row.id}{row.league || row.category ? ` · ${row.league || adminMarketCategoryLabel(row.category) || row.category}` : ''}</small>
                  </span>
                  {!actions && <QueueBadge status={adminMarketStatus(row, proposal)} />}
                </button>
                {actions}
                {details}
              </div>
            );
          })}
        </div>
      </section>
      <section className="pb-admin-detail" ref={detail} tabIndex={-1} id="pb-admin-queue-detail" aria-label="Detalle del mercado">
        <button className="pb-admin-button pb-admin-list-back" onClick={() => select(null)} type="button">← Volver a la lista</button>
        {children(displayed)}
      </section>
    </div>
  );
}

export function AdminMarketFacts({ market, proposal = false }) {
  const cfg = market.resolverConfig;
  const candidate = market.resolutionCandidate;
  const evidence = candidate?.evidenceUrl;
  const criteria = cfg?.criteria || market.resolutionCriteria || market.sourceData?.resolutionCriteria;
  const source = cfg?.source || market.source;
  const sourceUrl = cfg?.resolutionSource || cfg?.sourceUrl || market.sourceData?.sourceUrl;
  const category = adminMarketCategoryLabel(market.category);
  const eventId = cfg?.eventId || cfg?.gamePk || market.sourceEventId;
  return (
    <div className="pb-admin-market-facts">
      <div className="pb-admin-fact-heading">
        <QueueBadge status={adminMarketStatus(market, proposal)} />
        <span>#{market.id}{category ? ` · ${category}` : ''}{market.league ? ` · ${market.league}` : ''}</span>
      </div>
      <dl>
        <div><dt>Cierre</dt><dd>{market.endTime ? `${formatAdminMarketDate(market.endTime, { timeZone: 'America/Mexico_City' })} CDMX` : 'Sin fecha'}</dd></div>
        <div><dt>Fuente</dt><dd>{typeof sourceUrl === 'string' && /^https?:\/\//i.test(sourceUrl)
          ? <a href={sourceUrl} target="_blank" rel="noreferrer">{source || 'Abrir fuente'} ↗</a>
          : source || 'Sin fuente configurada'}</dd></div>
        {eventId && <div><dt>ID del evento</dt><dd>{eventId}</dd></div>}
        {market.finalScore && <div><dt>Resultado</dt><dd>{market.finalScore}</dd></div>}
        {candidate?.observedAt && <div><dt>Evidencia observada</dt><dd>{formatAdminMarketDate(candidate.observedAt, { timeZone: 'America/Mexico_City' })} CDMX</dd></div>}
        {typeof evidence === 'string' && /^https?:\/\//i.test(evidence) && (
          <div><dt>Evidencia</dt><dd><a href={evidence} target="_blank" rel="noreferrer">Abrir fuente ↗</a></dd></div>
        )}
      </dl>
      {typeof criteria === 'string' && criteria && <p><strong>Criterios de resolución</strong><br />{criteria}</p>}
      {market.resolutionReadiness && <p><strong>{market.resolutionReadiness.label}</strong><br />{market.resolutionReadiness.requirement}</p>}
      {!proposal && <Link to={`/market?id=${encodeURIComponent(market.id)}`}>Ver ficha del mercado ↗</Link>}
    </div>
  );
}
