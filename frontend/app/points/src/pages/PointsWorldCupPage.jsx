/**
 * World Cup 2026 — dedicated category page at /c/world-cup.
 *
 * Sections:
 *   1. Hero with live countdown to the 2026-06-11 Azteca opener
 *   2. Mexico Path — implied-probability projection across stages
 *      (pulled from the group markets the user is trading)
 *   3. Group selector grid with team badges + form tint
 *   4. Per-group match rows with 1/X/2 buy pills → drawer
 *   5. "Winner of Group X" parallel market card
 *   6. Bracket preview (R32 → Final) as a CSS-grid tree
 *
 * Live-only toggle at the top filters the match list to games that
 * are kicking off right now — invisible while the tournament is dark,
 * essential once it starts.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GROUPS,
  GROUP_FIXTURES,
  TEAMS,
  BRACKET,
  OPENING_KICKOFF_ISO,
  badgeUrl,
  flagUrl,
} from '../lib/worldCup.js';
import { fetchMarkets } from '../lib/pointsApi.js';
import PointsBuyModal from '../components/PointsBuyModal.jsx';

const HERO_GRADIENT =
  'linear-gradient(130deg, rgba(22,163,74,0.25) 0%, rgba(220,38,38,0.22) 45%, rgba(59,130,246,0.28) 100%), var(--surface1)';

function useCountdown(targetIso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const deltaSec = Math.max(0, Math.floor((new Date(targetIso).getTime() - now) / 1000));
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
    fetchMarkets({ status: 'active', category: 'world-cup', limit: 2000 })
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
    fetchMarkets({ status: 'resolved', category: 'world-cup', limit: 2000 })
      .then(m => { if (!cancelled) setResolvedMarkets(m); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const marketByQuestion = useMemo(() => {
    const idx = {};
    for (const m of markets) {
      if (!m?.question) continue;
      idx[m.question.trim().toLowerCase()] = m;
    }
    return idx;
  }, [markets]);

  function matchMarket(homeCode, awayCode) {
    const home = TEAMS[homeCode]?.name;
    const away = TEAMS[awayCode]?.name;
    if (!home || !away) return null;
    return marketByQuestion[`${home} vs ${away}`.toLowerCase()] || null;
  }

  // "Winner of Group X" parent lookup.
  const groupWinnerByKey = useMemo(() => {
    const idx = {};
    for (const m of markets) {
      if (m.ammMode !== 'parallel') continue;
      const match = /Grupo\s+([A-L])/i.exec(m.question || '');
      if (match) idx[match[1].toUpperCase()] = m;
    }
    return idx;
  }, [markets]);

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

  const countdown = useCountdown(OPENING_KICKOFF_ISO);
  const groupMatches = useMemo(() => {
    const all = GROUP_FIXTURES.filter(f => f.group === activeGroup);
    if (!liveOnly) return all;
    const now = Date.now();
    return all.filter(f => {
      const market = matchMarket(f.homeCode, f.awayCode);
      if (!market?.startTime || !market?.endTime) return false;
      const start = new Date(market.startTime).getTime();
      const end = new Date(market.endTime).getTime();
      return start <= now && end > now;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup, liveOnly, markets]);

  const mexicoPath = useMemo(
    () => computeMexicoPath(markets),
    [markets],
  );

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
          {['mx', 'us', 'ca', 'ar', 'br', 'fr', 'es', 'gb-eng'].map(c => (
            <img key={c} src={`https://flagcdn.com/w320/${c}.png`} alt=""
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
            🏆 <span style={{ color: 'var(--green)' }}>COPA DEL</span> MUNDO <span style={{ color: 'var(--text-muted)' }}>2026</span>
          </h1>
          <p style={{
            fontFamily: 'var(--font-body)', fontSize: 16,
            color: 'var(--text-secondary)', lineHeight: 1.55,
            margin: '0 0 22px', maxWidth: 560,
          }}>
            48 selecciones. 12 grupos. 104 partidos. Arranca el <strong style={{ color: 'var(--text-primary)' }}>11 de junio</strong> en el Azteca y termina el 19 de julio en MetLife. Todos los mercados en un solo lugar.
          </p>

          {!countdown.done ? (
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
              🔴 EN VIVO · El Mundial ha comenzado
            </div>
          )}
        </div>
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
            Fase de grupos
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
            const teams = g.teams.map(c => TEAMS[c]).filter(Boolean);
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
                    const form = computeForm(team.code, resolvedMarkets);
                    return (
                      <div
                        key={team.code}
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
                          <span style={{
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
            Grupo {activeGroup}
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
            onBuy={(idx, label) =>
              setDrawer({ market: groupWinnerByKey[activeGroup], outcomeIndex: idx, label })}
          />
        )}

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {groupMatches.map(f => {
            const home = TEAMS[f.homeCode];
            const away = TEAMS[f.awayCode];
            if (!home || !away) return null;
            const market = matchMarket(f.homeCode, f.awayCode);
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

      {/* ── Bracket ────────────────────────────────────────────── */}
      <section>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          letterSpacing: '0.12em', color: 'var(--text-muted)',
          textTransform: 'uppercase', marginBottom: 12,
        }}>
          Llaves · Eliminatorias
        </div>
        <BracketView />
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

function MatchRow({ fixture, home, away, market, onBuy, onOpen }) {
  const hasMarket = Boolean(market);
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
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--text-primary)' }}>
          {formatDateEs(fixture.kickoffIso)}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
          {fixture.matchday} · {fixture.venue}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {hasMarket ? (
          [0, 1, 2].map(i => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); onBuy(i, market.outcomes?.[i]); }}
              title={market.outcomes?.[i]}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '8px 10px',
                background: accent[i].bg,
                border: `1px solid ${accent[i].border}`,
                borderRadius: 100,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 11,
                color: accent[i].fg, fontWeight: 600, whiteSpace: 'nowrap',
              }}
            >
              {i === 0 ? '1' : i === 1 ? 'X' : '2'}
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 13 }}>
                {pct(i)}%
              </span>
            </button>
          ))
        ) : (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.08em', color: 'var(--text-muted)',
            textTransform: 'uppercase',
          }}>
            Próximamente
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
            🥇 Ganador del grupo
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
          return (
            <button
              key={i}
              onClick={() => onBuy(i, label)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.4)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
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
                color: 'var(--gold, #f59e0b)', minWidth: 36, textAlign: 'right',
              }}>
                {pct}%
              </span>
            </button>
          );
        })}
      </div>
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
function BracketView() {
  const columns = [
    { label: '16vos', slots: BRACKET.r32 },
    { label: '8vos',  slots: BRACKET.r16 },
    { label: 'QF',    slots: BRACKET.qf },
    { label: 'SF',    slots: BRACKET.sf },
    { label: 'Final', slots: [BRACKET.final] },
  ];
  return (
    <div className="wc-bracket">
      {columns.map(col => (
        <div key={col.label}>
          <div className="wc-bracket-col-label">{col.label}</div>
          <div className="wc-bracket-col">
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
