import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useNavigate } from 'react-router-dom';
import MARKETS from '../lib/markets.js';
import { fetchResolutions } from '../lib/resolutions.js';
import Sparkline from './Sparkline.jsx';

const OPTION_COLORS = ['var(--yes)', 'var(--red)', 'var(--gold)', '#8b5cf6'];
const AUTO_INTERVAL = 6000; // ms

/* ── Hero ─────────────────────────────────────────────── */
export default function Hero() {
  const { authenticated, login } = usePrivy();
  const navigate = useNavigate();
  const [featured, setFeatured] = useState(() =>
    MARKETS.filter(m => m._source === 'polymarket' && m.trending && !m._resolved)
  );
  const [active, setActive] = useState(0);
  const timerRef = useRef(null);

  // Load resolutions and filter out resolved markets
  useEffect(() => {
    fetchResolutions().then(resolutions => {
      const resolvedIds = new Set(resolutions.map(r => r.market_id));
      const filtered = MARKETS.filter(m =>
        m._source === 'polymarket' && m.trending && !m._resolved && !resolvedIds.has(m.id)
      );
      if (filtered.length > 0) setFeatured(filtered);
    }).catch(() => {});
  }, []);

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
            <span>Beta · Powered by Polymarket</span>
          </div>

          <h1 className="hero-headline">
            El primer mercado<br />
            de predicciones<br />
            <span className="accent">on-chain</span>
          </h1>

          <p className="hero-sub">
            Predice eventos de política, deportes, cultura y crypto en Latinoamérica.
            Gana MXNB cuando aciertas. Sin intermediarios. Sin MetaMask.
          </p>

          <div className="hero-btns">
            {authenticated ? (
              <a href="#markets" className="btn-primary">Ver Mercados</a>
            ) : (
              <button className="btn-primary" onClick={login}>Empezar a Predecir</button>
            )}
            <a href="#how-it-works" className="btn-ghost">Cómo funciona</a>
          </div>

          <div className="hero-stats">
            <div className="hero-stat">
              <span className="hero-stat-val"><span className="green">$1.2B+</span></span>
              <span className="hero-stat-label">volumen Polymarket</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-val">60+</span>
              <span className="hero-stat-label">mercados activos</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-val"><span className="green">2%</span></span>
              <span className="hero-stat-label">comisión · sin gas</span>
            </div>
          </div>
        </div>

        {/* ── Right: single featured card with nav ───── */}
        <div className="hero-right">
          {/* Navigation header */}
          <div className="hero-carousel-nav">
            <button className="hero-nav-btn" onClick={goPrev} aria-label="Anterior">&#8249;</button>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
              DESTACADOS
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
              <span className="hfc-live">LIVE</span>
            </div>

            {/* Title */}
            <p className="hfc-title">{market.title}</p>

            {/* Charts — one per option */}
            <div className="hfc-chart">
              {(market.options || []).map((opt, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9, width: 40, textAlign: 'right',
                    color: OPTION_COLORS[i] || 'var(--text-muted)', flexShrink: 0
                  }}>
                    {opt.label.length > 8 ? opt.label.slice(0, 7) + '…' : opt.label}
                  </span>
                  <Sparkline
                    width={200}
                    height={market.options.length > 2 ? 28 : 40}
                    color={OPTION_COLORS[i] || 'var(--text-muted)'}
                    strokeWidth={1.5}
                    fill={i === 0}
                    targetPct={opt.pct}
                    seed={`${market.id}-${opt.label}`}
                  />
                </div>
              ))}
            </div>

            {/* Odds */}
            <div className="hfc-odds">
              {(market.options || []).map((opt, i) => (
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
