import React, { useState, useEffect, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useNavigate } from 'react-router-dom';
import MARKETS from '../lib/markets.js';
import { fetchResolutions } from '../lib/resolutions.js';
import Sparkline from './Sparkline.jsx';

/* ── Hero ─────────────────────────────────────────────── */
export default function Hero() {
  const { authenticated, login } = usePrivy();
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const [featured, setFeatured] = useState(() =>
    MARKETS.filter(m => m._source === 'polymarket' && m.trending && !m._resolved)
  );

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

  // Drag-to-scroll
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef({ startX: 0, scrollLeft: 0 });

  const onMouseDown = (e) => {
    setIsDragging(true);
    dragState.current.startX = e.pageX - scrollRef.current.offsetLeft;
    dragState.current.scrollLeft = scrollRef.current.scrollLeft;
  };
  const onMouseMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - dragState.current.startX) * 1.5;
    scrollRef.current.scrollLeft = dragState.current.scrollLeft - walk;
  };
  const onMouseUp = () => setIsDragging(false);

  const scroll = (dir) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: dir * 320, behavior: 'smooth' });
  };

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

        {/* ── Right: scrollable featured markets ───── */}
        <div className="hero-right">
          {/* Scroll arrows */}
          <div className="hero-scroll-nav">
            <button className="hero-scroll-btn" onClick={() => scroll(-1)} aria-label="Anterior">&#8249;</button>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
              DESTACADOS
            </span>
            <button className="hero-scroll-btn" onClick={() => scroll(1)} aria-label="Siguiente">&#8250;</button>
          </div>

          {/* Scrollable track */}
          <div
            className={`hero-scroll-track${isDragging ? ' grabbing' : ''}`}
            ref={scrollRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            {featured.map((market) => (
              <div
                key={market.id}
                className="hero-featured-card"
                onClick={() => !isDragging && navigate(`/market?id=${market.id}`)}
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

                {/* Chart */}
                <div className="hfc-chart">
                  <Sparkline
                    width={260}
                    height={60}
                    color="var(--yes)"
                    strokeWidth={1.5}
                  />
                </div>

                {/* Odds */}
                <div className="hfc-odds">
                  {(market.options || []).map((opt, i) => (
                    <div key={i} className={`hfc-odd ${i === 0 ? 'yes' : 'no'}`}>
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
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
