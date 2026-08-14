import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../lib/i18n.js';

function scoreWindowOpen(market, now) {
  if (!market?.liveScoreConfig || market.status !== 'active') return false;
  const startMs = market.startTime ? new Date(market.startTime).getTime() : NaN;
  const endMs = market.endTime ? new Date(market.endTime).getTime() : NaN;
  if (!Number.isFinite(startMs) || startMs > now + 15 * 60_000) return false;
  if (!Number.isFinite(endMs)) return true;
  return endMs + 6 * 3600_000 >= now;
}

function liveScoreUrl(config) {
  const params = new URLSearchParams({
    source: config.source || 'espn',
    leaguePath: config.leaguePath,
  });
  if (config.eventId) params.set('eventId', config.eventId);
  if (config.dateYmd) params.set('dateYmd', config.dateYmd);
  if (config.homeName) params.set('homeName', config.homeName);
  if (config.awayName) params.set('awayName', config.awayName);
  return `/api/sports/live-score?${params}`;
}

function displayScore(value) {
  return value == null ? '-' : String(value);
}

function TeamLine({ team, align = 'left' }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: align === 'right' ? 'minmax(0, 1fr) auto' : 'auto minmax(0, 1fr)',
      alignItems: 'center',
      gap: 10,
      minWidth: 0,
      textAlign: align,
    }}>
      {align !== 'right' && <TeamLogo logo={team?.logo} name={team?.name} />}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {team?.name || '-'}
        </div>
      </div>
      {align === 'right' && <TeamLogo logo={team?.logo} name={team?.name} />}
    </div>
  );
}

function TeamLogo({ logo, name }) {
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        style={{ width: 30, height: 30, objectFit: 'contain', flexShrink: 0 }}
        onError={(event) => { event.currentTarget.style.display = 'none'; }}
      />
    );
  }
  const initials = String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
  return (
    <span style={{
      width: 30,
      height: 30,
      borderRadius: 8,
      display: 'grid',
      placeItems: 'center',
      border: '1px solid var(--border)',
      background: 'var(--surface2)',
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-display)',
      fontSize: 12,
    }}>
      {initials}
    </span>
  );
}

function PeriodTable({ score }) {
  const periods = Array.isArray(score?.periods) ? score.periods : [];
  if (periods.length === 0) return null;
  return (
    <div style={{
      overflowX: 'auto',
      paddingBottom: 2,
    }}>
      <table style={{
        width: '100%',
        minWidth: Math.max(320, periods.length * 42 + 120),
        borderCollapse: 'collapse',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--text-secondary)',
      }}>
        <thead>
          <tr>
            <th style={thStyle} />
            {periods.map(period => (
              <th key={period.label} style={thStyle}>{period.label}</th>
            ))}
            <th style={{ ...thStyle, color: 'var(--text-primary)' }}>T</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={teamCellStyle}>{score.away?.name || '-'}</td>
            {periods.map((period, i) => (
              <td key={`${period.label}-away-${i}`} style={tdStyle}>{displayScore(period.away)}</td>
            ))}
            <td style={totalCellStyle}>{displayScore(score.away?.score)}</td>
          </tr>
          <tr>
            <td style={teamCellStyle}>{score.home?.name || '-'}</td>
            {periods.map((period, i) => (
              <td key={`${period.label}-home-${i}`} style={tdStyle}>{displayScore(period.home)}</td>
            ))}
            <td style={totalCellStyle}>{displayScore(score.home?.score)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const thStyle = {
  padding: '0 7px 7px',
  textAlign: 'center',
  color: 'var(--text-muted)',
  fontWeight: 600,
  letterSpacing: '0.08em',
};

const tdStyle = {
  padding: '7px',
  textAlign: 'center',
  borderTop: '1px solid var(--border)',
};

const teamCellStyle = {
  ...tdStyle,
  textAlign: 'left',
  maxWidth: 130,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--text-primary)',
};

const totalCellStyle = {
  ...tdStyle,
  color: 'var(--green)',
  fontWeight: 800,
};

export default function LiveScorePanel({ market }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const enabled = scoreWindowOpen(market, now);
  const [score, setScore] = useState(null);
  const [error, setError] = useState(null);
  const url = useMemo(() => (
    enabled ? liveScoreUrl(market.liveScoreConfig) : null
  ), [enabled, market?.liveScoreConfig]);

  useEffect(() => {
    if (!market?.liveScoreConfig || market.status !== 'active') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [market?.liveScoreConfig, market?.status]);

  useEffect(() => {
    if (!url) {
      setScore(null);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    const load = () => {
      fetch(url)
        .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
        .then(data => {
          if (cancelled) return;
          setScore(data?.liveScore || null);
          setError(null);
        })
        .catch(() => {
          if (!cancelled) setError('live_score_unavailable');
        });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [url]);

  if (!enabled || error || !score) return null;

  return (
    <section style={{
      marginBottom: 24,
      padding: 18,
      border: '1px solid rgba(220,38,38,0.28)',
      borderRadius: 14,
      background: 'linear-gradient(180deg, rgba(220,38,38,0.10), var(--surface1) 70%)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        marginBottom: 14,
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
      }}>
        <span style={{ fontSize: 10, color: '#f87171', fontWeight: 700 }}>
          {t('points.liveScore.title')}
        </span>
        <span style={{
          padding: '4px 9px',
          borderRadius: 999,
          border: '1px solid rgba(248,113,113,0.35)',
          background: 'rgba(220,38,38,0.12)',
          color: 'var(--text-primary)',
          fontSize: 10,
          whiteSpace: 'nowrap',
        }}>
          {score.statusLabel || t('points.liveScore.live')}
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        alignItems: 'center',
        gap: 14,
        marginBottom: score.periods?.length ? 16 : 2,
      }}>
        <TeamLine team={score.away} />
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(24px, 4vw, 38px)',
          color: 'var(--text-primary)',
          lineHeight: 1,
        }}>
          <span>{displayScore(score.away?.score)}</span>
          <span style={{ color: 'var(--text-muted)' }}>-</span>
          <span>{displayScore(score.home?.score)}</span>
        </div>
        <TeamLine team={score.home} align="right" />
      </div>

      <PeriodTable score={score} />
    </section>
  );
}
