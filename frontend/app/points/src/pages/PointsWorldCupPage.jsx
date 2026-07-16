/**
 * World Cup 2026 — dedicated category page at /c/world-cup.
 *
 * The public surface follows the live tournament state: current final
 * markets first, knockout bracket second, and group fixtures as history
 * below.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GROUPS,
  GROUP_FIXTURES,
  TEAMS,
  BRACKET,
  badgeUrl,
  flagUrl,
} from '../lib/worldCup.js';
import { fetchMarkets } from '../lib/pointsApi.js';
import PointsBuyModal from '../components/PointsBuyModal.jsx';

const HERO_GRADIENT =
  'linear-gradient(130deg, rgba(22,163,74,0.25) 0%, rgba(220,38,38,0.22) 45%, rgba(59,130,246,0.28) 100%), var(--surface1)';

const FINAL_MATCHUP = {
  home: {
    team: TEAMS.es,
    accent: '#c60b1e',
    secondary: '#ffc400',
    side: 'Roja y oro',
    note: 'España llega a la final con posesión, control y presión alta.',
  },
  away: {
    team: TEAMS.ar,
    accent: '#75aadb',
    secondary: '#f6f6f6',
    side: 'Celeste y blanco',
    note: 'Argentina trae oficio de eliminación directa y peso histórico.',
  },
};

function useCountdown(targetIso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const targetMs = targetIso ? new Date(targetIso).getTime() : NaN;
  const deltaSec = Number.isFinite(targetMs)
    ? Math.max(0, Math.floor((targetMs - now) / 1000))
    : 0;
  return {
    done: deltaSec === 0,
    days: Math.floor(deltaSec / 86400),
    hours: Math.floor((deltaSec % 86400) / 3600),
    mins: Math.floor((deltaSec % 3600) / 60),
    secs: deltaSec % 60,
  };
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatDateEs(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function formatDateTimeEs(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function teamByLabel(label) {
  const wanted = normalizeText(label);
  if (!wanted) return null;
  return Object.values(TEAMS).find(team =>
    normalizeText(team.name) === wanted
    || normalizeText(team.espn) === wanted
    || normalizeText(team.code) === wanted
  ) || null;
}

function roundLabel(round) {
  return {
    r32: '16vos',
    r16: 'Octavos',
    qf: 'Cuartos',
    sf: 'Semifinal',
    third: 'Tercer lugar',
    final: 'Final',
    knockout: 'Eliminatoria',
  }[round] || 'Eliminatoria';
}

function stageMetaForRound(round) {
  if (round === 'final') {
    return {
      key: 'final',
      eyebrow: 'La final',
      title: 'Final del Mundial',
      loadingText: 'Cargando la final...',
      emptyTitle: 'Final por abrir',
      emptyBody: 'En cuanto admin abra el mercado de la final, aparecerá aquí arriba con botones directos.',
      liveBadge: 'FINAL · Mercado del título',
      heroText: 'España y Argentina llegan al partido por el título. La fase de grupos y las llaves quedan como historial, y los mercados abiertos viven arriba para entrar directo a la final.',
      fallbackLine: 'La final se abre aquí en cuanto el mercado quede listo.',
      bracketTitle: 'Camino al título',
    };
  }
  if (round === 'sf') {
    return {
      key: 'sf',
      eyebrow: 'Ahora en juego',
      title: 'Semifinales',
      loadingText: 'Cargando semifinales...',
      emptyTitle: 'Semifinales por abrir',
      emptyBody: 'En cuanto admin repare o abra los mercados, aparecerán aquí arriba con botones directos.',
      liveBadge: 'ELIMINATORIAS · Semifinales en curso',
      heroText: 'El Mundial ya está en etapa decisiva. La fase de grupos y las primeras llaves quedaron como historial, y los mercados abiertos viven arriba para entrar directo a las semifinales.',
      fallbackLine: 'Semifinales por abrir en admin.',
      bracketTitle: 'Camino a la final',
    };
  }
  return {
    key: 'knockout',
    eyebrow: 'Llaves en juego',
    title: 'Eliminatorias',
    loadingText: 'Cargando eliminatorias...',
    emptyTitle: 'Mercados por abrir',
    emptyBody: 'En cuanto admin abra los mercados de esta ronda, aparecerán aquí arriba con botones directos.',
    liveBadge: 'ELIMINATORIAS · Mercado abierto',
    heroText: 'El Mundial ya está en etapa decisiva. La fase de grupos queda como historial, y los mercados abiertos viven arriba para entrar directo a la ronda actual.',
    fallbackLine: 'Los mercados de eliminatoria aparecerán aquí cuando estén listos.',
    bracketTitle: 'Camino a la final',
  };
}

function describeStageMarket(market) {
  const status = market.status === 'resolved'
    ? 'resuelto'
    : market.status === 'active'
      ? 'abierto'
      : 'cerrado';
  return `${market.question} · ${status}`;
}

// Circular badge — tries ESPN's federation badge first, falls back
// to flagcdn's flag if ESPN returns a 404. The onError swap happens
// in-place via a ref tracking which src we're on.
function TeamBadge({ team, size = 28, title }) {
  const [src, setSrc] = useState(() => badgeUrl(team) || flagUrl(team));
  const [stage, setStage] = useState('badge');
  const onError = () => {
    if (stage === 'badge') {
      const flag = flagUrl(team);
      if (flag && flag !== src) { setSrc(flag); setStage('flag'); return; }
    }
    setStage('missing');
  };
  if (stage === 'missing' || !src) {
    return (
      <span
        title={title || team?.name}
        style={{
          width: size, height: size,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          fontFamily: 'var(--font-mono)',
          fontSize: size * 0.38,
          color: 'var(--text-muted)',
          flexShrink: 0,
        }}
      >
        {team?.name?.slice(0, 2).toUpperCase() || '??'}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={title || team?.name || ''}
      title={title || team?.name}
      onError={onError}
      style={{
        width: size, height: size,
        objectFit: 'contain',
        borderRadius: size * 0.2,
        flexShrink: 0,
        // ESPN badges are square transparent PNGs that sit nicely on
        // surface1. No border so the shape reads cleanly.
        background: stage === 'flag' ? 'var(--surface2)' : 'transparent',
      }}
    />
  );
}

// Compute simple "form" indicator from a team's played matches.
// Returns { played, wins, draws, losses, points, color } or null
// when the team hasn't played yet. Consumed by the group selector
// to tint teams green / amber / red based on MD results so far.
function computeForm(teamCode, markets) {
  let played = 0, wins = 0, draws = 0, losses = 0;
  for (const m of markets) {
    if (m.status !== 'resolved') continue;
    const sd = m.sourceData || null;
    if (!sd) continue;
    if (sd.home?.code !== teamCode && sd.away?.code !== teamCode) continue;
    played += 1;
    const isHome = sd.home?.code === teamCode;
    const winnerIdx = Number(m.outcome);
    if (winnerIdx === 1) { draws += 1; continue; }
    if ((winnerIdx === 0 && isHome) || (winnerIdx === 2 && !isHome)) wins += 1;
    else losses += 1;
  }
  if (played === 0) return null;
  const points = wins * 3 + draws;
  const color = wins > losses ? '#22c55e'
              : losses > wins ? '#ef4444'
              : '#f59e0b';
  return { played, wins, draws, losses, points, color };
}

export default function PointsWorldCupPage() {
  const navigate = useNavigate();
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState('A');
  const [liveOnly, setLiveOnly] = useState(false);
  const [drawer, setDrawer] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMarkets({ status: 'active', category: 'world-cup', limit: 2000, featured: 'all' })
      .then(m => { if (!cancelled) { setMarkets(m); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Also fetch resolved WC markets so form coloring can see past
  // results. Kept separate so a slow resolved-list fetch doesn't
  // block the active grid.
  const [resolvedMarkets, setResolvedMarkets] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchMarkets({ status: 'resolved', category: 'world-cup', limit: 2000, featured: 'all' })
      .then(m => { if (!cancelled) setResolvedMarkets(m); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const allMarkets = useMemo(() => {
    const idx = new Map();
    for (const m of [...markets, ...resolvedMarkets]) {
      if (m?.id != null) idx.set(String(m.id), m);
    }
    return [...idx.values()];
  }, [markets, resolvedMarkets]);

  const marketByQuestion = useMemo(() => {
    const idx = {};
    for (const m of allMarkets) {
      if (!m?.question) continue;
      idx[m.question.trim().toLowerCase()] = m;
      const matchId = m.sourceData?.matchId;
      if (matchId) idx[`match:${matchId}`] = m;
    }
    return idx;
  }, [allMarkets]);

  function matchMarket(homeCode, awayCode, matchId = null) {
    if (matchId && marketByQuestion[`match:${matchId}`]) return marketByQuestion[`match:${matchId}`];
    const home = TEAMS[homeCode]?.name;
    const away = TEAMS[awayCode]?.name;
    if (!home || !away) return null;
    return marketByQuestion[`${home} vs ${away}`.toLowerCase()] || null;
  }

  // "Winner of Group X" parent lookup.
  const groupWinnerByKey = useMemo(() => {
    const idx = {};
    for (const m of allMarkets) {
      if (m.ammMode !== 'parallel') continue;
      const match = /Grupo\s+([A-L])/i.exec(m.question || '');
      if (match) idx[match[1].toUpperCase()] = m;
    }
    return idx;
  }, [allMarkets]);

  const knockoutMarkets = useMemo(() => (
    allMarkets
      .filter(m => {
        const round = m.sourceData?.round || m.resolverConfig?.round;
        return ['r32', 'r16', 'qf', 'sf', 'third', 'final', 'knockout'].includes(round);
      })
      .sort((a, b) => new Date(a.startTime || a.endTime || 0) - new Date(b.startTime || b.endTime || 0))
  ), [allMarkets]);

  const semifinalMarkets = useMemo(
    () => knockoutMarkets.filter(m => (m.sourceData?.round || m.resolverConfig?.round) === 'sf'),
    [knockoutMarkets],
  );
  const finalMarkets = useMemo(
    () => knockoutMarkets.filter(m => roundFromMarket(m) === 'final'),
    [knockoutMarkets],
  );
  const activeKnockoutMarkets = useMemo(
    () => knockoutMarkets.filter(m => m.status === 'active'),
    [knockoutMarkets],
  );
  const featuredStageMarkets = useMemo(() => {
    const finals = finalMarkets.filter(m => m.status !== 'resolved');
    if (finals.length > 0) return finals;
    if (finalMarkets.length > 0) return finalMarkets;
    const semis = semifinalMarkets.filter(m => m.status !== 'resolved');
    if (semis.length > 0) return semis;
    return knockoutMarkets.filter(m => m.status === 'active').slice(0, 4);
  }, [finalMarkets, knockoutMarkets, semifinalMarkets]);
  const featuredRound = useMemo(() => {
    if (featuredStageMarkets.some(m => roundFromMarket(m) === 'final')) return 'final';
    if (featuredStageMarkets.some(m => roundFromMarket(m) === 'sf')) return 'sf';
    return roundFromMarket(featuredStageMarkets[0]) || 'knockout';
  }, [featuredStageMarkets]);
  const stageMeta = useMemo(() => stageMetaForRound(featuredRound), [featuredRound]);
  const nextMarket = useMemo(() => {
    const activeFinals = finalMarkets.filter(m => m.status === 'active');
    if (finalMarkets.length > 0) {
      return activeFinals
        .slice()
        .sort((a, b) => new Date(a.startTime || a.endTime || 0) - new Date(b.startTime || b.endTime || 0))[0] || null;
    }
    return activeKnockoutMarkets
      .slice()
      .sort((a, b) => new Date(a.startTime || a.endTime || 0) - new Date(b.startTime || b.endTime || 0))[0] || null;
  }, [activeKnockoutMarkets, finalMarkets]);
  const resolvedCount = allMarkets.filter(m => m.status === 'resolved').length;
  const activeCount = allMarkets.filter(m => m.status === 'active').length;

  // Is any WC market currently in its live window? Used to reveal
  // the LIVE toggle at the top of the page.
  const anyLive = useMemo(() => {
    const now = Date.now();
    return markets.some(m =>
      m.status === 'active'
      && m.startTime
      && new Date(m.startTime).getTime() <= now
      && m.endTime
      && new Date(m.endTime).getTime() > now,
    );
  }, [markets]);

  const countdown = useCountdown(nextMarket?.startTime || null);
  const groupMatches = useMemo(() => {
    const all = GROUP_FIXTURES.filter(f => f.group === activeGroup);
    if (!liveOnly) return all;
    const now = Date.now();
    return all.filter(f => {
      const market = matchMarket(f.homeCode, f.awayCode, f.matchId);
      if (!market?.startTime || !market?.endTime) return false;
      const start = new Date(market.startTime).getTime();
      const end = new Date(market.endTime).getTime();
      return start <= now && end > now;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup, liveOnly, markets]);

  const mexicoPath = useMemo(
    () => computeMexicoPath(allMarkets),
    [allMarkets],
  );
  const stageLine = featuredStageMarkets.length > 0
    ? featuredStageMarkets.map(describeStageMarket).join(' · ')
    : stageMeta.fallbackLine;

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 80px' }}>
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section style={{
        borderRadius: 18,
        padding: '36px 32px',
        marginBottom: 28,
        background: HERO_GRADIENT,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div aria-hidden style={{
          position: 'absolute',
          top: -20, right: -40,
          display: 'flex', gap: 8, opacity: 0.12,
          pointerEvents: 'none',
        }}>
          {(stageMeta.key === 'final' ? ['es', 'ar', 'es', 'ar'] : ['mx', 'us', 'ca', 'ar', 'br', 'fr', 'es', 'gb-eng']).map((c, i) => (
            <img key={`${c}-${i}`} src={`https://flagcdn.com/w320/${c}.png`} alt=""
              style={{ width: 180, height: 'auto', borderRadius: 4 }} />
          ))}
        </div>

        <div style={{ position: 'relative', maxWidth: 720 }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            letterSpacing: '0.18em', color: 'var(--text-muted)',
            textTransform: 'uppercase', marginBottom: 10,
          }}>
            Mundial FIFA · Canadá · México · USA
          </div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(40px, 6vw, 68px)',
            letterSpacing: '0.02em',
            color: 'var(--text-primary)',
            margin: '0 0 18px',
            lineHeight: 1.05,
          }}>
            <span style={{ color: 'var(--green)' }}>COPA DEL</span> MUNDO <span style={{ color: 'var(--text-muted)' }}>2026</span>
          </h1>
          <p style={{
            fontFamily: 'var(--font-body)', fontSize: 16,
            color: 'var(--text-secondary)', lineHeight: 1.55,
            margin: '0 0 22px', maxWidth: 560,
          }}>
            {stageMeta.heroText} <strong style={{ color: 'var(--text-primary)' }}>{stageLine}</strong>
          </p>

          {stageMeta.key === 'final' && <FinalMatchupStrip />}

          <div style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}>
          {nextMarket && !countdown.done ? (
            <div style={{
              display: 'inline-flex', gap: 8,
              padding: '10px 14px',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 12, fontFamily: 'var(--font-mono)', fontSize: 12,
              alignItems: 'baseline',
            }}>
              <span style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>Faltan</span>
              {[
                { v: countdown.days, l: 'D' },
                { v: countdown.hours, l: 'H' },
                { v: countdown.mins, l: 'M' },
                { v: countdown.secs, l: 'S' },
              ].map((x, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2 }}>
                  <span style={{
                    fontFamily: 'var(--font-display)', fontSize: 22,
                    color: 'var(--green)', minWidth: 28, textAlign: 'right',
                  }}>
                    {pad(x.v)}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.1em' }}>
                    {x.l}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <div style={{
              display: 'inline-block',
              padding: '10px 14px',
              background: 'rgba(220,38,38,0.18)',
              border: '1px solid rgba(220,38,38,0.4)',
              borderRadius: 12,
              color: '#dc2626',
              fontFamily: 'var(--font-mono)', fontSize: 12,
              fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              animation: 'pronos-live-pulse 1.4s ease-in-out infinite',
            }}>
              {stageMeta.liveBadge}
            </div>
          )}
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.14)',
              background: 'rgba(0,0,0,0.18)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.08em',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
            }}>
              {activeCount} abiertos · {resolvedCount} resueltos
            </span>
          </div>
        </div>
      </section>

      {/* ── Current stage ───────────────────────────────────────── */}
      <CurrentStage
        loading={loading}
        markets={featuredStageMarkets}
        nextMarket={nextMarket}
        stageMeta={stageMeta}
        onOpen={(market) => navigate(`/market?id=${market.id}`)}
        onBuy={(market, outcomeIndex, label) => setDrawer({ market, outcomeIndex, label })}
      />

      {/* ── Bracket ────────────────────────────────────────────── */}
      <section style={{ marginBottom: 40 }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 16,
          marginBottom: 12,
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 11,
              letterSpacing: '0.12em', color: 'var(--text-muted)',
              textTransform: 'uppercase', marginBottom: 6,
            }}>
              Llaves · Eliminatorias
            </div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(28px, 4vw, 42px)',
              color: 'var(--text-primary)',
              margin: 0,
              lineHeight: 1,
            }}>
              {stageMeta.bracketTitle}
            </h2>
          </div>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
          }}>
            {activeKnockoutMarkets.length} mercados abiertos
          </span>
        </div>
        <BracketView markets={knockoutMarkets} onOpen={(market) => navigate(`/market?id=${market.id}`)} />
      </section>

      {/* ── Mexico Path ─────────────────────────────────────────── */}
      <MexicoPathCard path={mexicoPath} />

      {/* ── Group selector ─────────────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 12,
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            letterSpacing: '0.12em', color: 'var(--text-muted)',
            textTransform: 'uppercase',
          }}>
            Historial · Fase de grupos
          </div>
          {anyLive && (
            <button
              onClick={() => setLiveOnly(v => !v)}
              style={{
                padding: '6px 12px',
                borderRadius: 100,
                border: `1px solid ${liveOnly ? 'rgba(220,38,38,0.5)' : 'var(--border)'}`,
                background: liveOnly ? 'rgba(220,38,38,0.15)' : 'var(--surface1)',
                color: liveOnly ? '#dc2626' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)', fontSize: 11,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#dc2626',
                animation: liveOnly ? 'pronos-live-pulse 1.4s ease-in-out infinite' : 'none',
              }} />
              {liveOnly ? 'Solo en vivo' : 'Ver solo en vivo'}
            </button>
          )}
        </div>
        <div className="wc-group-grid">
          {GROUPS.map(g => {
            const active = activeGroup === g.key;
            const teams = g.teams.map(c => ({ key: c, ...TEAMS[c] })).filter(Boolean);
            return (
              <button
                key={g.key}
                onClick={() => setActiveGroup(g.key)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: `1px solid ${active ? 'var(--green)' : 'var(--border)'}`,
                  background: active ? 'rgba(0,232,122,0.08)' : 'var(--surface1)',
                  cursor: 'pointer',
                  transition: 'border-color 0.12s',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{
                  fontFamily: 'var(--font-display)', fontSize: 16,
                  color: active ? 'var(--green)' : 'var(--text-primary)',
                  letterSpacing: '0.04em', marginBottom: 10,
                }}>
                  Grupo {g.key}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {teams.map(team => {
                    const form = computeForm(team.key, resolvedMarkets);
                    return (
                      <div
                        key={team.code}
                        className="wc-group-team-row"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '3px 6px',
                          borderRadius: 6,
                          borderLeft: form ? `3px solid ${form.color}` : '3px solid transparent',
                        }}
                      >
                        <TeamBadge team={team} size={18} />
                        <span style={{
                          flex: 1, minWidth: 0,
                          fontFamily: 'var(--font-body)', fontSize: 11,
                          color: 'var(--text-secondary)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {team.name}
                        </span>
                        {form && (
                          <span className="wc-group-form-pill" style={{
                            fontFamily: 'var(--font-mono)', fontSize: 9,
                            color: form.color, fontWeight: 700,
                          }}>
                            {form.points}pts
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Active group's matches + winner market ─────────────── */}
      <section style={{ marginBottom: 40 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: 14,
        }}>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: 24,
            color: 'var(--text-primary)', margin: 0,
          }}>
            Grupo {activeGroup} · Resultados
          </h2>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            letterSpacing: '0.1em', color: 'var(--text-muted)',
            textTransform: 'uppercase',
          }}>
            {groupMatches.length} partidos
          </span>
        </div>

        {loading && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
            Cargando mercados…
          </p>
        )}

        {groupWinnerByKey[activeGroup] && (
          <GroupWinnerCard
            market={groupWinnerByKey[activeGroup]}
            onBuy={(idx, label) => {
              const parent = groupWinnerByKey[activeGroup];
              const legId = Array.isArray(parent.legIds) ? parent.legIds[idx] : null;
              const legPrice = Array.isArray(parent.prices) ? parent.prices[idx] : 0.5;
              const target = legId
                ? {
                    ...parent,
                    id: legId,
                    ammMode: 'unified',
                    outcomes: ['Sí', 'No'],
                    prices: [legPrice, 1 - legPrice],
                    outcomeImages: null,
                  }
                : parent;
              setDrawer({ market: target, outcomeIndex: legId ? 0 : idx, label });
            }}
          />
        )}

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {groupMatches.map(f => {
            const home = TEAMS[f.homeCode];
            const away = TEAMS[f.awayCode];
            if (!home || !away) return null;
      const market = matchMarket(f.homeCode, f.awayCode, f.matchId);
            return (
              <MatchRow
                key={f.matchId}
                fixture={f}
                home={home}
                away={away}
                market={market}
                onBuy={(outcomeIndex, label) =>
                  market && setDrawer({ market, outcomeIndex, label })}
                onOpen={() => market && navigate(`/market?id=${market.id}`)}
              />
            );
          })}
        </div>
      </section>

      {drawer && (
        <PointsBuyModal
          open={true}
          variant="drawer"
          market={drawer.market}
          outcomeIndex={drawer.outcomeIndex}
          outcomeLabel={drawer.label}
          onClose={() => setDrawer(null)}
          onSuccess={() => setDrawer(null)}
        />
      )}
    </main>
  );
}

