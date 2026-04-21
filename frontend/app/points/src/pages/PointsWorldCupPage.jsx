/**
 * World Cup 2026 — dedicated category page at /c/world-cup.
 *
 * Hero with a countdown to the opening match, a 12-group selector,
 * a group-stage matches grid that doubles as the trade surface, and
 * a brackets preview for the knockout rounds (teams TBD until groups
 * complete).
 *
 * Sources markets from /api/points/markets?category=world-cup and
 * joins each match against the static 2026 fixture list so we can
 * show every scheduled game (including ones where no market exists
 * yet) with real flags / venue / date / matchday.
 *
 * Visual design: bold gradient hero with the WC trophy emoji as the
 * center anchor, country flags in group cards, and a CSS-grid
 * bracket tree below. Deliberately over-the-top per the product
 * brief ("go all out").
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@app/lib/i18n.js';
import {
  GROUPS,
  GROUP_FIXTURES,
  TEAMS,
  BRACKET,
  OPENING_KICKOFF_ISO,
} from '../lib/worldCup.js';
import { fetchMarkets } from '../lib/pointsApi.js';
import PointsBuyModal from '../components/PointsBuyModal.jsx';

// flagcdn URL shorthand. Used for flag badges across the page.
const flag = (code) => `https://flagcdn.com/w160/${code}.png`;

// Countdown to the opening match. Polls once per second while the
// hero is mounted so the number ticks down in real time.
function useCountdown(targetIso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const targetMs = new Date(targetIso).getTime();
  const deltaSec = Math.max(0, Math.floor((targetMs - now) / 1000));
  const days  = Math.floor(deltaSec / 86400);
  const hours = Math.floor((deltaSec % 86400) / 3600);
  const mins  = Math.floor((deltaSec % 3600) / 60);
  const secs  = deltaSec % 60;
  return { done: deltaSec === 0, days, hours, mins, secs };
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatDateEs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

// The tri-color gradient is a nod to the three host flags: Mexico
// (green), Canada (red), USA (blue). Anchoring it on a dark base
// keeps the UI legible in both themes.
const HERO_GRADIENT =
  'linear-gradient(130deg, rgba(22,163,74,0.25) 0%, rgba(220,38,38,0.22) 45%, rgba(59,130,246,0.28) 100%), var(--surface1)';

export default function PointsWorldCupPage() {
  const navigate = useNavigate();
  const t = useT();
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState('A');
  const [drawer, setDrawer] = useState(null); // { market, outcomeIndex, label }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMarkets({ status: 'active', category: 'world-cup', limit: 2000 })
      .then(m => { if (!cancelled) { setMarkets(m); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Map matchId → market for O(1) lookup. matchId lives on the
  // generator's source_data so we inspect the question + a unique
  // naming shape. But since /api/points/markets doesn't expose
  // source_data, we match on (question, category) instead: every WC
  // fixture is "Home vs Away" inside category=world-cup, which is
  // unique enough for this grid.
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

  const countdown = useCountdown(OPENING_KICKOFF_ISO);
  const groupMatches = GROUP_FIXTURES.filter(f => f.group === activeGroup);

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 80px' }}>
      {/* ── Hero banner ─────────────────────────────────────────── */}
      <section style={{
        borderRadius: 18,
        padding: '36px 32px',
        marginBottom: 28,
        background: HERO_GRADIENT,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Decorative flag ribbon in the background. Large, muted,
            doesn't steal focus from the text. */}
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
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.18em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            marginBottom: 10,
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
            fontFamily: 'var(--font-body)',
            fontSize: 16,
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
            margin: '0 0 22px',
            maxWidth: 560,
          }}>
            48 selecciones. 12 grupos. 104 partidos. Arranca el <strong style={{ color: 'var(--text-primary)' }}>11 de junio</strong> en el Azteca y termina el 19 de julio en MetLife. Todos los mercados en un solo lugar.
          </p>

          {/* Countdown */}
          {!countdown.done && (
            <div style={{
              display: 'inline-flex',
              gap: 8,
              padding: '10px 14px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
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
                    fontFamily: 'var(--font-display)',
                    fontSize: 22,
                    color: 'var(--green)',
                    minWidth: 28,
                    textAlign: 'right',
                  }}>
                    {pad(x.v)}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.1em' }}>
                    {x.l}
                  </span>
                </span>
              ))}
            </div>
          )}
          {countdown.done && (
            <div style={{
              display: 'inline-block',
              padding: '10px 14px',
              background: 'rgba(220,38,38,0.18)',
              border: '1px solid rgba(220,38,38,0.4)',
              borderRadius: 12,
              color: '#dc2626',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              animation: 'pronos-live-pulse 1.4s ease-in-out infinite',
            }}>
              🔴 EN VIVO · El Mundial ha comenzado
            </div>
          )}
        </div>
      </section>

      {/* ── Group selector grid ─────────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.12em',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          marginBottom: 12,
        }}>
          Fase de grupos
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 10,
        }}>
          {GROUPS.map(g => {
            const active = activeGroup === g.key;
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
                  transition: 'transform 0.12s, border-color 0.12s',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 16,
                  color: active ? 'var(--green)' : 'var(--text-primary)',
                  letterSpacing: '0.04em',
                  marginBottom: 8,
                }}>
                  Grupo {g.key}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {g.teams.map(code => {
                    const team = TEAMS[code];
                    if (!team) return null;
                    return (
                      <img
                        key={code}
                        src={flag(team.code)}
                        alt={team.name}
                        title={team.name}
                        style={{
                          width: 22,
                          height: 16,
                          objectFit: 'cover',
                          borderRadius: 2,
                          border: '1px solid var(--border)',
                        }}
                      />
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Active group's matches ──────────────────────────────── */}
      <section style={{ marginBottom: 40 }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 24,
            color: 'var(--text-primary)',
            margin: 0,
          }}>
            Grupo {activeGroup}
          </h2>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            color: 'var(--text-muted)',
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

        <div style={{ display: 'grid', gap: 10 }}>
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

      {/* ── Bracket tree ────────────────────────────────────────── */}
      <section>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.12em',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          marginBottom: 12,
        }}>
          Llaves · Eliminatorias
        </div>
        <BracketView />
      </section>

      {/* Shared buy drawer */}
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
      {/* Date column */}
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--text-primary)' }}>
          {formatDateEs(fixture.kickoffIso)}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
          {fixture.matchday} · {fixture.venue}
        </div>
      </div>

      {/* Teams */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[home, away].map((team, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={`https://flagcdn.com/w80/${team.code}.png`} alt=""
              style={{ width: 28, height: 20, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
            <span style={{
              flex: 1,
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {team.name}
            </span>
          </div>
        ))}
      </div>

      {/* Buy pills — three outcomes stacked. Clicking an individual
          pill stops propagation so the row's navigate doesn't fire. */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {hasMarket ? (
          [0, 1, 2].map(i => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); onBuy(i, market.outcomes?.[i]); }}
              disabled={!hasMarket}
              title={market.outcomes?.[i]}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '8px 10px',
                background: accent[i].bg,
                border: `1px solid ${accent[i].border}`,
                borderRadius: 100,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: accent[i].fg,
                fontWeight: 600,
                whiteSpace: 'nowrap',
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
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
          }}>
            Próximamente
          </span>
        )}
      </div>
    </div>
  );
}

// ── Bracket tree ──────────────────────────────────────────────────────────
function BracketView() {
  const columns = [
    { label: '16vos', slots: BRACKET.r32,  height: 26 },
    { label: '8vos',  slots: BRACKET.r16,  height: 56 },
    { label: 'QF',    slots: BRACKET.qf,   height: 116 },
    { label: 'SF',    slots: BRACKET.sf,   height: 236 },
    { label: 'Final', slots: [BRACKET.final], height: 0 },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${columns.length}, minmax(140px, 1fr))`,
      gap: 16,
      overflowX: 'auto',
      paddingBottom: 10,
    }}>
      {columns.map(col => (
        <div key={col.label}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            marginBottom: 10,
            textAlign: 'center',
          }}>
            {col.label}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: col.height > 0 ? col.height : 0 }}>
            {col.slots.map(slot => (
              <div key={slot.id} style={{
                background: 'var(--surface1)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.04em',
                color: 'var(--text-secondary)',
                textAlign: 'center',
                minHeight: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 2,
              }}>
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
