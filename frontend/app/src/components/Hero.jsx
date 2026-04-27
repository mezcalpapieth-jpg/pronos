/**
 * MVP Hero — Turnkey-era on-chain testnet.
 *
 * Chart + carousel ported from the main-branch pronos.io landing
 * (frontend/js/app.js). Each featured market gets:
 *   - a deterministic multi-outcome history, one series per outcome,
 *     smoothed with cubic-bezier paths and normalized so all series
 *     sum to 100 at every time-step
 *   - a gradient fill under the main series
 *   - end-point circle dots
 *   - animated floating "+$amount" trade ticks overlaid on the card
 *
 * Markets come from `/api/points/markets?mode=onchain&featured=true`
 * so the /mvp hero only ever shows on-chain markets. If the endpoint
 * returns nothing (empty testnet), we fall back to a small hand-curated
 * list of demo entries so the hero still animates on first paint.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { useT, useLang } from '../lib/i18n.js';

const TIME_PERIODS = ['1D', '1W', '1M', 'ALL'];
const AUTO_INTERVAL_MS = 7000;
const CHAIN_ID = Number(import.meta.env.VITE_ONCHAIN_CHAIN_ID || 421614);
const TRADE_MIN_MS = 1500;
const TRADE_MAX_MS = 3800;

// Color tokens used by the chart lines, outcome chips, trade ticks.
// Keys match the CSS data-color attributes on .hmc-outcome-btn so
// hovers + backgrounds stay in sync (see components.css).
const HMC_COLORS = {
  green:   '#22c55e',
  red:     '#FF4545',
  navy:    '#4d7fff',
  orange:  '#FF5500',
  skyblue: '#38BDF8',
  gold:    '#F5C842',
};
const COLOR_ROTATION = ['navy', 'orange', 'gold', 'skyblue', 'green', 'red'];
const TRADE_AMOUNTS = [5, 10, 25, 50, 100, 200, 500, 1000, 2500, 5000];

// ── Deterministic RNG so each market renders the same history every
// time (prevents chart jitter across re-renders / carousel jumps).
function seededRng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h, 1597334677);
    h = (h + 1) | 0;
    return ((h >>> 0) / 4294967295);
  };
}

// Random walk from start → end over n steps. Smoothing pulls each
// sample back toward the trend line so values don't diverge.
function hmcGenWalk(start, end, n, noise, smoothing, rand) {
  const pts = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(n - 1, 1);
    const target = start + (end - start) * t;
    const spike = rand() < 0.08 ? (rand() - 0.5) * noise * 3 : 0;
    v = v * smoothing + target * (1 - smoothing) + (rand() - 0.5) * noise + spike;
    pts.push(Math.max(1, Math.min(99, v)));
  }
  return pts;
}

// Normalize each time-step across series so they sum to 100%.
function hmcNormalize(seriesArr) {
  const n = seriesArr[0].length;
  const res = seriesArr.map(s => [...s]);
  for (let i = 0; i < n; i++) {
    const total = res.reduce((sum, s) => sum + s[i], 0);
    res.forEach(s => { s[i] = (s[i] / total) * 100; });
  }
  return res;
}

function hmcBuildHistory(outcomes, days, noiseMult, smoothing, seedStr) {
  const rand = seededRng(seedStr);
  const raw = outcomes.map((o, i) =>
    hmcGenWalk(o.start, o.pct, days, (o.noise || 3) * noiseMult, smoothing, rand),
  );
  return hmcNormalize(raw);
}

// Smooth cubic-bezier path through N points inside an (W, H) box.
function hmcPointsToPath(data, W, H) {
  const n = data.length;
  const PAD = 10;
  const innerH = H - PAD * 2;
  const pts = data.map((v, i) => [
    (i / (n - 1)) * W,
    PAD + innerH - (v / 100) * innerH,
  ]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < n; i++) {
    const cx = (pts[i][0] - pts[i - 1][0]) / 3;
    d += ` C${(pts[i-1][0]+cx).toFixed(1)},${pts[i-1][1].toFixed(1)},`
       + `${(pts[i][0]-cx).toFixed(1)},${pts[i][1].toFixed(1)},`
       + `${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)}`;
  }
  return d;
}

// Fallback list when /api/points/markets returns empty (pre-seed testnet).
const DEMO_MARKETS = [
  {
    id: 'demo-mundial-2026',
    cat: '⚽ Deportes · Mundial 2026',
    question: '¿México gana el partido inaugural del Mundial 2026?',
    volume: '$23,412',
    outcomes: [
      { label: '🇲🇽 México',    color: 'navy',    pct: 62, start: 51, noise: 3.5 },
      { label: 'Empate',         color: 'orange',  pct: 21, start: 27, noise: 2   },
      { label: '🇿🇦 Sudáfrica', color: 'gold',    pct: 17, start: 22, noise: 2   },
    ],
  },
  {
    id: 'demo-sga-mvp',
    cat: '🏀 Deportes · NBA 25-26',
    question: '¿SGA gana el MVP de la NBA 2025-26?',
    volume: '$18,250',
    outcomes: [
      { label: 'Sí', color: 'green', pct: 71, start: 58, noise: 3 },
      { label: 'No', color: 'red',   pct: 29, start: 42, noise: 3 },
    ],
  },
  {
    id: 'demo-btc-150k',
    cat: '₿ Crypto · Dic 2026',
    question: '¿Bitcoin supera $150k USD antes de 2027?',
    volume: '$42,810',
    outcomes: [
      { label: 'Sí', color: 'gold', pct: 38, start: 24, noise: 4.2 },
      { label: 'No', color: 'navy', pct: 62, start: 76, noise: 4.2 },
    ],
  },
];

// Map an API row to the HERO shape. API returns raw reserves-derived
// probabilities; we map them into HMC's start/end/noise shape so the
// same rendering pipeline works.
function apiRowToHeroMarket(m) {
  const options = Array.isArray(m.options) ? m.options : [];
  const outcomes = options.map((opt, i) => {
    const pct = Math.round(Math.max(1, Math.min(99, Number(opt.probability || 0.5) * 100)));
    // If we don't have historical data, fake a small drift from an
    // arbitrary starting point so the line still moves.
    const start = Math.max(1, Math.min(99, pct - 8 + (i * 4)));
    return {
      label: opt.label_es || opt.label,
      color: COLOR_ROTATION[i % COLOR_ROTATION.length],
      pct,
      start,
      noise: 3,
    };
  });
  const volumeLabel = Number.isFinite(Number(m.tradeVolume))
    ? `$${Number(m.tradeVolume).toLocaleString('en-US')}`
    : '—';
  return {
    id: `api-${m.id}`,
    realId: m.id,
    cat: `${m.icon || '📈'} ${(m.category || 'general').toUpperCase()}`,
    question: m.question,
    volume: volumeLabel,
    outcomes,
  };
}

export default function Hero({ onOpenLogin }) {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const { authenticated } = usePointsAuth();

  const [markets, setMarkets] = useState(() => DEMO_MARKETS);
  const [idx, setIdx] = useState(0);
  const [slideDir, setSlideDir] = useState(null);   // 'left' | 'right' | null
  const [period, setPeriod] = useState('1M');
  const [ticks, setTicks] = useState([]);           // floating trade ticks
  const carouselTimerRef = useRef(null);
  const tradeTimerRef = useRef(null);
  const tickIdRef = useRef(0);

  // Load onchain markets. If none exist yet, stay on the curated demo list
  // so the hero animates from first paint (fresh testnet has no markets).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/points/markets?mode=onchain&featured=true&status=active&chain_id=${CHAIN_ID}`,
          { credentials: 'include' },
        );
        if (!res.ok) return;
        const data = await res.json();
        const rows = Array.isArray(data?.markets) ? data.markets : [];
        if (cancelled || rows.length === 0) return;
        setMarkets(rows.slice(0, 5).map(apiRowToHeroMarket));
      } catch { /* keep demos */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Pre-compute per-market histories for all 4 periods. Built off a
  // stable seed (market id + period) so the chart is deterministic.
  const histories = useMemo(() => markets.map(m => ({
    '1D':  hmcBuildHistory(m.outcomes,  48, 1.0, 0.82, `${m.id}-1D`),
    '1W':  hmcBuildHistory(m.outcomes,  70, 2.2, 0.70, `${m.id}-1W`),
    '1M':  hmcBuildHistory(m.outcomes, 120, 4.5, 0.60, `${m.id}-1M`),
    'ALL': hmcBuildHistory(m.outcomes, 200, 8.0, 0.50, `${m.id}-ALL`),
  })), [markets]);

  // Clamp idx when markets length changes (e.g. went from demo → API)
  useEffect(() => {
    if (idx >= markets.length) setIdx(0);
  }, [markets.length, idx]);

  const resetCarousel = useCallback(() => {
    if (carouselTimerRef.current) clearInterval(carouselTimerRef.current);
    if (markets.length < 2) return;
    carouselTimerRef.current = setInterval(() => {
      setIdx(prev => (prev + 1) % markets.length);
      setSlideDir('right');
    }, AUTO_INTERVAL_MS);
  }, [markets.length]);

  useEffect(() => {
    resetCarousel();
    return () => { if (carouselTimerRef.current) clearInterval(carouselTimerRef.current); };
  }, [resetCarousel]);

  // Clear the slide direction after the CSS animation completes so the
  // next slide can re-trigger cleanly.
  useEffect(() => {
    if (!slideDir) return;
    const id = setTimeout(() => setSlideDir(null), 420);
    return () => clearTimeout(id);
  }, [slideDir, idx]);

  // Spawn animated "+$amount" trade ticks across the card. Random
  // intervals + positions so it feels like live order flow. Each tick
  // auto-removes after 2.4s via the cleanup effect below.
  useEffect(() => {
    const m = markets[idx];
    if (!m) return;
    let cancelled = false;

    function schedule() {
      const delay = TRADE_MIN_MS + Math.random() * (TRADE_MAX_MS - TRADE_MIN_MS);
      tradeTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        spawnTick(m);
        schedule();
      }, delay);
    }
    schedule();

    return () => {
      cancelled = true;
      if (tradeTimerRef.current) clearTimeout(tradeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, markets]);

  function spawnTick(m) {
    const oIdx = Math.floor(Math.random() * m.outcomes.length);
    const color = HMC_COLORS[m.outcomes[oIdx].color] || '#22c55e';
    const amount = TRADE_AMOUNTS[Math.floor(Math.random() * TRADE_AMOUNTS.length)];
    const left = 4 + Math.random() * 80;
    const bottom = 10 + Math.random() * 70;
    const id = ++tickIdRef.current;
    setTicks(prev => [...prev, { id, color, amount, left, bottom }]);
    setTimeout(() => {
      setTicks(prev => prev.filter(x => x.id !== id));
    }, 2500);
  }

  const goTo = (i, dir = 'right') => {
    setIdx(i);
    setSlideDir(dir);
    resetCarousel();
  };
  const goPrev = () => goTo((idx - 1 + markets.length) % markets.length, 'left');
  const goNext = () => goTo((idx + 1) % markets.length, 'right');

  const m = markets[idx];
  const ser = histories[idx]?.[period];
  const W = 420, H = 120;

  if (!m || !ser) {
    return (
      <section id="hero">
        <div className="hero-inner">
          <div className="hero-left">
            <div className="hero-badge"><span className="dot" /><span>{t('hero.badge')}</span></div>
            <h1 className="hero-headline">
              {t('hero.headline.line1')}<br />
              {t('hero.headline.line2')}<br />
              <span className="accent">{t('hero.headline.line3')}</span>
            </h1>
            <p className="hero-sub">{t('hero.sub')}</p>
          </div>
        </div>
      </section>
    );
  }

  const mainColor = HMC_COLORS[m.outcomes[0].color] || '#22c55e';

  function handleBet(outcomeIdx) {
    if (!authenticated) { onOpenLogin?.(); return; }
    const realId = m.realId;
    if (!realId) return; // demo markets — no real id to navigate to
    navigate(`/market?id=${realId}&outcome=${outcomeIdx}`);
  }

  return (
    <section id="hero">
      <div className="hero-inner">
        {/* ── Left copy ───────────────────────────── */}
        <div className="hero-left">
          <div className="hero-badge"><span className="dot" /><span>{t('hero.badge')}</span></div>
          <h1 className="hero-headline">
            {t('hero.headline.line1')}<br />
            {t('hero.headline.line2')}<br />
            <span className="accent">{t('hero.headline.line3')}</span>
          </h1>
          <p className="hero-sub">{t('hero.sub')}</p>

          <div className="hero-btns">
            {authenticated ? (
              <a href="#markets" className="btn-primary">{t('hero.cta.viewMarkets')}</a>
            ) : (
              <button className="btn-primary" onClick={onOpenLogin}>{t('hero.cta.start')}</button>
            )}
            <a href="#how-it-works" className="btn-ghost">{t('hero.cta.howItWorks')}</a>
          </div>

          <div className="hero-stats">
            <div className="hero-stat">
              <span className="hero-stat-val"><span className="green">MXNB</span></span>
              <span className="hero-stat-label">colateral on-chain</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-val">{markets.length || '—'}</span>
              <span className="hero-stat-label">{t('hero.stats.activeLabel')}</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-val"><span className="green">≤2.5%</span></span>
              <span className="hero-stat-label">{t('hero.stats.feeLabel')}</span>
            </div>
          </div>
        </div>

        {/* ── Right: Hero Market Card ─────────────── */}
        <div className="hmc" id="heroMarketCard">
          <div
            id="hmcInner"
            className={slideDir === 'right' ? 'slide-right' : slideDir === 'left' ? 'slide-left' : ''}
          >
            {/* Top bar */}
            <div className="hmc-topbar">
              <div className="hmc-cat">
                <div className="hmc-live-dot" />
                <span>{m.cat}</span>
              </div>
              <div className="hmc-timesel">
                {TIME_PERIODS.map(p => (
                  <button
                    key={p}
                    className={`hmc-time-btn${period === p ? ' active' : ''}`}
                    onClick={() => setPeriod(p)}
                    type="button"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Question */}
            <div
              className="hmc-question"
              onClick={() => m.realId && navigate(`/market?id=${m.realId}`)}
              role={m.realId ? 'button' : undefined}
              tabIndex={m.realId ? 0 : undefined}
              style={m.realId ? { cursor: 'pointer' } : undefined}
            >
              {m.question}
            </div>

            {/* Chart */}
            <div className="hmc-chart-wrap">
              <svg
                className="hmc-chart-svg"
                id="hmcChart"
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id={`hmc-g-${idx}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={mainColor} stopOpacity="0.18" />
                    <stop offset="100%" stopColor={mainColor} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* Dashed horizontal guides */}
                {[10, 37, 64, 91].map(y => (
                  <line key={y} x1="0" y1={y} x2={W} y2={y}
                    stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4,4" />
                ))}

                <g>
                  {ser.map((data, si) => {
                    const color = HMC_COLORS[m.outcomes[si].color] || '#8b5cf6';
                    const d = hmcPointsToPath(data, W, H);
                    const dFill = `${d} L${W},${H} L0,${H} Z`;
                    const n = data.length;
                    const PAD = 10;
                    const innerH = H - PAD * 2;
                    const ey = PAD + innerH - (data[n - 1] / 100) * innerH;
                    return (
                      <React.Fragment key={si}>
                        {si === 0 && (
                          <path d={dFill} fill={`url(#hmc-g-${idx})`} stroke="none" />
                        )}
                        <path
                          d={d}
                          fill="none"
                          stroke={color}
                          strokeWidth={si === 0 ? 2 : 1.5}
                          strokeOpacity={si === 0 ? 1 : 0.7}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle
                          cx={W}
                          cy={ey.toFixed(1)}
                          r="3.5"
                          fill={color}
                          stroke="var(--surface1)"
                          strokeWidth="1.5"
                        />
                      </React.Fragment>
                    );
                  })}
                </g>
              </svg>
              <div className="hmc-y-labels">
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>

              {/* Floating trade ticks */}
              <div className="hmc-trade-overlay" id="hmcTradeOverlay">
                {ticks.map(tk => (
                  <div
                    key={tk.id}
                    className="hmc-trade-tick"
                    style={{
                      color: tk.color,
                      left: `${tk.left}%`,
                      bottom: `${tk.bottom}%`,
                      textShadow: `0 0 10px ${tk.color}55`,
                    }}
                  >
                    +${tk.amount.toLocaleString()}
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="hmc-legend">
              {m.outcomes.map((o, si) => {
                const pct = ser[si][ser[si].length - 1].toFixed(0);
                const col = HMC_COLORS[o.color] || '#8b5cf6';
                return (
                  <div key={si} className="hmc-legend-item">
                    <div className="hmc-legend-line" style={{ background: col }} />
                    <span>{o.label}</span>
                    <span className="hmc-legend-pct" style={{ color: col }}>{pct}%</span>
                  </div>
                );
              })}
            </div>

            {/* Outcome buttons */}
            <div className="hmc-outcomes">
              {m.outcomes.map((o, si) => {
                const pct = ser[si][ser[si].length - 1].toFixed(0);
                return (
                  <button
                    key={si}
                    className="hmc-outcome-btn"
                    data-color={o.color}
                    onClick={() => handleBet(si)}
                    type="button"
                  >
                    <span className="hmc-outcome-pct">{pct}%</span>
                    <span className="hmc-outcome-label">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </div>{/* /hmcInner */}

          {/* Footer */}
          <div className="hmc-footer">
            <div className="hmc-volume">VOL <strong>{m.volume} MXNB</strong></div>
            <div className="hmc-carousel-nav">
              <button className="hmc-nav-btn" onClick={goPrev} aria-label="Anterior" type="button">&#8592;</button>
              <div className="hmc-dots" id="hmcDots">
                {markets.map((_, i) => (
                  <div
                    key={i}
                    className={`hmc-dot${i === idx ? ' active' : ''}`}
                    onClick={() => goTo(i, i > idx ? 'right' : 'left')}
                  />
                ))}
              </div>
              <button className="hmc-nav-btn" onClick={goNext} aria-label="Siguiente" type="button">&#8594;</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
