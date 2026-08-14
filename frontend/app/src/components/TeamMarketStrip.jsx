import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { findTeamByName, teamProfilePath } from '../lib/teamProfiles.js';

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

function teamLogo(team, outcomeImages, outcomeIndex) {
  return outcomeImages?.[outcomeIndex] || team?.logoUrl || null;
}

export default function TeamMarketStrip({ market, outcomeImages }) {
  const navigate = useNavigate();
  const teams = useMemo(() => {
    const sport = market?.sport || market?.league || 'soccer';
    const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
    const seen = new Set();
    return outcomes
      .map((label, outcomeIndex) => {
        const team = findTeamByName(sport, label);
        if (!team || seen.has(team.slug)) return null;
        seen.add(team.slug);
        return { team, outcomeIndex };
      })
      .filter(Boolean);
  }, [market]);

  if (teams.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      marginBottom: 22,
    }}>
      {teams.map(({ team, outcomeIndex }) => {
        const path = teamProfilePath(team);
        const logo = teamLogo(team, outcomeImages, outcomeIndex);
        return (
          <button
            key={team.slug}
            type="button"
            onClick={() => navigate(path)}
            style={{
              minWidth: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--surface1)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {logo ? (
              <img
                src={logo}
                alt=""
                style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }}
                onError={(event) => { event.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <span style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                border: '1px solid var(--border)',
                background: 'var(--surface2)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-display)',
                fontSize: 12,
                flexShrink: 0,
              }}>
                {initials(team.name)}
              </span>
            )}
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {team.name}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => navigate('/teams')}
        style={{
          border: '1px solid rgba(255,85,0,0.35)',
          borderRadius: 999,
          background: 'rgba(255,85,0,0.08)',
          color: 'var(--orange)',
          cursor: 'pointer',
          padding: '8px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        Buscar equipos
      </button>
    </div>
  );
}