// ── Components ────────────────────────────────────────────────────────────

function FinalMatchupStrip() {
  return (
    <div className="wc-final-matchup-strip" style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
      gap: 12,
      alignItems: 'stretch',
      margin: '0 0 22px',
      maxWidth: 720,
    }}>
      <FinalTeamPanel side={FINAL_MATCHUP.home} index={0} />
      <div style={{
        alignSelf: 'center',
        width: 54,
        height: 54,
        borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.16)',
        background: 'rgba(0,0,0,0.26)',
        color: 'var(--text-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-display)',
        fontSize: 22,
        letterSpacing: '0.04em',
      }}>
        VS
      </div>
      <FinalTeamPanel side={FINAL_MATCHUP.away} index={1} />
    </div>
  );
}

function FinalTeamPanel({ side, index }) {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        minHeight: 118,
        padding: '16px 18px',
        borderRadius: 16,
        border: `1px solid ${side.accent}66`,
        background: `linear-gradient(135deg, ${side.accent}24, ${side.secondary}18), rgba(0,0,0,0.24)`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <img
        src={flagUrl(side.team, 320)}
        alt=""
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: -22,
          top: -20,
          width: 150,
          opacity: 0.12,
          transform: index === 0 ? 'rotate(-7deg)' : 'rotate(7deg)',
          pointerEvents: 'none',
        }}
      />
      <div style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <TeamBadge team={side.team} size={42} />
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            lineHeight: 0.95,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {side.team.name}
          </div>
          <div style={{
            marginTop: 6,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            color: side.secondary === '#f6f6f6' ? 'var(--text-secondary)' : side.secondary,
            textTransform: 'uppercase',
          }}>
            {side.side}
          </div>
        </div>
      </div>
      <p style={{
        position: 'relative',
        margin: '14px 0 0',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-body)',
        fontSize: 13,
        lineHeight: 1.35,
      }}>
        {side.note}
      </p>
    </div>
  );
}

