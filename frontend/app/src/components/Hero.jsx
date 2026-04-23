/**
 * MVP Hero — Turnkey-era on-chain testnet.
 *
 * Layout matches the legacy main-branch pronos.io landing:
 *   - Left:  badge + headline + sub + CTA buttons + stats row
 *   - Right: Hero Market Card (`.hmc`) with category tag + time selector,
 *            market question, SVG price chart with y-axis labels, legend,
 *            outcome bet buttons, footer with volume + carousel nav.
 *
 * Data source priority:
 *   1. /api/points/markets?featured=true — real markets seeded by admin
 *   2. MARKETS static list filtered by `trending` — fallback for first paint
 *      and for routes where no markets exist yet.
 *
 * The time selector (1D/1W/1M/ALL) is a visual control for now; wire to
 * real price history once the trade indexer backfills enough points.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePointsAuth } from '../lib/pointsAuth.js';
import MARKETS from '../lib/markets.js';
import { useT, useLang, localizedTitle, localizedOptions } from '../lib/i18n.js';

const OPTION_COLORS = ['var(--yes)', 'var(--red)', 'var(--gold)', '#8b5cf6'];
const AUTO_INTERVAL = 6000; // ms — carousel rotation
const TIME_PERIODS = ['1D', '1W', '1M', 'ALL'];

// Build a simple synthetic series (ramping to the target pct) so the SVG
// renders something reasonable before we backfill real history. Deterministic
// per market id so the chart doesn't flicker on re-render.
function synthSeries(seed, targetPct, points = 40) {
  const out = [];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const rand = () => { h = (h * 1103515245 + 12345) & 0x7fffffff; return (h / 0x7fffffff); };
  let cur = 50;
  for (let i = 0; i < points; i++) {
    const pull = (targetPct - cur) * 0.08;
    const noise = (rand() - 0.5) * 6;
    cur = Math.max(2, Math.min(98, cur + pull + noise));
    out.push(cur);
  }
  // Snap the final point to the target so the right edge matches the badge.
  out[points - 1] = targetPct;
  return out;
}

function pointsToPath(pts, w, h) {
  if (!pts || pts.length === 0) return '';
  const step = w / (pts.length - 1 || 1);
  return pts.map((p, i) => {
    const x = i * step;
    const y = h - (p / 100) * h;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function isExpired(m) {
  if (!m?.deadline && !m?.endTime) return false;
  const when = m.endTime ? new Date(m.endTime) : Date.parse(m.deadline);
  if (!Number.isFinite(when.valueOf ? when.valueOf() : when)) return false;
  const ts = typeof when === 'number' ? when : when.valueOf();
  return ts < Date.now();
}

export default function Hero({ onOpenLogin }) {
  const t = useT();
  const lang = useLang();
  const { authenticated } = usePointsAuth();
  const navigate = useNavigate();
  const [featured, setFeatured] = useState([]);
  const [active, setActive] = useState(0);
  const [period, setPeriod] = useState('1M');
  const timerRef = useRef(null);

  // Load featured markets: try the real API first, fall back to static list.
  // The API returns { markets: [...] } where each row has question/options/etc.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/points/markets?featured=true&status=active', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const rows = Array.isArray(data?.markets) ? data.markets : [];
          const mapped = rows
            .filter(m => Array.isArray(m.options) && m.options.length >= 2)
            .map(m => ({
              id: `pts-${m.id}`,
              realId: m.id,
              category: m.category || 'general',
              categoryLabel: (m.category || 'General').toUpperCase(),
              icon: m.icon || '📈',
              title: m.question,
              title_en: m.question_en || m.question,
              options: m.options.map(o => ({ label: o.label, pct: Math.round(Number(o.probability || 0.5) * 100) })),
              options_en: m.options.map(o => ({ label: o.label_en || o.label })),
              volume: m.tradeVolume ? `$${Number(m.tradeVolume).toLocaleString('en-US')}` : '—',
              deadline: m.endTime ? new Date(m.endTime).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
              endTime: m.endTime,
              onchain: m.mode === 'onchain',
            }));
          if (!cancelled && mapped.length > 0) {
            setFeatured(mapped);
            return;
          }
        }
      } catch { /* fall through to static */ }

      if (cancelled) return;
      const fallback = MARKETS.filter(m => m.trending && !isExpired(m));
      setFeatured(fallback);
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-rotate
  const resetTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActive(prev => (prev + 1) % Math.max(featured.length, 1));
    }, AUTO_INTERVAL);
  }, [featured.length]);

  useEffect(() => {
    if (featured.length < 2) return;
    resetTimer();
    return () => clearInterval(timerRef.current);
  }, [featured.length, resetTimer]);

  const goTo = (idx) => {
    setActive(idx);
    resetTimer();
  };
  const goPrev = () => goTo((active - 1 + Math.max(featured.length, 1)) % Math.max(featured.length, 1));
  const goNext = () => goTo((active + 1) % Math.max(featured.length, 1));

  const market = featured[active] || featured[0];
  if (!market) {
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

  const options = localizedOptions(market, lang);

  // Chart dimensions — match the main-branch viewBox so the CSS styling
  // in sections.css (.hmc-chart-svg, .hmc-y-labels) doesn't need tweaking.
  const CHART_W = 420;
  const CHART_H = 120;

  function handleBet(outcomeIdx) {
    // On testnet, route to the market detail page with the chosen outcome
    // preselected. BetModal on that page will call /api/points/buy against
    // the on-chain-mode market. Unauthenticated users get bounced through
    // the login flow first.
    if (!authenticated) { onOpenLogin?.(); return; }
    const target = market.realId
      ? `/market?id=${market.realId}&outcome=${outcomeIdx}`
      : `/market?id=${market.id}&outcome=${outcomeIdx}`;
    navigate(target);
  }

  return (
    <section id="hero">
      <div className="hero-inner">
        {/* ── Left copy ─────────────────────────────── */}
        <div className="hero-left">
          <div className="hero-badge">
            <span className="dot" />
            <span>{t('hero.badge')}</span>
          </div>

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
              <span className="hero-stat-val"><span className="green">$1.2B+</span></span>
              <span className="hero-stat-label">{t('hero.stats.volumeLabel')}</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-val">60+</span>
              <span className="hero-stat-label">{t('hero.stats.activeLabel')}</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-val"><span className="green">≤2.5%</span></span>
              <span className="hero-stat-label">{t('hero.stats.feeLabel')}</span>
            </div>
          </div>
        </div>

        {/* ── Right: hmc hero market card (main-branch style) ───── */}
        <div className="hmc" id="heroMarketCard">
          <div id="hmcInner">
            {/* Top bar: category + time period selector */}
            <div className="hmc-topbar">
              <div className="hmc-cat">
                <div className="hmc-live-dot" />
                <span>{market.icon} {market.categoryLabel}</span>
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

            {/* Market question */}
            <div
              className="hmc-question"
              onClick={() => navigate(`/market?id=${market.realId || market.id}`)}
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onKeyDown={e => e.key === 'Enter' && navigate(`/market?id=${market.realId || market.id}`)}
            >
              {localizedTitle(market, lang)}
            </div>

            {/* Price history chart + y-axis labels */}
            <div className="hmc-chart-wrap">
              <svg className="hmc-chart-svg" viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none">
                <defs>
                  {options.slice(0, 4).map((_, i) => (
                    <linearGradient key={i} id={`hmc-grad-${i}`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor={OPTION_COLORS[i] || '#8b5cf6'} stopOpacity="0.35" />
                      <stop offset="100%" stopColor={OPTION_COLORS[i] || '#8b5cf6'} stopOpacity="0" />
                    </linearGradient>
                  ))}
                </defs>
                {/* Dashed horizontal guides */}
                {[10, 37, 64, 91].map(y => (
                  <line key={y} x1="0" y1={y} x2={CHART_W} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4,4" />
                ))}
                {/* One path per outcome */}
                {options.slice(0, 4).map((opt, i) => {
                  const pts = synthSeries(`${market.id}-${opt.label}-${period}`, opt.pct);
                  const d = pointsToPath(pts, CHART_W, CHART_H);
                  const dFill = `${d} L${CHART_W},${CHART_H} L0,${CHART_H} Z`;
                  return (
                    <g key={i}>
                      {i === 0 && <path d={dFill} fill={`url(#hmc-grad-${i})`} />}
                      <path d={d} fill="none" stroke={OPTION_COLORS[i] || '#8b5cf6'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                  );
                })}
              </svg>
              <div className="hmc-y-labels">
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>
            </div>

            {/* Legend — one chip per outcome */}
            <div className="hmc-legend">
              {options.slice(0, 4).map((opt, i) => (
                <div key={i} className="hmc-legend-item">
                  <span className="hmc-legend-dot" style={{ background: OPTION_COLORS[i] || '#8b5cf6' }} />
                  <span className="hmc-legend-label">{opt.label}</span>
                  <span className="hmc-legend-pct">{opt.pct}%</span>
                </div>
              ))}
            </div>

            {/* Outcome bet buttons — one row per outcome */}
            <div className="hmc-outcomes">
              {options.slice(0, 4).map((opt, i) => (
                <button
                  key={i}
                  className="hmc-outcome-btn"
                  onClick={() => handleBet(i)}
                  type="button"
                  style={{ borderColor: OPTION_COLORS[i] || 'var(--border)' }}
                >
                  <span className="hmc-outcome-label">{opt.label}</span>
                  <span className="hmc-outcome-pct" style={{ color: OPTION_COLORS[i] || 'var(--text-primary)' }}>{opt.pct}¢</span>
                </button>
              ))}
            </div>
          </div>

          {/* Footer: volume + carousel nav (fixed, outside sliding inner) */}
          <div className="hmc-footer">
            <div className="hmc-volume">VOL <strong>{market.volume}</strong></div>
            <div className="hmc-carousel-nav">
              <button className="hmc-nav-btn" onClick={goPrev} aria-label="Anterior" type="button">&#8592;</button>
              <div className="hmc-dots">
                {featured.map((_, i) => (
                  <button
                    key={i}
                    className={`hmc-dot${i === active ? ' active' : ''}`}
                    onClick={() => goTo(i)}
                    aria-label={`Mercado ${i + 1}`}
                    type="button"
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
