import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import Footer from '../components/Footer.jsx';
import { teamInterestPayload, trackInterest } from '../lib/interest.js';
import { mergeTeamDirectoryLogos, sortTeamsForDirectory } from '../lib/teamDirectory.js';
import { TEAM_PROFILES, teamProfilePath } from '../lib/teamProfiles.js';

const SPORT_FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'soccer', label: 'Fútbol' },
  { key: 'basketball', label: 'Basketball' },
  { key: 'baseball', label: 'Béisbol' },
  { key: 'nfl', label: 'NFL' },
];

export const SOCCER_LEAGUE_FILTERS = [
  { key: 'all', label: 'Todo fútbol' },
  { key: 'uefa-cl', label: 'Champions League' },
  { key: 'la-liga', label: 'La Liga' },
  { key: 'premier-league', label: 'Premier League' },
  { key: 'serie-a', label: 'Serie A' },
  { key: 'bundesliga', label: 'Bundesliga' },
  { key: 'copa-libertadores', label: 'Copa Libertadores' },
  { key: 'uefa-europa-league', label: 'Europa League' },
  { key: 'uefa-conference-league', label: 'Conference League' },
  { key: 'liga-mx', label: 'Liga MX' },
  { key: 'mls', label: 'MLS' },
];

export const BASEBALL_LEAGUE_FILTERS = [
  { key: 'all', label: 'Todo béisbol' },
  { key: 'mlb', label: 'MLB' },
  { key: 'lmb', label: 'LMB' },
  { key: 'lmp', label: 'LMP' },
];

const SOCCER_LEAGUE_BY_NAME = new Map([
  ['bundesliga', 'bundesliga'],
  ['la liga', 'la-liga'],
  ['liga mx', 'liga-mx'],
  ['ligue 1', 'ligue-1'],
  ['mls', 'mls'],
  ['premier league', 'premier-league'],
  ['serie a', 'serie-a'],
]);

const BASEBALL_LEAGUE_BY_NAME = new Map([
  ['mlb', 'mlb'],
  ['lmb', 'lmb'],
  ['lmp', 'lmp'],
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function soccerTeamInLeague(team, leagueKey) {
  if (leagueKey === 'all') return true;
  const domestic = SOCCER_LEAGUE_BY_NAME.get(normalize(team.league));
  if (domestic === leagueKey) return true;
  return Array.isArray(team.competitions) && team.competitions.includes(leagueKey);
}

function baseballTeamInLeague(team, leagueKey) {
  if (leagueKey === 'all') return true;
  return BASEBALL_LEAGUE_BY_NAME.get(normalize(team.league)) === leagueKey;
}

function TeamSearchBody({ surface }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sport, setSport] = useState('all');
  const [soccerLeague, setSoccerLeague] = useState('all');
  const [baseballLeague, setBaseballLeague] = useState('all');
  const [directoryLogos, setDirectoryLogos] = useState({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/team-directory', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && data?.logos && typeof data.logos === 'object') {
          setDirectoryLogos(data.logos);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const teams = useMemo(() => {
    const q = normalize(query.trim());
    const filtered = mergeTeamDirectoryLogos(TEAM_PROFILES, directoryLogos)
      .filter(team => sport === 'all' || team.sport === sport)
      .filter(team => sport !== 'soccer' || soccerTeamInLeague(team, soccerLeague))
      .filter(team => sport !== 'baseball' || baseballTeamInLeague(team, baseballLeague))
      .filter(team => {
        if (!q) return true;
        const text = normalize([
          team.name,
          team.league,
          team.country,
          ...(team.aliases || []),
        ].join(' '));
        return text.includes(q);
      });
    return sortTeamsForDirectory(filtered, sport);
  }, [query, sport, soccerLeague, baseballLeague, directoryLogos]);

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
                onClick={() => {
                  setSport(filter.key);
                  if (filter.key !== 'soccer') setSoccerLeague('all');
                  if (filter.key !== 'baseball') setBaseballLeague('all');
                }}
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
          {sport === 'soccer' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SOCCER_LEAGUE_FILTERS.map(filter => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setSoccerLeague(filter.key)}
                  style={{
                    border: `1px solid ${soccerLeague === filter.key ? 'rgba(0,232,122,0.5)' : 'var(--border)'}`,
                    borderRadius: 999,
                    background: soccerLeague === filter.key ? 'rgba(0,232,122,0.1)' : 'var(--surface2)',
                    color: soccerLeague === filter.key ? 'var(--green)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '7px 11px',
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
          )}
          {sport === 'baseball' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {BASEBALL_LEAGUE_FILTERS.map(filter => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setBaseballLeague(filter.key)}
                  style={{
                    border: `1px solid ${baseballLeague === filter.key ? 'rgba(0,232,122,0.5)' : 'var(--border)'}`,
                    borderRadius: 999,
                    background: baseballLeague === filter.key ? 'rgba(0,232,122,0.1)' : 'var(--surface2)',
                    color: baseballLeague === filter.key ? 'var(--green)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '7px 11px',
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
          )}
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
            onClick={() => {
              trackInterest({
                ...teamInterestPayload(surface, team, 'click'),
                objectType: 'team',
              });
              navigate(teamProfilePath(team));
            }}
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
  const body = <TeamSearchBody surface={surface} />;
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
