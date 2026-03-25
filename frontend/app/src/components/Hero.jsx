import React from 'react';
import { usePrivy } from '@privy-io/react-auth';

export default function Hero() {
  const { authenticated, login } = usePrivy();

  return (
    <section id="hero">
      <div className="hero-inner">
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
              <a href="#markets" className="btn-primary">
                Ver Mercados
              </a>
            ) : (
              <button className="btn-primary" onClick={login}>
                Empezar a Predecir
              </button>
            )}
            <a href="#how-it-works" className="btn-ghost">
              Cómo funciona
            </a>
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

        {/* Hero right: Featured market card */}
        <div className="hero-right">
          <div className="wc-card">
            <div className="wc-card-header">
              <div className="wc-card-header-left">
                <span className="dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', boxShadow: '0 0 8px var(--green)', animation: 'pulse-dot 1.4s ease-in-out infinite' }} />
                <span className="wc-card-badge">MUNDIAL 2026 · DESTACADO</span>
              </div>
              <span className="wc-card-league">11 Jun 2026</span>
            </div>

            <div className="wc-teams-row">
              <div className="wc-team">
                <div className="wc-flag">🇲🇽</div>
                <span className="wc-team-name">MÉXICO</span>
                <span className="wc-team-sub">Grupo A</span>
              </div>
              <span className="wc-vs">VS</span>
              <div className="wc-team">
                <div className="wc-flag dim">🇿🇦</div>
                <span className="wc-team-name">SUDÁFRICA</span>
                <span className="wc-team-sub">Grupo A</span>
              </div>
            </div>

            <div className="wc-market">
              <div className="wc-market-q">¿Quién gana el partido inaugural?</div>
              <div className="wc-odds-three">
                <button className="wc-odds-btn yes">
                  <span className="wc-odds-label">México</span>
                  <span className="wc-odds-val green">54%</span>
                </button>
                <button className="wc-odds-btn draw">
                  <span className="wc-odds-label">Empate</span>
                  <span className="wc-odds-val">24%</span>
                </button>
                <button className="wc-odds-btn no">
                  <span className="wc-odds-label">Sudáfrica</span>
                  <span className="wc-odds-val">22%</span>
                </button>
              </div>
              <div className="wc-vol">
                <span>Abre </span>
                <span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Mar 2026 · USDC</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
