import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useNavigate } from 'react-router-dom';
import MARKETS from '../lib/markets.js';
import { fetchResolutions } from '../lib/resolutions.js';
import { fetchPriceHistory, extractSeries } from '../lib/priceHistory.js';
import { isExpired } from '../lib/deadline.js';
import { useT, useLang, localizedTitle, localizedOptions } from '../lib/i18n.js';
import Sparkline from './Sparkline.jsx';

const OPTION_COLORS = ['var(--yes)', 'var(--red)', 'var(--gold)', '#8b5cf6'];
const AUTO_INTERVAL = 6000; // ms

/* ── Hero ─────────────────────────────────────────────── */
export default function Hero() {
  const t = useT();
  const lang = useLang();
  const { authenticated, login } = usePrivy();
  const navigate = useNavigate();
  const [featured, setFeatured] = useState(() =>
    MARKETS.filter(m => m._source === 'polymarket' && m.trending && !m._resolved && !isExpired(m))
  );
  const [active, setActive] = useState(0);
  const [history, setHistory] = useState({});
  const timerRef = useRef(null);

  // Load resolutions and filter out resolved markets
  useEffect(() => {
    fetchResolutions().then(resolutions => {
      const resolvedIds = new Set(resolutions.map(r => r.market_id));
      const filtered = MARKETS.filter(m =>
        m._source === 'polymarket' && m.trending && !m._resolved && !resolvedIds.has(m.id) && !isExpired(m)
      );
      if (filtered.length > 0) setFeatured(filtered);
    }).catch(() => {});
  }, []);

  // Batch-fetch real CLOB price history for every featured market's clobTokenIds.
  // We also use the *last* point of each token's series as the live probability
  // and patch it back into featured[i].options[j].pct so the colored odds row
  // under each Sparkline reflects current depth instead of the stale value
  // baked in at hardcoded-markets time.
  useEffect(() => {
    let cancelled = false;
    const ids = [];
    for (const m of featured) {
      if (Array.isArray(m?._clobTokenIds)) ids.push(...m._clobTokenIds.filter(Boolean));
    }
    if (ids.length === 0) return;
    fetchPriceHistory(Array.from(new Set(ids)), { interval: '1w', fidelity: 60 })
      .then(hist => {
        if (cancelled) return;
        setHistory(hist);

        // Refresh per-option pct from latest series point. Only re-set the
        // featured array if at least one number actually changed, to avoid a
        // useless render loop.
        let changed = false;
        const updated = featured.map(m => {
          const tokenIds = m?._clobTokenIds;
          if (!Array.isArray(tokenIds) || !Array.isArray(m.options)) return m;
          const newOptions = m.options.map((opt, i) => {
            const tid = tokenIds[i];
            const pts = tid && hist[tid];
            if (!Array.isArray(pts) || pts.length === 0) return opt;
            const last = pts[pts.length - 1];
            const livePct = Math.round(Number(last.p));
            if (!Number.isFinite(livePct) || livePct === opt.pct) return opt;
            changed = true;
            return { ...opt, pct: livePct };
          });
          return changed ? { ...m, options: newOptions } : m;
        });
        if (changed) setFeatured(updated);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [featured]);

  // Auto-rotate
  const resetTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActive(prev => (prev + 1) % featured.length);
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
  const goPrev = () => goTo((active - 1 + featured.length) % featured.length);
  const goNext = () => goTo((active + 1) % featured.length);

  const market = featured[active] || featured[0];
  if (!market) return null;

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
              <button className="btn-primary" onClick={login}>{t('hero.cta.start')}</button>
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
              <span className="hero-stat-val"><span className="green">2%</span></span>
              <span className="hero-stat-label">{t('hero.stats.feeLabel')}</span>
            </div>
          </div>
        </div>

        {/* ── Right: single featured card with nav ───── */}
        <div className="hero-right">
          {/* Navigation header */}
          <div className="hero-carousel-nav">
            <button className="hero-nav-btn" onClick={goPrev} aria-label="Anterior">&#8249;</button>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
              {t('hero.featured')}
            </span>
            <button className="hero-nav-btn" onClick={goNext} aria-label="Siguiente">&#8250;</button>
          </div>

          {/* Single card */}
          <div
            className="hero-featured-card"
            onClick={() => navigate(`/market?id=${market.id}`)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && navigate(`/market?id=${market.id}`)}
          >
            {/* Header */}
            <div className="hfc-header">
              <span className="hfc-cat">{market.icon} {market.categoryLabel}</span>
              <span className="hfc-live">{t('hero.live')}</span>
            </div>

            {/* Title */}
            <p className="hfc-title">{localizedTitle(market, lang)}</p>

            {/* Chart(s) — single for yes/no, multi for 3+ options */}
            <div className="hfc-chart">
              {(market.options || []).length <= 2 ? (
                <Sparkline
                  height={90}
                  color="var(--yes)"
                  strokeWidth={2.2}
                  fill={true}
                  showValue={true}
                  valueWidth={50}
                  data={extractSeries(market, history, 0)}
                  targetPct={market.options[0]?.pct ?? 50}
                  seed={`${market.id}-${market.options[0]?.label}`}
                />
              ) : (
                localizedOptions(market, lang).map((opt, i) => (
                  <Sparkline
                    key={i}
                    height={32}
                    color={OPTION_COLORS[i] || 'var(--text-muted)'}
                    strokeWidth={1.8}
                    fill={i === 0}
                    label={opt.label.length > 9 ? opt.label.slice(0, 8) + '…' : opt.label}
                    labelWidth={60}
                    showValue={true}
                    valueWidth={42}
                    data={extractSeries(market, history, i)}
                    targetPct={opt.pct}
                    seed={`${market.id}-${opt.label}`}
                  />
                ))
              )}
            </div>

            {/* Odds */}
            <div className="hfc-odds">
              {localizedOptions(market, lang).map((opt, i) => (
                <div key={i} className={`hfc-odd ${i === 0 ? 'yes' : i === 1 ? 'no' : ''}`}>
                  <span className="hfc-odd-label">{opt.label}</span>
                  <span className="hfc-odd-val">{opt.pct}%</span>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="hfc-footer">
              <span>VOL <strong>${market.volume}</strong></span>
              <span>{market.deadline}</span>
            </div>
          </div>

          {/* Dot indicators */}
          {featured.length > 1 && (
            <div className="hero-dots">
              {featured.map((_, i) => (
                <button
                  key={i}
                  className={`hero-dot${i === active ? ' active' : ''}`}
                  onClick={() => goTo(i)}
                  aria-label={`Mercado ${i + 1}`}
                />
              ))}
            </div>
          )}

          {/* Progress bar */}
          <div className="hero-progress">
            <div className="hero-progress-bar" key={active} />
          </div>
        </div>

      </div>
    </section>
  );
}
