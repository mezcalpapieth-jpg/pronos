/**
 * EarnMXNP — Campaign earn section for the Portfolio page.
 *
 * All rewards are VISUAL ONLY — no real MXNP is transferred.
 * State is persisted in localStorage so the daily-claim and task
 * completion state survive page refreshes.
 *
 * Social share buttons (WhatsApp, X/Twitter, Telegram) open real share
 * URLs so they are functional.
 */
import React, { useState, useEffect, useCallback } from 'react';

// ─── Storage helpers ──────────────────────────────────────────────────────────
const STORAGE = {
  balance:   'pronos-mxnp-balance',
  streak:    'pronos-mxnp-streak',
  lastClaim: 'pronos-mxnp-last-claim',
  tasks:     'pronos-mxnp-tasks',
};

const SIGNUP_BONUS = 250; // one-time account creation reward

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function ls(key, fallback) {
  try { return localStorage.getItem(STORAGE[key]); } catch { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(STORAGE[key], String(val)); } catch {}
}

function loadBalance()   { return parseInt(ls('balance')  || '0',  10); }
function loadStreak()    { return parseInt(ls('streak')   || '1',  10); }
function loadLastClaim() { return ls('lastClaim') || null; }
function loadTasks()     { try { return JSON.parse(ls('tasks') || '{}'); } catch { return {}; } }

function saveTasks(tasks) {
  try { localStorage.setItem(STORAGE.tasks, JSON.stringify(tasks)); } catch {}
}

// ─── Social share URLs ────────────────────────────────────────────────────────
const IG_URL     = 'https://instagram.com/pronos_mx';
const TT_URL     = 'https://tiktok.com/@pronos_mx';

function buildShareUrl(platform, refLink) {
  const text = encodeURIComponent(
    `¡Únete a Pronos y gana MXNP prediciendo eventos reales! 🎯\n${refLink}`,
  );
  const url = encodeURIComponent(refLink);
  if (platform === 'whatsapp')  return `https://wa.me/?text=${text}`;
  if (platform === 'twitter')   return `https://twitter.com/intent/tweet?text=${text}`;
  if (platform === 'telegram')  return `https://t.me/share/url?url=${url}&text=${encodeURIComponent('¡Únete a Pronos y gana MXNP! 🎯')}`;
  return refLink;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      letterSpacing: '0.12em',
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      marginBottom: 14,
    }}>
      {children}
    </div>
  );
}

