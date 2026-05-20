import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import Footer from '../components/Footer.jsx';
import { TEAM_PROFILES, teamProfilePath } from '../lib/teamProfiles.js';

const SPORT_FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'soccer', label: 'Fútbol' },
  { key: 'basketball', label: 'Basketball' },
  { key: 'baseball', label: 'Béisbol' },
  { key: 'nfl', label: 'NFL' },
];

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function TeamSearchBody() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sport, setSport] = useState('all');

  const teams = useMemo(() => {
    const q = normalize(query.trim());
    return TEAM_PROFILES
      .filter(team => sport === 'all' || team.sport === sport)
      .filter(team => {
        if (!q) return true;
        const text = normalize([
          team.name,
          team.league,
          team.country,
          ...(team.aliases || []),
        ].join(' '));
        return text.includes(q);
      })
      .sort((a, b) => {
        if (a.sport !== b.sport) return a.sport.localeCompare(b.sport);
        if ((a.league || '') !== (b.league || '')) return String(a.league || '').localeCompare(String(b.league || ''));
        return a.name.localeCompare(b.name);
      });
  }, [query, sport]);

  return (
    <main style={{
      maxWidth: 1160,
      margin: '0 auto',
      padding: '42px 24px 72px',
    }}>
      <button className="btn-ghost" type="button" onClick={() => navigate(-1)} style={{ marginBottom: 24 }}>
        ← Volver
      </button>

      <section style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        gap: 18,
        marginBottom: 28,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            color: 'var(--orange)',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            Equipos
          </div>
          <h1 style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(38px, 7vw, 78px)',
            lineHeight: 0.9,
            color: 'var(--text-primary)',
          }}>
            Buscar equipo
          </h1>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 12,
          padding: 14,
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface1)',
        }}>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Arsenal, Lakers, Dodgers..."
            aria-label="Buscar equipos"
            style={{
              width: '100%',
              minHeight: 44,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text-primary)',
              padding: '0 14px',
              fontFamily: 'var(--font-body)',
              fontSize: 15,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {SPORT_FILTERS.map(filter => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setSport(filter.key)}
                style={{
                  border: `1px solid ${sport === filter.key ? 'rgba(255,85,0,0.55)' : 'var(--border)'}`,
                  borderRadius: 999,
                  background: sport === filter.key ? 'rgba(255,85,0,0.1)' : 'var(--surface2)',
                  color: sport === filter.key ? 'var(--orange)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '8px 12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 12,
      }}>
        {teams.map(team => (
          <button
            key={`${team.sport}-${team.slug}`}
            type="button"
            onClick={() => navigate(teamProfilePath(team))}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto minmax(0, 1fr)',
              gap: 12,
              alignItems: 'center',
              padding: 14,
              minHeight: 82,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--surface1)',
              cursor: 'pointer',
              color: 'var(--text-primary)',
              textAlign: 'left',
            }}
          >
            {team.logoUrl ? (
              <img
                src={team.logoUrl}
                alt=""
                style={{ width: 44, height: 44, objectFit: 'contain', filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.35))' }}
                onError={(event) => { event.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <span style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                display: 'grid',
                placeItems: 'center',
                border: '1px solid var(--border)',
                background: 'var(--surface2)',
                fontFamily: 'var(--font-display)',
              }}>
                {team.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span style={{ minWidth: 0 }}>
              <span style={{
                display: 'block',
                fontFamily: 'var(--font-body)',
                fontSize: 15,
                fontWeight: 800,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {team.name}
              </span>
              <span style={{
                display: 'block',
                marginTop: 5,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {team.league}{team.country ? ` · ${team.country}` : ''}
              </span>
            </span>
          </button>
        ))}
      </section>

      {teams.length === 0 && (
        <div style={{
          padding: 28,
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface1)',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          marginTop: 12,
        }}>
          No encontramos equipos con esa búsqueda.
        </div>
      )}
    </main>
  );
}

export default function TeamSearchPage({ surface = 'mvp', onOpenLogin }) {
  const body = <TeamSearchBody />;
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