function CurrentStage({ loading, markets, nextMarket, stageMeta, onOpen, onBuy }) {
  const hasMarkets = markets.length > 0;
  const meta = stageMeta || stageMetaForRound('knockout');
  return (
    <section style={{ marginBottom: 42 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 16,
        marginBottom: 14,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            color: 'var(--green)',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}>
            {meta.eyebrow}
          </div>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(34px, 5vw, 56px)',
            color: 'var(--text-primary)',
            margin: 0,
            lineHeight: 0.95,
          }}>
            {meta.title}
          </h2>
        </div>
        {nextMarket?.startTime && (
          <div style={{
            textAlign: 'right',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
          }}>
            Siguiente mercado
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              letterSpacing: 0,
              textTransform: 'none',
              color: 'var(--text-secondary)',
              marginTop: 4,
            }}>
              {formatDateTimeEs(nextMarket.startTime)}
            </div>
          </div>
        )}
      </div>

      {loading && !hasMarkets && (
        <div style={{
          background: 'var(--surface1)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 22,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {meta.loadingText}
        </div>
      )}

      {!loading && !hasMarkets && (
        <div style={{
          background: 'var(--surface1)',
          border: '1px solid rgba(245,158,11,0.32)',
          borderRadius: 16,
          padding: 22,
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 26,
            color: 'var(--text-primary)',
            marginBottom: 6,
          }}>
            {meta.emptyTitle}
          </div>
          <p style={{
            margin: 0,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            lineHeight: 1.5,
          }}>
            {meta.emptyBody}
          </p>
        </div>
      )}

      {hasMarkets && (
        <div className="wc-stage-grid">
          {markets.map(market => (
            <FeaturedKnockoutCard
              key={market.id}
              market={market}
              onOpen={() => onOpen?.(market)}
              onBuy={(outcomeIndex, label) => onBuy?.(market, outcomeIndex, label)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FeaturedKnockoutCard({ market, onOpen, onBuy }) {
  const outcomes = Array.isArray(market.outcomes) && market.outcomes.length > 0
    ? market.outcomes
    : ['Sí', 'No'];
  const prices = Array.isArray(market.prices) ? market.prices : outcomes.map(() => 1 / outcomes.length);
  const images = Array.isArray(market.outcomeImages) ? market.outcomeImages : [];
  const round = roundFromMarket(market);
  const isResolved = market.status === 'resolved';
  const isActive = market.status === 'active';
  const winnerIndex = Number(market.outcome);

  return (
    <article
      onClick={onOpen}
      role="button"
      style={{
        position: 'relative',
        overflow: 'hidden',
        minHeight: 260,
        borderRadius: 20,
        border: `1px solid ${isActive ? 'rgba(0,232,122,0.36)' : 'var(--border)'}`,
        background: 'radial-gradient(circle at 18% 0%, rgba(0,232,122,0.18), transparent 32%), radial-gradient(circle at 86% 18%, rgba(255,85,0,0.2), transparent 34%), var(--surface1)',
        padding: 22,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div aria-hidden style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(145deg, rgba(255,255,255,0.04), transparent 45%)',
        pointerEvents: 'none',
      }} />
      <div style={{ position: 'relative' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'center',
          marginBottom: 18,
        }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 11px',
            borderRadius: 100,
            border: `1px solid ${isActive ? 'rgba(0,232,122,0.36)' : 'rgba(255,255,255,0.14)'}`,
            background: isActive ? 'rgba(0,232,122,0.1)' : 'rgba(255,255,255,0.05)',
            color: isActive ? 'var(--green)' : 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontWeight: 700,
          }}>
            {isActive ? 'Abierto' : isResolved ? 'Final' : 'Cerrado'} · {roundLabel(round)}
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
          }}>
            {formatDateTimeEs(market.startTime || market.endTime)}
          </span>
        </div>

        <h3 style={{
          margin: 0,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(26px, 4vw, 42px)',
          lineHeight: 0.98,
          letterSpacing: '0.01em',
        }}>
          {market.question}
        </h3>
      </div>

      <div style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(outcomes.length, 2)}, minmax(0, 1fr))`,
        gap: 10,
        marginTop: 22,
      }}>
        {outcomes.map((label, i) => {
          const team = teamByLabel(label);
          const pct = isResolved ? (winnerIndex === i ? 100 : 0) : Math.round((prices[i] ?? 0) * 100);
          const activeTone = i === 0
            ? { bg: 'rgba(0,232,122,0.12)', border: 'rgba(0,232,122,0.36)', color: 'var(--green)' }
            : { bg: 'rgba(255,85,0,0.12)', border: 'rgba(255,85,0,0.34)', color: 'var(--orange)' };
          return (
            <button
              key={`${label}-${i}`}
              type="button"
              disabled={!isActive}
              onClick={(e) => {
                e.stopPropagation();
                if (isActive) onBuy?.(i, label);
              }}
              style={{
                minHeight: 78,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                borderRadius: 14,
                border: `1px solid ${activeTone.border}`,
                background: activeTone.bg,
                cursor: isActive ? 'pointer' : 'default',
                textAlign: 'left',
                opacity: isResolved && winnerIndex !== i ? 0.58 : 1,
              }}
            >
              {images[i] ? (
                <img
                  src={images[i]}
                  alt=""
                  style={{ width: 38, height: 38, objectFit: 'contain', flexShrink: 0 }}
                />
              ) : (
                <TeamBadge team={team} size={38} title={label} />
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block',
                  fontFamily: 'var(--font-display)',
                  fontSize: 22,
                  color: activeTone.color,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {label}
                </span>
                <span style={{
                  display: 'block',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  marginTop: 2,
                }}>
                  {isResolved ? 'Resultado' : 'Elegir resultado'}
                </span>
              </span>
              <strong style={{
                fontFamily: 'var(--font-display)',
                fontSize: 28,
                color: activeTone.color,
                lineHeight: 1,
              }}>
                {pct}%
              </strong>
            </button>
          );
        })}
      </div>
    </article>
  );
}

function MatchRow({ fixture, home, away, market, onBuy, onOpen }) {
  const hasMarket = Boolean(market);
  const isResolved = market?.status === 'resolved';
  const isActive = market?.status === 'active';
  const outcomeLabels = Array.isArray(market?.outcomes) && market.outcomes.length > 0
    ? market.outcomes
    : [home.name, 'Empate', away.name];
  const prices = hasMarket && Array.isArray(market.prices)
    ? market.prices
    : [0.4, 0.25, 0.35];
  const pct = (i) => Math.round((prices[i] ?? 0) * 100);
  const accent = [
    { bg: 'var(--yes-dim, rgba(22,163,74,0.1))', border: 'rgba(22,163,74,0.3)', fg: 'var(--yes)' },
    { bg: 'rgba(245,158,11,0.1)',                border: 'rgba(245,158,11,0.3)', fg: 'var(--gold, #f59e0b)' },
    { bg: 'rgba(255,59,59,0.08)',                border: 'rgba(255,59,59,0.3)',  fg: '#ff3b3b' },
  ];

  return (
    <div
      className="wc-match-row"
      onClick={onOpen}
      role="button"
      style={{
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 16px',
        display: 'grid',
        gridTemplateColumns: '100px minmax(0, 1fr) auto',
        gap: 14,
        alignItems: 'center',
        cursor: hasMarket ? 'pointer' : 'default',
        transition: 'border-color 0.12s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      <div className="wc-match-meta">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--text-primary)' }}>
          {formatDateEs(fixture.kickoffIso)}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
          {fixture.matchday} · {fixture.venue}
        </div>
      </div>

      <div className="wc-match-teams" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[home, away].map((team, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TeamBadge team={team} size={26} />
            <span style={{
              flex: 1,
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {team.name}
            </span>
          </div>
        ))}
      </div>

      <div className="wc-match-actions" style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {isResolved ? (
          <span className="wc-match-status-pill" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 11px',
            background: 'rgba(0,232,122,0.10)',
            border: '1px solid rgba(0,232,122,0.35)',
            borderRadius: 100,
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.08em', color: 'var(--green)',
            textTransform: 'uppercase',
          }}>
            Final · {market.finalScore || outcomeLabels[Number(market.outcome)] || 'Resultado'}
          </span>
        ) : isActive ? outcomeLabels.map((label, i) => (
          <button
            key={i}
            className="wc-match-odd-btn"
            onClick={(e) => { e.stopPropagation(); onBuy(i, label); }}
            style={{
              padding: '7px 10px',
              borderRadius: 100,
              border: `1px solid ${accent[i % accent.length].border}`,
              background: accent[i % accent.length].bg,
              color: accent[i % accent.length].fg,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.06em',
              fontWeight: 700,
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            {label} · {pct(i)}%
          </button>
        )) : (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 10px',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: 100,
          fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.1em', color: 'var(--text-muted)',
          textTransform: 'uppercase',
        }}>
          Sin mercado
        </span>
        )}
      </div>
    </div>
  );
}

// Winner-of-group card — shows each team's implied probability on the
// parent parallel market and lets the user buy Sí/No on any team.
function GroupWinnerCard({ market, onBuy }) {
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  const prices = Array.isArray(market.prices) && market.prices.length === outcomes.length
    ? market.prices
    : outcomes.map(() => 1 / Math.max(1, outcomes.length));
  const images = Array.isArray(market.outcomeImages) ? market.outcomeImages : [];
  const isResolved = market.status === 'resolved';
  return (
    <div style={{
      background: 'var(--surface1)',
      border: '1px solid rgba(245,158,11,0.3)',
      borderRadius: 14,
      padding: '16px 18px',
      marginBottom: 12,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.14em', color: 'var(--gold, #f59e0b)',
            textTransform: 'uppercase', marginBottom: 2,
          }}>
            Ganador del grupo
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 18,
            color: 'var(--text-primary)',
          }}>
            {market.question}
          </div>
        </div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 8,
      }}>
        {outcomes.map((label, i) => {
          const pct = Math.round((prices[i] ?? 0) * 100);
          const isWinner = isResolved && Number(market.outcome) === i;
          return (
            <button
              key={i}
              type="button"
              disabled={isResolved || market.status !== 'active'}
              onClick={() => onBuy(i, `${label} — Sí`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px',
                background: isWinner ? 'rgba(0,232,122,0.12)' : 'var(--surface2)',
                border: `1px solid ${isWinner ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                borderRadius: 10,
                textAlign: 'left',
                cursor: isResolved || market.status !== 'active' ? 'default' : 'pointer',
                opacity: isResolved && !isWinner ? 0.55 : 1,
              }}
            >
              <img
                src={images[i] || ''}
                alt=""
                style={{ width: 22, height: 22, objectFit: 'contain', flexShrink: 0 }}
                onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
              />
              <span style={{
                flex: 1, minWidth: 0,
                fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {label}
              </span>
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 14,
                color: isWinner ? 'var(--green)' : 'var(--gold, #f59e0b)',
                minWidth: 36,
                textAlign: 'right',
              }}>
                {isResolved ? (isWinner ? '100%' : '0%') : `${pct}%`}
              </span>
            </button>
          );
        })}
      </div>
      {isResolved && (
        <div style={{
          marginTop: 10,
          textAlign: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.1em', color: 'var(--green)',
          textTransform: 'uppercase',
        }}>
          Resultado final · {market.finalScore || outcomes[Number(market.outcome)]}
        </div>
      )}
    </div>
  );
}

