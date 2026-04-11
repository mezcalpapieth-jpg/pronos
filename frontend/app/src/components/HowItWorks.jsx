import React from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useT } from '../lib/i18n.js';

export default function HowItWorks() {
  const t = useT();
  const { login, authenticated } = usePrivy();

  const STEPS = [
    { num: '01', icon: '📧', title: t('how.step1.title'), desc: t('how.step1.desc') },
    { num: '02', icon: '🔮', title: t('how.step2.title'), desc: t('how.step2.desc') },
    { num: '03', icon: '💰', title: t('how.step3.title'), desc: t('how.step3.desc') },
  ];

  return (
    <section id="how-it-works">
      <div className="how-inner">
        <div style={{ textAlign: 'center', marginBottom: 0 }}>
          <div className="hero-badge" style={{ display: 'inline-flex', marginBottom: 16 }}>
            <span className="dot" />
            <span>{t('how.label')}</span>
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(36px, 4vw, 54px)', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
            {t('how.title')}
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
                    <span>📧</span> {t('how.cta')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="tech-strip">
          <div className="tech-pill"><span className="dot" />Polygon</div>
          <div className="tech-pill"><span className="dot" />MXNB Nativo</div>
          <div className="tech-pill"><span className="dot" />Polymarket</div>
          <div className="tech-pill"><span className="dot" />Privy</div>
          <div className="tech-pill"><span className="dot" />Sin MetaMask</div>
        </div>
      </div>
    </section>
  );
}
