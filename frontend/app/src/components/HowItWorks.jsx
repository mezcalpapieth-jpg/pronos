import React from 'react';
import { usePrivy } from '@privy-io/react-auth';

const STEPS = [
  {
    num: '01',
    icon: '📧',
    title: 'Crea tu cuenta',
    desc: 'Regístrate con email o Google en segundos. Pronos crea automáticamente una wallet on-chain para ti — sin extensiones, sin seed phrases.',
  },
  {
    num: '02',
    icon: '🔮',
    title: 'Elige un mercado',
    desc: 'Explora mercados de política, deportes, cultura y crypto. Elige un resultado y entra con USDC al mejor precio disponible en el libro.',
  },
  {
    num: '03',
    icon: '💰',
    title: 'Gestiona tu salida',
    desc: 'Puedes vender tus shares antes del cierre para asegurar ganancias o reducir riesgo, o mantener tu posición hasta la resolución.',
  },
];

export default function HowItWorks() {
  const { login, authenticated } = usePrivy();

  return (
    <section id="how-it-works">
      <div className="how-inner">
        <div style={{ textAlign: 'center', marginBottom: 0 }}>
          <div className="hero-badge" style={{ display: 'inline-flex', marginBottom: 16 }}>
            <span className="dot" />
            <span>Simple · Rápido · On-chain</span>
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(36px, 4vw, 54px)', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
            Cómo funciona
          </h2>
        </div>

        <div className="steps-grid">
          {STEPS.map((step, i) => (
            <div className="step" key={i}>
              <div className="step-num">{step.num}</div>
              <div className="step-icon-circle">
                <span style={{ fontSize: 22 }}>{step.icon}</span>
              </div>
              <div className="step-title">{step.title}</div>
              <p className="step-desc">{step.desc}</p>
              {i === 0 && !authenticated && (
                <div className="step-btns">
                  <button className="step-btn-wallet" onClick={login}>
                    <span>📧</span> Crear cuenta gratis
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="tech-strip">
          <div className="tech-pill"><span className="dot" />Polygon</div>
          <div className="tech-pill"><span className="dot" />USDC.e</div>
          <div className="tech-pill"><span className="dot" />Polymarket</div>
          <div className="tech-pill"><span className="dot" />Privy</div>
          <div className="tech-pill"><span className="dot" />Sin MetaMask</div>
        </div>
      </div>
    </section>
  );
}