// ── Mexico Path composite ─────────────────────────────────────────────────
//
// Rough implied probability of Mexico advancing through each stage of
// the tournament, computed from whatever WC markets the user is
// actively trading. Group advance = P(at least 2 wins or 1 win + 2
// draws) approximated as: avg P(win) across 3 group matches × 2.
// Later stages fall back to 0.5 × prev (naive bracket halving) until
// real knockout markets exist.
function computeMexicoPath(markets) {
  const mxMatches = markets.filter(m => {
    const q = m.question || '';
    return /\bméxico\b/i.test(q);
  });
  if (mxMatches.length === 0) return null;

  // Sum Mexico's win-probability across its 3 group matches. We
  // infer Mexico's side from outcome index: outcome 0 is home, 2 is
  // away. source_data isn't in the public payload so we match on
  // question text "México vs X" (home) or "X vs México" (away).
  let sumWinP = 0, count = 0;
  for (const m of mxMatches) {
    if (!Array.isArray(m.prices) || m.prices.length < 3) continue;
    const q = m.question || '';
    const mexFirst = /^méxico\s+vs/i.test(q);
    const pWin = mexFirst ? m.prices[0] : m.prices[2];
    if (Number.isFinite(pWin)) { sumWinP += Number(pWin); count += 1; }
  }
  if (count === 0) return null;
  const avgWin = sumWinP / count;
  // Crude: P(advance) ≈ 1 − (1 − avgWin)^2 (at least one win out
  // of three is usually enough to finish top-2 in a group). Caps at
  // 99% to avoid the "certain" look.
  const pAdvance = Math.min(0.99, 1 - Math.pow(1 - avgWin, 2));
  // Knockout: ~coin flip per round as a placeholder.
  return [
    { label: 'Avanza del grupo',      p: pAdvance },
    { label: 'Cuartos de final (QF)', p: pAdvance * 0.55 },
    { label: 'Semifinales',           p: pAdvance * 0.55 * 0.5 },
    { label: 'Final',                 p: pAdvance * 0.55 * 0.5 * 0.5 },
    { label: 'Campeón',               p: pAdvance * 0.55 * 0.5 * 0.5 * 0.5 },
  ];
}

