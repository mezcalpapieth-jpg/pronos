import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useNavigate } from 'react-router-dom';
import MARKETS from '../lib/markets.js';

const FEATURED = MARKETS.filter(m => m._source === 'polymarket' && m.trending);
const AMOUNTS   = [1, 2, 3, 5, 8, 10, 15, 20, 25, 50, 64, 100, 200, 500];

/* ── Inject keyframe once ─────────────────────────────── */
const STYLE_ID = 'trade-tick-kf';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes trade-tick {
      0%   { opacity: 0;   transform: translateX(-50%) translateY(0px)   scale(0.75); }
      12%  { opacity: 1;   transform: translateX(-50%) translateY(-8px)  scale(1.05); }
      65%  { opacity: 0.85;transform: translateX(-50%) translateY(-34px) scale(1);    }
      100% { opacity: 0;   transform: translateX(-50%) translateY(-56px) scale(0.9);  }
    }
  `;
  document.head.appendChild(s);
}

/* ── Live trade overlay ───────────────────────────────── */
function LiveTrades() {
  const [ticks, setTicks] = useState([]);
  const idRef = useRef(0);

  useEffect(() => {
    let alive = true;

    const spawn = () => {
      if (!alive) return;
      const isYes  = Math.random() > 0.45;
      const amount = AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)];
      const left   = 10 + Math.random() * 80;   // % across card width
      const bottom = 12 + Math.random() * 55;   // % up from bottom of card
      const id     = ++idRef.current;

      setTicks(prev => [...prev.slice(-16), { id, isYes, amount, left, bottom }]);
      setTimeout(() => setTicks(prev => prev.filter(t => t.id !== id)), 2700);
    };

    // stagger 5 initial ticks
    [0, 250, 500, 750, 1050].forEach(d => setTimeout(spawn, d));

    const iv = setInterval(spawn, 480);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      pointerEvents: 'none', zIndex: 20,
      overflow: 'hidden', borderRadius: 16,
    }}>
      {ticks.map(t => (
        <span
          key={t.id}
          style={{
            position: 'absolute',
            left: `${t.left}%`,
            bottom: `${t.bottom}%`,
            transform: 'translateX(-50%)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: '12px',
            lineHeight: 1,
            color: t.isYes ? 'var(--yes)' : 'var(--red)',
            textShadow: t.isYes
              ? '0 0 12px rgba(22,163,74,0.6)'
              : '0 0 12px rgba(212,32,32,0.6)',
            animation: 'trade-tick 2.5s ease-out forwards',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          +${t.amount}
        </span>
      ))}
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────────── */
export default function Hero() {
  const { authenticated, login } = usePrivy();
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [animating, setAnimating] = useState(false);
  const timerRef = useRef(null);

  const goTo = (idx) => {
    if (idx === current || animating) return;
    setAnimating(true);
    setTimeout(() => { setCurrent(idx); setAnimating(false); }, 180);
  };

  const startTimer = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setAnimating(true);
      setTimeout(() => {
        setCurrent(c => (c + 1) % FEATURED.length);
        setAnimating(false);
      }, 180);
    }, 5000);
  }, []);

  useEffect(() => {
    startTimer();
    return () => clearInterval(timerRef.current);
  }, [startTimer]);

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

        {/* ── Right: live market carousel ───────────── */}
        <div className="hero-right">
          <div
            className={`hero-carousel-card${animating ? ' hero-carousel-card--fade' : ''}`}
            onClick={handleCardClick}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && handleCardClick()}
          >
            <LiveTrades />

            {/* Header */}
            <div className="hero-carousel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--green)', display: 'inline-block',
                  boxShadow: '0 0 8px var(--green)',
                  animation: 'pulse-dot 1.4s ease-in-out infinite',
                }} />
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
                  className={`wc-odds-btn${i === 0 ? ' yes' : ' no'}`}
                  onClick={e => { e.stopPropagation(); handleCardClick(); }}
                >
                  <span className="wc-odds-label">{opt.label}</span>
                  <span className={`wc-odds-val${i === 0 ? ' yes-val' : ' no-val'}`}>
                    {opt.pct}%
                  </span>
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="hero-carousel-footer">
              <div style={{ display: 'flex', gap: 16 }}>
                <span className="wc-vol">
                  VOL&nbsp;<strong style={{ color: 'var(--green)' }}>${market.volume}</strong>
                </span>
                <span className="wc-vol">{market.deadline}</span>
              </div>
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
              <div key={current} className="hero-carousel-progress-bar" />
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
