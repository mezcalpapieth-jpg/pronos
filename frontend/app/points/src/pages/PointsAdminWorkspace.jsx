import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ADMIN_BASEBALL_LEAGUES, ADMIN_COMBATE_LEAGUES, ADMIN_CRYPTO_FILTERS,
  ADMIN_ENTERTAINMENT_TOPIC_FILTERS, ADMIN_GEO_FILTERS, ADMIN_MEXICO_TOPIC_FILTERS,
  ADMIN_SOCCER_LEAGUES, ADMIN_SPORT_FILTERS, MARKET_CATEGORY_FILTERS, formatAdminMarketDate,
} from '../lib/adminMarketFilters.js';
import { getJson } from '../lib/pointsApi.js';
import './PointsAdminWorkspace.css';

const SECTIONS = [
  ['Operación', [
    ['overview', 'Resumen'],
    ['markets', 'Mercados', 'Revisa mercados activos, pendientes de resolución e históricos.'],
    ['pending', 'Por aprobar', 'Revisa las propuestas antes de publicarlas.'],
    ['resolution', 'Por resolver', 'Revisa resultados propuestos y mercados que ya cerraron.'],
    ['support', 'Soporte'],
  ]],
  ['Usuarios', [
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
const TAB_DESCRIPTIONS = Object.fromEntries(SECTIONS.flatMap(([, items]) => items.map(([id, , description]) => [id, description])));

function adminHref(tab) {
  if (tab === 'overview') return '/admin';
  if (tab === 'resolution') return '/admin?tab=markets&status=pending';
  return `/admin?tab=${tab}`;
}

export function AdminWorkspace({ tab, username, children }) {
  const navigate = useNavigate();
  return (
    <div className="pb-admin">
      <header className="pb-admin-top">
        <Link to="/admin" className="pb-admin-brand">
          <span aria-hidden="true">P</span> Pronos <small>Admin</small>
        </Link>
        <div className="pb-admin-top-actions">
          {username && <span className="pb-admin-user">@{username}</span>}
          <Link to="/" className="pb-admin-public-link">Ver sitio <span aria-hidden="true">↗</span></Link>
        </div>
      </header>
      <div className="pb-admin-shell">
        <nav className="pb-admin-sidebar" aria-label="Administración">
          {SECTIONS.map(([group, items]) => (
            <div className="pb-admin-nav-group" key={group}>
              <span>{group}</span>
              {items.map(([id, label]) => (
                <Link key={id} to={adminHref(id)}
                  aria-current={id === tab ? 'page' : undefined}>
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <nav className="pb-admin-mobile-nav" aria-label="Administración">
          <label className="pb-admin-field">
            <span>Ir a sección</span>
            <select value={tab} onChange={event => navigate(adminHref(event.target.value))}>
              {tab === 'create' && <option value="create">Nuevo mercado</option>}
              {SECTIONS.map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        </nav>
        <main className="pb-admin-main">
          <div className="pb-admin-heading">
            <div>
              <h1>{TAB_TITLES[tab] || 'Nuevo mercado'}</h1>
              <p>{tab === 'overview' ? 'Mercados y solicitudes que requieren atención.' : TAB_DESCRIPTIONS[tab]}</p>
            </div>
            {tab !== 'create' && <Link className="pb-admin-button pb-admin-primary" to="/admin?tab=create">+ Nuevo mercado</Link>}
          </div>
          {children}
        </main>
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
  if (row.resolutionCandidate) return ['Propuesta para revisar', 'success'];
  if (row.endTime && new Date(row.endTime).getTime() <= Date.now()) return ['Cerrado · sin propuesta', 'warning'];
  if (row.startTime && new Date(row.startTime).getTime() > Date.now()) return ['Programado', 'neutral'];
  return ['Activo', 'success'];
}

function QueueBadge({ status }) {
  return <span className="pb-admin-badge" data-tone={status[1]}>{status[0]}</span>;
}

export function AdminOverview({ counts, loading, onRefresh }) {
  const cards = [
    ['pending', 'Por aprobar', 'Propuestas de mercado', '/admin?tab=pending'],
    ['markets', 'Por resolver', null, '/admin?tab=markets&status=pending'],
    ['support', 'Soporte', 'Solicitudes abiertas', '/admin?tab=support'],
    ['social', 'Tareas sociales', 'Enviadas para revisión', '/admin?tab=social'],
  ];
  const resolutions = counts?.marketPreview || [];
  const proposals = counts?.pendingPreview || [];

  return (
    <>
      <div className="pb-admin-metrics" aria-label="Resumen de pendientes" aria-busy={loading}>
        {cards.map(([id, label, caption, href]) => (
          <Link className="pb-admin-metric" to={href} key={id}>
            <span>{label} <span className="pb-admin-chevron" aria-hidden="true">↗</span></span>
            <strong>{counts?.[id] == null ? '—' : `${counts[id]}${counts.capped?.[id] ? '+' : ''}`}</strong>
            {id === 'markets' && counts?.resolutionReady != null && counts?.closedWithoutCandidate != null
              ? <small>{counts.resolutionReady} para revisar · {counts.closedWithoutCandidate} {counts.closedWithoutCandidate === 1 ? 'cerrado' : 'cerrados'} sin propuesta</small>
              : <small>{loading && !counts ? 'Cargando…' : counts?.[id] == null ? 'Conteo no disponible' : caption || 'Mercados que requieren revisión'}</small>}
          </Link>
        ))}
      </div>
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

export function useAdminQueueFilters(proposal = false) {
  const [params, setParams] = useSearchParams();
  const statuses = proposal ? PROPOSAL_STATUSES : MARKET_STATUSES;
  const requestedStatus = params.get('status');
  const status = statuses.some(([key]) => key === requestedStatus) ? requestedStatus : statuses[0][0];
  const values = Object.fromEntries(FILTER_KEYS.map(key => [key, params.get(key) || 'all']));
  const search = (params.get('q') || '').trim().slice(0, 120);
  function update(key, value) {
    const next = new URLSearchParams(params);
    if (value && (key === 'status' || key === 'q' || value !== 'all')) next.set(key, value);
    else next.delete(key);
    next.delete('item');
    if (key === 'category') for (const filter of FILTER_KEYS.slice(1, -1)) next.delete(filter);
    if (key === 'sport') next.delete('league');
    setParams(next);
  }
  return { statuses, status, values, search, update };
}

export function useAdminQueueData(url, field) {
  const [state, setState] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    getJson(url, { signal: controller.signal }).then(
      data => {
        if (controller.signal.aborted) return;
        const rows = data?.[field];
        setState({ url, refresh, rows: Array.isArray(rows) ? rows : null, error: !Array.isArray(rows) });
      },
      () => {
        if (!controller.signal.aborted) setState({ url, refresh, rows: null, error: true });
      },
    );
    return () => controller.abort();
  }, [url, field, refresh]);

  const current = state?.url === url && state?.refresh === refresh ? state : null;
  return {
    rows: current?.rows,
    loading: !current && Boolean(url),
    error: current?.error,
    reload: () => setRefresh(value => value + 1),
    setRows: update => setState(prev => prev?.url === url && prev.rows
      ? { ...prev, rows: update(prev.rows) }
      : prev),
  };
}

function FilterSelect({ label, options, value, onChange }) {
  return (
    <label className="pb-admin-field">
      <span>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {options.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
  );
}

export function AdminQueueToolbar({ queue, proposal = false, children }) {
  const { statuses, status, values, search, update } = queue;
  const [draft, setDraft] = useState(search);
  useEffect(() => { setDraft(search); }, [search]);
  const select = (label, key, options) => <FilterSelect label={label} options={options}
    value={values[key]} onChange={value => update(key, value)} />;
  const leagues = { soccer: ADMIN_SOCCER_LEAGUES, baseball: ADMIN_BASEBALL_LEAGUES, combate: ADMIN_COMBATE_LEAGUES };

  return (
    <div className="pb-admin-panel pb-admin-toolbar">
      <div className="pb-admin-statuses" role="group" aria-label="Estado">
        {statuses.map(([key, label]) => (
          <button type="button" key={key} aria-pressed={status === key} onClick={() => update('status', key)}>{label}</button>
        ))}
      </div>
      <div className="pb-admin-filter-row">
        <form className="pb-admin-search" onSubmit={e => { e.preventDefault(); update('q', draft.trim()); }}>
          <label className="pb-admin-field">
            <span>Buscar</span>
            <input type="search" placeholder="Título, #ID o ID del evento" value={draft}
              onChange={e => setDraft(e.target.value)} maxLength={120} />
          </label>
          <button type="submit" className="pb-admin-button">Buscar</button>
          {search && <button type="button" className="pb-admin-button" onClick={() => update('q', '')}>Limpiar</button>}
        </form>
        {select('Categoría', 'category', MARKET_CATEGORY_FILTERS)}
        {values.category === 'deportes' && select('Deporte', 'sport', ADMIN_SPORT_FILTERS)}
        {values.category === 'deportes' && leagues[values.sport] && select('Liga', 'league', leagues[values.sport])}
        {values.category === 'mexico' && select('Región', 'geo', ADMIN_GEO_FILTERS)}
        {values.category === 'mexico' && select('Tema', 'topic', ADMIN_MEXICO_TOPIC_FILTERS)}
        {values.category === 'musica' && select('Tema', 'topic', ADMIN_ENTERTAINMENT_TOPIC_FILTERS)}
        {values.category === 'crypto' && select('Tipo', 'crypto_type', ADMIN_CRYPTO_FILTERS)}
        {proposal && select('Visibilidad', 'feature', [
          { key: 'all', label: 'Todas' }, { key: 'featured', label: 'Trending' }, { key: 'tournament', label: 'Torneo' },
        ])}
      </div>
      {children}
    </div>
  );
}

export function AdminMarketQueue({ rows, proposal = false, loading, error, onRetry, children }) {
  const [params, setParams] = useSearchParams();
  const detail = useRef(null);
  const activeRow = useRef(null);
  const selectedId = params.get('item');
  const selected = rows?.find(row => String(row.id) === selectedId);
  const displayed = selected || rows?.[0];
  const shouldFocusDetail = useRef(false);
  const shouldFocusList = useRef(false);

  function select(id) {
    const next = new URLSearchParams(params);
    if (id == null) {
      shouldFocusList.current = true;
      next.delete('item');
    } else {
      if (String(id) === selectedId) {
        detail.current?.focus();
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
      detail.current?.focus();
    } else if (shouldFocusList.current && !selectedId) {
      shouldFocusList.current = false;
      activeRow.current?.focus();
    }
  }, [selected, selectedId]);

  if (loading) return <p className="pb-admin-message" role="status">Cargando mercados…</p>;
  if (error) return <div className="pb-admin-message pb-admin-error" role="alert">
    No se pudieron cargar los mercados.
    <button className="pb-admin-button" onClick={onRetry} type="button">Reintentar</button>
  </div>;
  if (!displayed) return <p className="pb-admin-message">No hay mercados que coincidan con estos filtros.</p>;
  return (
    <div className="pb-admin-queue" data-selected={Boolean(selected)}>
      <section className="pb-admin-panel pb-admin-list" aria-label="Resultados">
        <div className="pb-admin-panel-heading"><h2>{proposal ? 'Propuestas' : 'Mercados'}</h2><small>{rows.length} en esta vista</small></div>
        <div className="pb-admin-list-rows">
          {rows.map(row => (
            <button className="pb-admin-row" type="button" key={row.id} onClick={() => select(row.id)}
              ref={row.id === displayed.id ? activeRow : null} aria-pressed={row.id === displayed.id}
              aria-controls="pb-admin-queue-detail">
              <span>
                <strong>{row.question}</strong>
                <small>#{row.id}{row.league || row.category ? ` · ${row.league || row.category}` : ''}</small>
              </span>
              <QueueBadge status={adminMarketStatus(row, proposal)} />
            </button>
          ))}
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
  const category = MARKET_CATEGORY_FILTERS.find(item => item.key === market.category)?.label;
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
