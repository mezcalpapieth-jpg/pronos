import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import Footer from '../components/Footer.jsx';
import { findTeamByName, findTeamProfile } from '../lib/teamProfiles.js';
import { teamInterestPayload, trackInterest } from '../lib/interest.js';
import { mergeScheduleWithMarkets } from '../lib/teamProfileSchedule.js';
import { isFeaturedTeam, toggleFeaturedTeam } from '../lib/featuredTeams.js';

const CHAIN_ID = Number(import.meta.env.VITE_ONCHAIN_CHAIN_ID || 42161);
const ACTIVE_PENDING_STATES = new Set(['open', 'pending', 'por-resolver', 'disputa']);

function formatDateTime(value) {
  if (!value) return 'Por definir';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Por definir';
  return d.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function marketPath(market) {
  if (!market?.id) return null;
  return `/market?id=${encodeURIComponent(market.id)}`;
}

function stateLabel(state) {
  switch (state) {
    case 'open':
      return { label: 'Abierto', color: 'var(--green)', bg: 'rgba(0,232,122,0.12)' };
    case 'resolved':
      return { label: 'Resuelto', color: 'var(--text-primary)', bg: 'rgba(255,255,255,0.08)' };
    case 'closed':
      return { label: 'Cerrado', color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)' };
    case 'por-resolver':
      return { label: 'Por resolver', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
    case 'cancelado':
      return { label: 'Anulado', color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.06)' };
    case 'disputa':
      return { label: 'Disputa', color: '#ff5757', bg: 'rgba(255,87,87,0.12)' };
    default:
      return { label: 'Pendiente', color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)' };
  }
}

function matchText(row) {
  if (row.homeName && row.awayName) return `${row.awayName} @ ${row.homeName}`;
  return row.market?.question || row.title || 'Partido por definir';
}

function marketMatchesTeam(team, market) {
  const sport = market?.sport || market?.league || team?.sport;
  const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
  return outcomes.some(label => findTeamByName(sport, label)?.slug === team.slug);
}

function marketOnlyState(market) {
  if (market?.status === 'resolved') return 'resolved';
  if (market?.status === 'canceled' || market?.status === 'cancelled') return 'cancelado';
  if (market?.status === 'disputed') return 'disputa';
  const endMs = market?.endTime ? new Date(market.endTime).getTime() : 0;
  if (market?.status === 'active' && endMs > 0 && endMs < Date.now()) return 'por-resolver';
  if (market?.status === 'active') return 'open';
  return market?.status || 'pending';
}

function normalizeMarketOnlyRow(team, market) {
  const [first, second] = Array.isArray(market?.outcomes) ? market.outcomes : [];
  const startsAt = market?.startTime || market?.endTime || market?.createdAt || null;
  return {
    id: `market:${market?.id}`,
    source: market?.source || null,
    sourceEventId: market?.sourceEventId || null,
    startsAt,
    homeName: second && first ? second : team.name,
    awayName: first || null,
    market,
    state: marketOnlyState(market),
  };
}

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`);
  return data;
}

async function loadMarkets(surface) {
  if (surface === 'points') {
    const [active, resolved] = await Promise.all([
      getJson('/api/points/markets?status=active&category=deportes&featured=all&limit=2000'),
      getJson('/api/points/markets?status=resolved&category=deportes&featured=all&limit=2000'),
    ]);
    return [...(active.markets || []), ...(resolved.markets || [])];
  }

  const [active, resolved] = await Promise.all([
    getJson(`/api/protocol/markets?status=active&limit=2000&chainId=${CHAIN_ID}`),
    getJson(`/api/protocol/markets?status=resolved&limit=2000&chainId=${CHAIN_ID}`),
  ]);
  return [...(active.markets || []), ...(resolved.markets || [])];
}

function TeamScheduleRow({ row, onOpen }) {
  const badge = stateLabel(row.state);
  const path = marketPath(row.market);
  const finalScore = row.market?.finalScore || row.finalScore || null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap: 14,
      alignItems: 'center',
      padding: '14px 16px',
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface1)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 6,
          minWidth: 0,
        }}>
          {row.awayLogo && (
            <img src={row.awayLogo} alt="" style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }} />
          )}
          {row.homeLogo && (
            <img src={row.homeLogo} alt="" style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }} />
          )}
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            color: 'var(--text-primary)',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {matchText(row)}
          </span>
        </div>
        <div style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
        }}>
          <span>{formatDateTime(row.startsAt)}</span>
          {row.venue && <span>{row.venue}</span>}
          {finalScore && <span style={{ color: 'var(--green)' }}>Final {finalScore}</span>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => path && onOpen(path)}
        disabled={!path}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 999,
          padding: '8px 12px',
          background: badge.bg,
          color: badge.color,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: path ? 'pointer' : 'default',
          opacity: path ? 1 : 0.82,
          whiteSpace: 'nowrap',
        }}
      >
        {badge.label}
      </button>
    </div>
  );
}

function TeamProfileBody({ surface }) {
  const { sport, teamSlug } = useParams();
  const navigate = useNavigate();
  const team = findTeamProfile(sport, teamSlug);
  const [schedule, setSchedule] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [warning, setWarning] = useState(null);
  const [view, setView] = useState('active-pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [featured, setFeatured] = useState(false);

  useEffect(() => {
    if (!team) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [scheduleData, marketRows] = await Promise.all([
          getJson(`/api/team-schedule?sport=${encodeURIComponent(team.sport)}&team=${encodeURIComponent(team.slug)}`),
          loadMarkets(surface),
        ]);
        if (!cancelled) {
          setSchedule(scheduleData.schedule || []);
          setWarning(scheduleData.warning || null);
          setMarkets((marketRows || []).filter(market => marketMatchesTeam(team, market)));
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'No se pudo cargar el equipo.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [surface, team]);

  useEffect(() => {
    if (!team) return;
    setFeatured(isFeaturedTeam(team));
  }, [team]);

  useEffect(() => {
    if (!team) return;
    trackInterest({
      ...teamInterestPayload(surface, team, 'view'),
      objectType: 'team',
      action: 'view',
    });
  }, [surface, team?.sport, team?.slug]);

  const rows = useMemo(() => {
    if (!team) return [];
    const merged = mergeScheduleWithMarkets(schedule, markets);
    const attached = new Set(merged.map(row => row.market?.id).filter(Boolean));
    const marketOnly = markets
      .filter(market => !attached.has(market.id))
      .map(market => normalizeMarketOnlyRow(team, market));
    return [...merged, ...marketOnly].sort((a, b) => {
      const aMs = a.startsAt ? new Date(a.startsAt).getTime() : 0;
      const bMs = b.startsAt ? new Date(b.startsAt).getTime() : 0;
      return aMs - bMs;
    });
  }, [schedule, markets, team]);

  const visibleRows = useMemo(() => {
    if (view === 'all') return rows;
    return rows.filter(row => ACTIVE_PENDING_STATES.has(row.state));
  }, [rows, view]);

  const activePendingCount = useMemo(
    () => rows.filter(row => ACTIVE_PENDING_STATES.has(row.state)).length,
    [rows],
  );

  if (!team) {
    return (
      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '72px 24px' }}>
        <button className="btn-ghost" type="button" onClick={() => navigate(-1)}>← Volver</button>
        <h1 style={{ fontFamily: 'var(--font-display)', marginTop: 24 }}>Equipo no encontrado</h1>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1120, margin: '0 auto', padding: '42px 24px 72px' }}>
      <button className="btn-ghost" type="button" onClick={() => navigate(-1)} style={{ marginBottom: 24 }}>
        ← Volver
      </button>

      <section style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gap: 20,
        alignItems: 'center',
        marginBottom: 28,
      }}>
        {team.logoUrl ? (
          <img
            src={team.logoUrl}
            alt=""
            style={{ width: 76, height: 76, objectFit: 'contain', filter: 'drop-shadow(0 12px 22px rgba(0,0,0,0.35))' }}
          />
        ) : (
          <div style={{
            width: 76,
            height: 76,
            borderRadius: 8,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--surface1)',
            border: '1px solid var(--border)',
            fontFamily: 'var(--font-display)',
            color: 'var(--text-primary)',
          }}>
            {team.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            color: 'var(--orange)',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            {team.sport === 'soccer' ? 'Soccer' : team.league}
          </div>
          <h1 style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(38px, 7vw, 82px)',
            lineHeight: 0.9,
            color: 'var(--text-primary)',
          }}>
            {team.name}
          </h1>
          <p style={{
            margin: '12px 0 0',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-body)',
            fontSize: 16,
          }}>
            {team.league}{team.country ? ` · ${team.country}` : ''}
          </p>
        </div>
        <button
          type="button"
          aria-label={featured ? 'Quitar equipo destacado' : 'Marcar equipo destacado'}
          onClick={() => setFeatured(toggleFeaturedTeam(team))}
          style={{
            width: 54,
            height: 54,
            borderRadius: 999,
            border: `1px solid ${featured ? 'rgba(250,204,21,0.65)' : 'var(--border)'}`,
            background: featured ? 'rgba(250,204,21,0.12)' : 'var(--surface1)',
            color: featured ? '#facc15' : 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 26,
            lineHeight: 1,
            boxShadow: featured ? '0 0 24px rgba(250,204,21,0.16)' : 'none',
          }}
          title={featured ? 'Destacado' : 'Marcar como destacado'}
        >
          {featured ? '★' : '☆'}
        </button>
      </section>

      {featured && (
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          margin: '-12px 0 24px',
          padding: '8px 12px',
          border: '1px solid rgba(250,204,21,0.32)',
          borderRadius: 999,
          background: 'rgba(250,204,21,0.08)',
          color: '#facc15',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          <span>★</span>
          <span>Destacado</span>
        </div>
      )}

      <section style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 28,
      }}>
        {[
          { key: 'active-pending', label: 'Activos y pendientes', value: activePendingCount },
          { key: 'all', label: 'Todos', value: rows.length },
        ].map(tab => {
          const selected = view === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setView(tab.key)}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                alignItems: 'center',
                gap: 14,
                minWidth: 220,
                padding: '14px 16px',
                border: `1px solid ${selected ? 'rgba(255,85,0,0.55)' : 'var(--border)'}`,
                borderRadius: 8,
                background: selected ? 'rgba(255,85,0,0.1)' : 'var(--surface1)',
                color: selected ? 'var(--orange)' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <span style={{
                minWidth: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {tab.label}
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--text-primary)' }}>
                {tab.value}
              </span>
            </button>
          );
        })}
      </section>

      <section>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          marginBottom: 14,
        }}>
          <h2 style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 30,
            color: 'var(--text-primary)',
          }}>
            Calendario y mercados
          </h2>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
          }}>
            {surface === 'points' ? 'Points' : 'MVP'}
          </span>
        </div>

        {loading && (
          <div style={{ padding: 28, border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Cargando calendario...
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: 28, border: '1px solid rgba(255,87,87,0.35)', borderRadius: 8, color: '#ff5757', fontFamily: 'var(--font-mono)' }}>
            {error}
          </div>
        )}
        {!loading && !error && warning && rows.length === 0 && (
          <div style={{ padding: 28, border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Calendario no disponible por ahora.
          </div>
        )}
        {!loading && !error && rows.length > 0 && visibleRows.length === 0 && (
          <div style={{ padding: 28, border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            No hay mercados activos o pendientes para este equipo.
          </div>
        )}
        {!loading && !error && visibleRows.length > 0 && (
          <div style={{ display: 'grid', gap: 10 }}>
            {visibleRows.map(row => (
              <TeamScheduleRow key={row.id} row={row} onOpen={navigate} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default function TeamProfilePage({ surface = 'mvp', onOpenLogin }) {
  const body = <TeamProfileBody surface={surface} />;
  if (surface === 'points') return body;
  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <div className="category-bar-sticky">
        <CategoryBar />
      </div>
      {body}
      <Footer />
    </>
  );
}