function MexicoPathCard({ path }) {
  if (!path) return null;
  return (
    <section style={{
      background: 'linear-gradient(130deg, rgba(22,163,74,0.15) 0%, rgba(220,38,38,0.1) 100%), var(--surface1)',
      border: '1px solid rgba(22,163,74,0.35)',
      borderRadius: 14,
      padding: '18px 20px',
      marginBottom: 28,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14,
      }}>
        <img src="https://flagcdn.com/w80/mx.png" alt="México"
          style={{ width: 28, height: 20, objectFit: 'cover', borderRadius: 3 }} />
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.14em', color: 'var(--green)',
            textTransform: 'uppercase', marginBottom: 2,
          }}>
            El camino de México
          </div>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 12,
            color: 'var(--text-muted)',
          }}>
            Probabilidad implícita por etapa, según los mercados activos
          </div>
        </div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${path.length}, minmax(0, 1fr))`,
        gap: 6,
      }}>
        {path.map((stage, i) => {
          const pct = Math.round(stage.p * 100);
          const intensity = Math.min(1, Math.max(0.1, stage.p));
          return (
            <div key={i} style={{
              padding: '10px 8px',
              borderRadius: 8,
              background: `rgba(22,163,74,${0.06 + intensity * 0.18})`,
              border: `1px solid rgba(22,163,74,${0.2 + intensity * 0.3})`,
              textAlign: 'center',
            }}>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 22,
                color: 'var(--green)', lineHeight: 1,
              }}>
                {pct}%
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 9,
                letterSpacing: '0.06em', color: 'var(--text-muted)',
                textTransform: 'uppercase', marginTop: 6,
              }}>
                {stage.label}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Symmetrical bracket: every column uses the same container height
// and `justify-content: space-around`, so R16 slots sit at the
// midpoint between their two parent R32 slots (and so on) without
// hand-tuned gaps. Styling lives in .wc-bracket / .wc-bracket-col.
function roundFromMarket(market) {
  return market?.sourceData?.round || market?.resolverConfig?.round || null;
}

function BracketView({ markets = [], onOpen }) {
  const marketColumns = [
    { key: 'r32', label: '16vos', fallback: BRACKET.r32 },
    { key: 'r16', label: '8vos', fallback: BRACKET.r16 },
    { key: 'qf', label: 'QF', fallback: BRACKET.qf },
    { key: 'sf', label: 'SF', fallback: BRACKET.sf },
    { key: 'final', label: 'Final', fallback: [BRACKET.final] },
  ].map(col => {
    const realMarkets = markets.filter(m => roundFromMarket(m) === col.key);
    return {
      ...col,
      markets: realMarkets,
      slots: realMarkets.length > 0 ? [] : col.fallback,
    };
  });
  return (
    <div className="wc-bracket">
      {marketColumns.map(col => (
        <div key={col.label}>
          <div className="wc-bracket-col-label">{col.label}</div>
          <div className="wc-bracket-col">
            {col.markets.map(market => (
              <button
                key={market.id}
                type="button"
                className="wc-bracket-slot"
                onClick={() => onOpen?.(market)}
                style={{
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderColor: market.status === 'resolved' ? 'rgba(0,232,122,0.32)' : undefined,
                }}
              >
                <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  {market.question}
                </div>
                <div style={{ color: market.status === 'resolved' ? 'var(--green)' : 'var(--text-muted)', fontSize: 9, letterSpacing: '0.06em' }}>
                  {market.status === 'resolved'
                    ? (market.finalScore || 'Final')
                    : new Date(market.startTime || market.endTime).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                </div>
              </button>
            ))}
            {col.slots.map(slot => (
              <div key={slot.id} className="wc-bracket-slot">
                <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  {slot.home} <span style={{ color: 'var(--text-muted)' }}>vs</span> {slot.away}
                </div>
                {slot.date && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.06em' }}>
                    {new Date(slot.date).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