function TaskRow({ icon, label, sub, mxnp, done, onClaim, link }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 0',
      borderBottom: '1px solid var(--border)',
      opacity: done ? 0.55 : 1,
    }}>
      <span style={{ fontSize: 20, flexShrink: 0, width: 28, textAlign: 'center' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-body)', lineHeight: 1.3 }}>
          {label}
        </div>
        {sub && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
            {sub}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 4 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>
          +{mxnp}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>MXNP</div>
      </div>
      <button
        onClick={onClaim}
        disabled={done}
        style={{
          background: done ? 'var(--surface2)' : 'rgba(0,232,122,0.1)',
          border: `1px solid ${done ? 'var(--border)' : 'rgba(0,232,122,0.3)'}`,
          borderRadius: 8,
          padding: '5px 12px',
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          color: done ? 'var(--text-muted)' : 'var(--green)',
          cursor: done ? 'not-allowed' : 'pointer',
          letterSpacing: '0.06em',
          flexShrink: 0,
          minWidth: 78,
          transition: 'all 0.15s',
        }}
      >
        {done ? '✓ LISTO' : link ? 'IR + CLAIM' : 'RECLAMAR'}
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function EarnMXNP({ address }) {
  const [balance,   setBalanceState]  = useState(0);
  const [streak,    setStreakState]    = useState(1);
  const [canClaim,  setCanClaim]      = useState(false);
  const [tasks,     setTasksState]    = useState({});
  const [copied,    setCopied]        = useState(false);
  const [toast,     setToast]         = useState(null);
  const [initialized, setInitialized] = useState(false);

  // ── Load from localStorage ──────────────────────────────────────
  useEffect(() => {
    const bal       = loadBalance();
    const str       = loadStreak();
    const last      = loadLastClaim();
    const completed = loadTasks();

    // Award signup bonus on first visit
    if (!completed.signup) {
      const newBal = bal + SIGNUP_BONUS;
      lsSet('balance', newBal);
      setBalanceState(newBal);
      completed.signup = true;
      saveTasks(completed);
      scheduleToast(`+${SIGNUP_BONUS} MXNP — ¡Bienvenido a Pronos! 🎉`);
    } else {
      setBalanceState(bal);
    }

    setStreakState(str);
    setTasksState(completed);
    setCanClaim(last !== todayStr());
    setInitialized(true);
  }, []);

  // ── Toast helper ────────────────────────────────────────────────
  function scheduleToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  // ── Credit helper ───────────────────────────────────────────────
  function credit(amount) {
    setBalanceState(prev => {
      const next = prev + amount;
      lsSet('balance', next);
      return next;
    });
  }

  // ── Daily claim ─────────────────────────────────────────────────
  function handleDailyClaim() {
    if (!canClaim) return;
    const claimAmt  = 100 + (streak - 1) * 20; // Day 1=100, Day 2=120…
    const newStreak = streak + 1;
    credit(claimAmt);
    setStreakState(newStreak);
    lsSet('streak',    newStreak);
    lsSet('lastClaim', todayStr());
    setCanClaim(false);
    scheduleToast(`+${claimAmt} MXNP — Racha: ${newStreak} días 🔥`);
  }

  // ── Social / referral task ──────────────────────────────────────
  function handleTask(key, mxnp, url) {
    if (tasks[key]) return;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    const next = { ...tasks, [key]: true };
    setTasksState(next);
    saveTasks(next);
    credit(mxnp);
    const msg = url
      ? `+${mxnp} MXNP — Pendiente verificación ⏳`
      : `+${mxnp} MXNP — ¡Reclamado! ✓`;
    scheduleToast(msg);
  }

  // ── Copy referral link ──────────────────────────────────────────
  async function handleCopy() {
    const ref = refLink;
    try {
      await navigator.clipboard.writeText(`https://${ref}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — silent */
    }
  }

  // ── Share ────────────────────────────────────────────────────────
  function handleShare(platform) {
    const ref = `https://${refLink}`;
    window.open(buildShareUrl(platform, ref), '_blank', 'noopener,noreferrer');
  }

  // ── Derived values ───────────────────────────────────────────────
  const dailyAmt  = 100 + (streak - 1) * 20;
  const shortAddr = address ? `${address.slice(2, 10)}` : 'usuario';
  const refLink   = `pronos.io/r/${shortAddr}`;

  if (!initialized) return null;

  return (
    <section style={{ marginTop: 56 }}>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 28,
          right: 24,
          background: 'var(--surface1)',
          border: '1px solid rgba(0,232,122,0.4)',
          borderRadius: 10,
          padding: '12px 18px',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--green)',
          zIndex: 9999,
          boxShadow: '0 4px 32px rgba(0,232,122,0.12)',
          maxWidth: 320,
        }}>
          {toast}
        </div>
      )}

      {/* ── Section header + balance ── */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 28,
        paddingBottom: 20,
        borderBottom: '1px solid var(--border)',
      }}>
        <div>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(22px, 2.5vw, 28px)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--text-primary)',
            marginBottom: 4,
          }}>
            Ganar MXNP
          </h2>
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-muted)',
          }}>
            Ciclo 1 · Termina 28 Abr · Premio total: $500 USD
          </p>
        </div>

        {/* Balance + Streak pills */}
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{
            background: 'rgba(0,232,122,0.07)',
            border: '1px solid rgba(0,232,122,0.22)',
            borderRadius: 12,
            padding: '10px 18px',
            textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>
              Tu balance
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--green)', lineHeight: 1 }}>
              {balance.toLocaleString('es-MX')}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              MXNP
            </div>
          </div>
          <div style={{
            background: 'var(--surface1)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '10px 18px',
            textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>
              Racha
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--text-primary)', lineHeight: 1 }}>
              🔥{streak}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              días
            </div>
          </div>
        </div>
      </div>

      {/* ── Daily claim card ── */}
      <div style={{
        background: canClaim ? 'rgba(0,232,122,0.05)' : 'var(--surface1)',
        border: `1px solid ${canClaim ? 'rgba(0,232,122,0.28)' : 'var(--border)'}`,
        borderRadius: 14,
        padding: '18px 22px',
        marginBottom: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: canClaim ? 'var(--green)' : 'var(--text-muted)',
            marginBottom: 6,
          }}>
            {canClaim ? '⚡ Disponible ahora' : '✓ Reclamado hoy'}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
            Claim diario de MXNP
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
            Racha actual: {streak} día{streak !== 1 ? 's' : ''}&nbsp;→&nbsp;
            <span style={{ color: 'var(--green)', fontWeight: 700 }}>+{dailyAmt} MXNP</span>
            <span style={{ marginLeft: 8 }}>
              (+20/día acumulado)
            </span>
          </div>
        </div>
        <button
          onClick={handleDailyClaim}
          disabled={!canClaim}
          className={canClaim ? 'btn-primary' : undefined}
          style={{
            padding: '11px 26px',
            fontSize: 12,
            letterSpacing: '0.06em',
            flexShrink: 0,
            ...(!canClaim ? {
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              cursor: 'not-allowed',
              opacity: 0.6,
            } : {}),
          }}
        >
          {canClaim ? `CLAIM +${dailyAmt} MXNP` : 'Vuelve mañana'}
        </button>
      </div>

      {/* ── Two-column grid: social tasks + referral ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 20,
        marginBottom: 20,
      }}>

        {/* Social tasks */}
        <div style={{
          background: 'var(--surface1)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: '20px 22px',
        }}>
          <SectionLabel>📲 Redes Sociales</SectionLabel>

          <TaskRow
            icon="📸"
            label="Seguir Pronos en Instagram"
            sub="Una vez · Verificación manual en &lt;24 h"
            mxnp={25}
            done={!!tasks.ig_follow}
            link={IG_URL}
            onClaim={() => handleTask('ig_follow', 25, IG_URL)}
          />
          <TaskRow
            icon="🎵"
            label="Seguir Pronos en TikTok"
            sub="Una vez · Verificación manual en &lt;24 h"
            mxnp={25}
            done={!!tasks.tt_follow}
            link={TT_URL}
            onClaim={() => handleTask('tt_follow', 25, TT_URL)}
          />
          <TaskRow
            icon="🔗"
            label="Conectar cuenta de Instagram"
            sub="Una vez"
            mxnp={5}
            done={!!tasks.ig_connect}
            onClaim={() => handleTask('ig_connect', 5, null)}
          />
          <TaskRow
            icon="🔗"
            label="Conectar cuenta de TikTok"
            sub="Una vez"
            mxnp={5}
            done={!!tasks.tt_connect}
            onClaim={() => handleTask('tt_connect', 5, null)}
          />
          <div style={{
            paddingTop: 10,
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: 'var(--text-muted)',
            letterSpacing: '0.04em',
          }}>
            ⏳ Los follows son verificados manualmente por el equipo
          </div>
        </div>

        {/* Referral */}
        <div style={{
          background: 'var(--surface1)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: '20px 22px',
        }}>
          <SectionLabel>🤝 Programa de Referidos</SectionLabel>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', marginBottom: 2 }}>
              Tu link único de referido
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 12 }}>
              +100 MXNP por referido · el nuevo usuario recibe +50 MXNP · máx 10/ciclo
            </div>

            {/* Link box + copy */}
            <div style={{
              background: 'var(--surface0, var(--surface2))',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '9px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-secondary)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {refLink}
              </span>
              <button
                onClick={handleCopy}
                style={{
                  background: 'rgba(0,232,122,0.1)',
                  border: '1px solid rgba(0,232,122,0.3)',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--green)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  letterSpacing: '0.06em',
                  minWidth: 70,
                  transition: 'all 0.15s',
                }}
              >
                {copied ? '✓ COPIADO' : 'COPIAR'}
              </button>
            </div>

            {/* Share buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { id: 'whatsapp',  icon: '💬', label: 'WhatsApp', color: '#25D366', bg: 'rgba(37,211,102,0.08)'  },
                { id: 'twitter',   icon: '𝕏',  label: 'Twitter',  color: '#1DA1F2', bg: 'rgba(29,161,242,0.08)'  },
                { id: 'telegram',  icon: '✈️', label: 'Telegram',  color: '#2AABEE', bg: 'rgba(42,171,238,0.08)'  },
              ].map(s => (
                <button
                  key={s.id}
                  onClick={() => handleShare(s.id)}
                  style={{
                    flex: 1,
                    background: s.bg,
                    border: `1px solid ${s.color}40`,
                    borderRadius: 8,
                    padding: '9px 6px',
                    fontSize: 9,
                    fontFamily: 'var(--font-mono)',
                    color: s.color,
                    cursor: 'pointer',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 17 }}>{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Referral count */}
          <div style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
              Referidos este ciclo
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
              0 / 10
            </span>
          </div>
        </div>
      </div>

      {/* ── Completed tasks row ── */}
      <div style={{
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '16px 22px',
        marginBottom: 20,
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px 20px',
        alignItems: 'center',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 4 }}>
          ✓ Cuenta creada
        </span>
        {[
          { key: 'ig_follow',  label: 'Instagram seguido' },
          { key: 'tt_follow',  label: 'TikTok seguido' },
          { key: 'ig_connect', label: 'IG conectado' },
          { key: 'tt_connect', label: 'TikTok conectado' },
        ].map(t => (
          <span key={t.key} style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: tasks[t.key] ? 'var(--green)' : 'var(--text-muted)',
            letterSpacing: '0.06em',
            opacity: tasks[t.key] ? 1 : 0.4,
          }}>
            {tasks[t.key] ? '✓' : '○'} {t.label}
          </span>
        ))}
      </div>

      {/* ── Disclaimer ── */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: 'var(--text-muted)',
        lineHeight: 1.7,
        letterSpacing: '0.03em',
      }}>
        ℹ️ MXNP son puntos de testnet — no tienen valor económico real. Los premios en USD ($500 por ciclo) se distribuyen al final de cada ciclo de 2 semanas a los Top 3 del leaderboard. Posiciones 4–10 reciben premios sorpresa. Verificación manual por el equipo Pronos en &lt;24 h. Mínimo 10 mercados operados para calificar.
      </div>
    </section>
  );
}
