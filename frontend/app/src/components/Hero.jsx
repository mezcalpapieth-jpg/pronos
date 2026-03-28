import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useNavigate } from 'react-router-dom';
import MARKETS from '../lib/markets.js';

const FEATURED = MARKETS.filter(m => m._source === 'polymarket' && m.trending);

/* ── Live trade ticker amounts ───────────────────────── */
const AMOUNTS = [1, 2, 3, 5, 8, 10, 15, 20, 25, 50, 64, 100, 200, 500];

function LiveTrades() {
  const [ticks, setTicks] = useState([]);
  const idRef = useRef(0);

  useEffect(() => {
    const spawn = () => {
      const isYes  = Math.random() > 0.45;
      const amount = AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)];
      const left   = 8 + Math.random() * 84; // % across card
      const id     = ++idRef.current;

      setTicks(prev => [...prev.slice(-14), { id, isYes, amount, left }]);

      // remove after animation
      setTimeout(() => setTicks(prev => prev.filter(t => t.id !== id)), 2600);
    };

    // stagger initial spawns
    const timeouts = [];
    for (let i = 0; i < 4; i++) {
      timeouts.push(setTimeout(spawn, i * 300));
    }

    const iv = setInterval(spawn, 520 + Math.random() * 400);
    return () => {
      clearInterval(iv);
      timeouts.forEach(clearTimeout);
    };
  }, []);

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      overflow: 'hidden', borderRadius: 16,
    }}>
      {ticks.map(t => (
        <span
          key={t.id}
          style={{
            position: 'absolute',
            bottom: '18%',
            left: `${t.left}%`,
            transform: 'translateX(-50%)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            fontSize: '12px',
            color: t.isYes ? 'var(--yes)' : 'var(--red)',
            textShadow: t.isYes
              ? '0 0 10px rgba(22,163,74,0.5)'
              : '0 0 10px rgba(212,32,32,0.5)',
            animation: 'trade-tick 2.5s ease-out forwards',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          {t.isYes ? '+' : '+'}{t.isYes ? '' : ''}${t.amount}
        </span>
      ))}
    </div>
  );
}

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
            Gana USDC cuando aciertas. Sin intermediarios. Sin MetaMask.
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
            {/* Live trades overlay */}
            <LiveTrades />

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
                  className={`wc-odds-btn${i === 0 ? ' yes' : ' no'}`}
                  onClick={e => { e.stopPropagation(); handleCardClick(); }}
                >
                  <span className="wc-odds-label">{opt.label}</span>
                  <span className={`wc-odds-val${i === 0 ? ' yes-val' : ' no-val'}`}>{opt.pct}%</span>
                </button>
              ))}
            </div>

            {/* Footer: volume + deadline + dots */}
            <div className="hero-carousel-footer">
              <div style={{ display: 'flex', gap: 16 }}>
                <span className="wc-vol">VOL&nbsp;<strong style={{ color: 'var(--green)' }}>${market.volume}</strong></span>
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
