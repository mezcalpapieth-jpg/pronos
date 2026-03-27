import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { useNavigate } from 'react-router-dom';
import MARKETS from '../lib/markets.js';

// Only featured real Polymarket markets in the carousel
const FEATURED = MARKETS.filter(m => m._source === 'polymarket' && m.trending);

export default function Hero() {
  const { authenticated, login } = usePrivy();
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [animating, setAnimating] = useState(false);
  const timerRef = useRef(null);

  const goTo = (idx) => {
    if (idx === current || animating) return;
    setAnimating(true);
    setTimeout(() => {
      setCurrent(idx);
      setAnimating(false);
    }, 180);
  };

  const startTimer = () => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setAnimating(true);
      setTimeout(() => {
        setCurrent(c => (c + 1) % FEATURED.length);
        setAnimating(false);
      }, 180);
    }, 3800);
  };

  useEffect(() => {
    startTimer();
    return () => clearInterval(timerRef.current);
  }, []);

  const market = FEATURED[current] || FEATURED[0];

  const handleCardClick = () => navigate(`/market?id=${market.id}`);

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
            Gana USDC cuando aciertas. Sin intermediarios. Sin MetaMask.
          </p>

          <div className="hero-btns">
            {authenticated ? (
              <Link to="/#markets" className="btn-primary">Ver Mercados</Link>
            ) : (
              <button className="btn-primary" onClick={login}>Empezar a Predecir</button>
            )}
            <Link to="/#how-it-works" className="btn-ghost">Cómo funciona</Link>
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
              <span className="hero-stat-val"><span className="green">24/7</span></span>
              <span className="hero-stat-label">liquidez en vivo</span>
            </div>
          </div>
        </div>

        {/* ── Right: live market carousel ───────────── */}
        <div className="hero-right">
          <div
            className={`hero-carousel-card${animating ? ' hero-carousel-card--fade' : ''}`}
            onClick={handleCardClick}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && handleCardClick()}
          >
            {/* Header */}
            <div className="hero-carousel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: 'var(--green)', display: 'inline-block',
                    boxShadow: '0 0 8px var(--green)',
                    animation: 'pulse-dot 1.4s ease-in-out infinite',
                  }}
                />
                <span className="hero-carousel-cat">
                  {market.icon}&nbsp;{market.categoryLabel}
                </span>
              </div>
              <span className="hero-carousel-badge">LIVE · POLYMARKET</span>
            </div>

            {/* Question */}
            <p className="hero-carousel-title">{market.title}</p>

            {/* Odds buttons */}
            <div className="wc-odds-three">
              {(market.options || []).map((opt, i) => (
                <button
                  key={i}
                  className={`wc-odds-btn${i === 0 ? ' yes' : ''}`}
                  onClick={e => { e.stopPropagation(); handleCardClick(); }}
                >
                  <span className="wc-odds-label">{opt.label}</span>
                  <span className={`wc-odds-val${i === 0 ? ' green' : ''}`}>{opt.pct}%</span>
                </button>
              ))}
            </div>

            {/* Footer: volume + deadline + dots */}
            <div className="hero-carousel-footer">
              <div style={{ display: 'flex', gap: 16 }}>
                <span className="wc-vol">VOL&nbsp;<strong style={{ color: 'var(--green)' }}>${market.volume}</strong></span>
                <span className="wc-vol">{market.deadline}</span>
              </div>

              {/* Dot indicators */}
              <div className="hero-carousel-dots">
                {FEATURED.map((_, i) => (
                  <button
                    key={i}
                    className={`carousel-dot${i === current ? ' active' : ''}`}
                    onClick={e => { e.stopPropagation(); goTo(i); startTimer(); }}
                    aria-label={`Mercado ${i + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* Progress bar */}
            <div className="hero-carousel-progress">
              <div
                key={current}
                className="hero-carousel-progress-bar"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
