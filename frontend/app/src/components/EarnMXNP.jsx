/**
 * EarnMXNP — Campaign earn section for the Portfolio page.
 *
 * Social CONNECT tasks use Privy's useLinkAccount() for real OAuth
 * verification. FOLLOW tasks (which require manual review) are locked
 * until the corresponding account has been connected via Privy.
 *
 * MXNP balance + streak live in localStorage — visual only, no real value.
 */
import React, { useState, useEffect } from 'react';
import { usePrivy, useLinkAccount } from '@privy-io/react-auth';

// ─── Storage helpers ──────────────────────────────────────────────────────────
const SK = {
  balance:   'pronos-mxnp-balance',
  streak:    'pronos-mxnp-streak',
  lastClaim: 'pronos-mxnp-last-claim',
  tasks:     'pronos-mxnp-tasks',
};

const SIGNUP_BONUS = 250;

function todayStr()    { return new Date().toISOString().slice(0, 10); }
function lsGet(k)      { try { return localStorage.getItem(SK[k]); } catch { return null; } }
function lsSet(k, v)   { try { localStorage.setItem(SK[k], String(v)); } catch {} }
function loadBalance() { return parseInt(lsGet('balance')  || '0', 10); }
function loadStreak()  { return parseInt(lsGet('streak')   || '1', 10); }
function loadLastClaim(){ return lsGet('lastClaim') || null; }
function loadTasks()   { try { return JSON.parse(lsGet('tasks') || '{}'); } catch { return {}; } }
function saveTasks(t)  { try { localStorage.setItem(SK.tasks, JSON.stringify(t)); } catch {} }

// ─── Social links ─────────────────────────────────────────────────────────────
const IG_PROFILE  = 'https://www.instagram.com/pronos.latam/';
const TT_PROFILE  = 'https://www.tiktok.com/@pronos.io';
const X_PROFILE   = 'https://twitter.com/pronos_io';

function buildShareUrl(platform, link) {
  const text = encodeURIComponent(`¡Únete a Pronos y gana MXNP prediciendo eventos reales! 🎯\n${link}`);
  const url  = encodeURIComponent(link);
  if (platform === 'whatsapp')  return `https://wa.me/?text=${text}`;
  if (platform === 'twitter')   return `https://twitter.com/intent/tweet?text=${text}`;
  if (platform === 'telegram')  return `https://t.me/share/url?url=${url}&text=${encodeURIComponent('¡Únete a Pronos y gana MXNP! 🎯')}`;
  return link;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em',
      color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 14,
    }}>
      {children}
    </div>
  );
}

function TaskRow({ icon, label, sub, mxnp, done, locked, lockMsg, onClaim, isLoading }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 0', borderBottom: '1px solid var(--border)',
      opacity: done ? 0.55 : locked ? 0.45 : 1,
    }}>
      <span style={{ fontSize: 20, flexShrink: 0, width: 28, textAlign: 'center' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-body)', lineHeight: 1.3 }}>
          {label}
        </div>
        {(sub || (locked && lockMsg)) && (
          <div style={{ fontSize: 10, color: locked ? 'var(--red, #ef4444)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
            {locked ? (lockMsg || '🔒 Conecta la cuenta primero') : sub}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 4 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>+{mxnp}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>MXNP</div>
      </div>
      <button
        onClick={onClaim}
        disabled={done || locked || isLoading}
        style={{
          background: done ? 'var(--surface2)' : locked ? 'var(--surface2)' : 'rgba(0,232,122,0.1)',
          border: `1px solid ${done || locked ? 'var(--border)' : 'rgba(0,232,122,0.3)'}`,
          borderRadius: 8, padding: '5px 12px', fontSize: 10,
          fontFamily: 'var(--font-mono)',
          color: done ? 'var(--text-muted)' : locked ? 'var(--text-muted)' : 'var(--green)',
          cursor: done || locked || isLoading ? 'not-allowed' : 'pointer',
          letterSpacing: '0.06em', flexShrink: 0, minWidth: 84, transition: 'all 0.15s',
        }}
      >
        {isLoading ? '…' : done ? '✓ LISTO' : locked ? '🔒 BLOQ.' : 'RECLAMAR'}
      </button>
    </div>
  );
}

// ─── ConnectRow — uses Privy linking ─────────────────────────────────────────
function ConnectRow({ icon, label, mxnp, connected, connectedLabel, onConnect, done, onClaim }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 0', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 20, flexShrink: 0, width: 28, textAlign: 'center' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-body)', lineHeight: 1.3 }}>
          {label}
        </div>
        {connected && connectedLabel && (
          <div style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
            ✓ {connectedLabel}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 4 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>+{mxnp}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>MXNP</div>
      </div>
      {connected ? (
        /* Connected — show claim if not yet claimed, else done */
        <button
          onClick={onClaim}
          disabled={done}
          style={{
            background: done ? 'var(--surface2)' : 'rgba(0,232,122,0.1)',
            border: `1px solid ${done ? 'var(--border)' : 'rgba(0,232,122,0.3)'}`,
            borderRadius: 8, padding: '5px 12px', fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: done ? 'var(--text-muted)' : 'var(--green)',
            cursor: done ? 'not-allowed' : 'pointer',
            letterSpacing: '0.06em', flexShrink: 0, minWidth: 84,
          }}
        >
          {done ? '✓ LISTO' : 'RECLAMAR'}
        </button>
      ) : (
        /* Not connected — show Privy link button */
        <button
          onClick={onConnect}
          style={{
            background: 'rgba(0,232,122,0.1)',
            border: '1px solid rgba(0,232,122,0.3)',
            borderRadius: 8, padding: '5px 12px', fontSize: 10,
            fontFamily: 'var(--font-mono)', color: 'var(--green)',
            cursor: 'pointer', letterSpacing: '0.06em', flexShrink: 0, minWidth: 84,
          }}
        >
          CONECTAR
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function EarnMXNP({ address }) {
  const { user } = usePrivy();
  const { linkTwitter, linkInstagram, linkTikTok } = useLinkAccount();

  // ── Privy-verified connection state ────────────────────────────
  const linked = user?.linkedAccounts || [];
  const isXConnected  = linked.some(a => a.type === 'twitter_oauth');
  const isIGConnected = linked.some(a => a.type === 'instagram_oauth');
  const isTTConnected = linked.some(a => a.type === 'tiktok_oauth');

  // Human-readable labels for connected accounts
  const xAccount  = linked.find(a => a.type === 'twitter_oauth');
  const igAccount = linked.find(a => a.type === 'instagram_oauth');
  const ttAccount = linked.find(a => a.type === 'tiktok_oauth');

  const xLabel  = xAccount?.username  ? `@${xAccount.username}`  : 'Cuenta vinculada';
  const igLabel = igAccount?.username ? `@${igAccount.username}` : 'Cuenta vinculada';
  const ttLabel = ttAccount?.username ? `@${ttAccount.username}` : 'Cuenta vinculada';

  // ── MXNP local state ────────────────────────────────────────────
  const [balance,     setBalanceState]  = useState(0);
  const [streak,      setStreakState]   = useState(1);
  const [canClaim,    setCanClaim]      = useState(false);
  const [tasks,       setTasksState]    = useState({});
  const [copied,      setCopied]        = useState(false);
  const [toast,       setToast]         = useState(null);
  const [initialized, setInitialized]  = useState(false);

  // Load persisted state
  useEffect(() => {
    const bal       = loadBalance();
    const str       = loadStreak();
    const last      = loadLastClaim();
    const completed = loadTasks();

    if (!completed.signup) {
      const newBal = bal + SIGNUP_BONUS;
      lsSet('balance', newBal);
      setBalanceState(newBal);
      completed.signup = true;
      saveTasks(completed);
      showToast(`+${SIGNUP_BONUS} MXNP — ¡Bienvenido a Pronos! 🎉`);
    } else {
      setBalanceState(bal);
    }
    setStreakState(str);
    setTasksState(completed);
    setCanClaim(last !== todayStr());
    setInitialized(true);
  }, []);

  // Auto-credit connect tasks when Privy links them
  useEffect(() => {
    if (!initialized) return;
    const next = { ...loadTasks() };
    let changed = false;

    if (isXConnected  && !next.x_connect)  { next.x_connect  = true; creditAndSave('x_connect',  5,  next); changed = true; }
    if (isIGConnected && !next.ig_connect) { next.ig_connect = true; creditAndSave('ig_connect', 5,  next); changed = true; }
    if (isTTConnected && !next.tt_connect) { next.tt_connect = true; creditAndSave('tt_connect', 5,  next); changed = true; }

    if (changed) setTasksState({ ...next });
  }, [isXConnected, isIGConnected, isTTConnected, initialized]);

  function creditAndSave(key, amount, taskObj) {
    taskObj[key] = true;
    saveTasks(taskObj);
    setBalanceState(prev => {
      const next = prev + amount;
      lsSet('balance', next);
      return next;
    });
    showToast(`+${amount} MXNP — Cuenta conectada ✓`);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function credit(amount) {
    setBalanceState(prev => { const n = prev + amount; lsSet('balance', n); return n; });
  }

  // ── Daily claim ─────────────────────────────────────────────────
  function handleDailyClaim() {
    if (!canClaim) return;
    const amt       = 100 + (streak - 1) * 20;
    const newStreak = streak + 1;
    credit(amt);
    setStreakState(newStreak);
    lsSet('streak',    newStreak);
    lsSet('lastClaim', todayStr());
    setCanClaim(false);
    showToast(`+${amt} MXNP — Racha: ${newStreak} días 🔥`);
  }

  // ── Social tasks ────────────────────────────────────────────────
  function handleTask(key, mxnp, url) {
    if (tasks[key]) return;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    const next = { ...tasks, [key]: true };
    setTasksState(next);
    saveTasks(next);
    credit(mxnp);
    const msg = url ? `+${mxnp} MXNP — Pendiente verificación ⏳` : `+${mxnp} MXNP reclamados ✓`;
    showToast(msg);
  }

  // ── Connect task claim (after Privy already linked) ─────────────
  function handleConnectClaim(key, mxnp) {
    if (tasks[key]) return;
    const next = { ...tasks, [key]: true };
    setTasksState(next);
    saveTasks(next);
    credit(mxnp);
    showToast(`+${mxnp} MXNP — Cuenta verificada ✓`);
  }

  // ── Referral copy / share ────────────────────────────────────────
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`https://${refLink}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch { /* blocked */ }
  }

  function handleShare(platform) {
    window.open(buildShareUrl(platform, `https://${refLink}`), '_blank', 'noopener,noreferrer');
  }

  // ── Derived ──────────────────────────────────────────────────────
  const dailyAmt  = 100 + (streak - 1) * 20;
  const shortAddr = address ? address.slice(2, 10) : 'usuario';
  const refLink   = `pronos.io/r/${shortAddr}`;

  if (!initialized) return null;

  return (
    <section style={{ marginTop: 56 }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, right: 24,
          background: 'var(--surface1)', border: '1px solid rgba(0,232,122,0.4)',
          borderRadius: 10, padding: '12px 18px',
          fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--green)',
          zIndex: 9999, boxShadow: '0 4px 32px rgba(0,232,122,0.12)', maxWidth: 320,
        }}>
          {toast}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        justifyContent: 'space-between', gap: 16, marginBottom: 28,
        paddingBottom: 20, borderBottom: '1px solid var(--border)',
      }}>
        <div>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 2.5vw, 28px)',
            textTransform: 'uppercase', letterSpacing: '0.04em',
            color: 'var(--text-primary)', marginBottom: 4,
          }}>
            Ganar MXNP
          </h2>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
            Ciclo 1 · Termina 28 Abr · Premio total: $500 USD
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {/* Balance pill */}
          <div style={{
            background: 'rgba(0,232,122,0.07)', border: '1px solid rgba(0,232,122,0.22)',
            borderRadius: 12, padding: '10px 18px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>Tu balance</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--green)', lineHeight: 1 }}>
              {balance.toLocaleString('es-MX')}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>MXNP</div>
          </div>
          {/* Streak pill */}
          <div style={{
            background: 'var(--surface1)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '10px 18px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>Racha</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--text-primary)', lineHeight: 1 }}>
              🔥{streak}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>días</div>
          </div>
        </div>
      </div>

      {/* ── Daily claim ── */}
      <div style={{
        background: canClaim ? 'rgba(0,232,122,0.05)' : 'var(--surface1)',
        border: `1px solid ${canClaim ? 'rgba(0,232,122,0.28)' : 'var(--border)'}`,
        borderRadius: 14, padding: '18px 22px', marginBottom: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: canClaim ? 'var(--green)' : 'var(--text-muted)', marginBottom: 6,
          }}>
            {canClaim ? '⚡ Disponible ahora' : '✓ Reclamado hoy'}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
            Claim diario de MXNP
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
            Racha actual: {streak} día{streak !== 1 ? 's' : ''}&nbsp;→&nbsp;
            <span style={{ color: 'var(--green)', fontWeight: 700 }}>+{dailyAmt} MXNP</span>
            <span style={{ opacity: 0.6 }}>&nbsp;(+20/día acumulado)</span>
          </div>
        </div>
        <button
          onClick={handleDailyClaim}
          disabled={!canClaim}
          className={canClaim ? 'btn-primary' : undefined}
          style={{
            padding: '11px 26px', fontSize: 12, letterSpacing: '0.06em', flexShrink: 0,
            ...(!canClaim ? {
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 8, fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)', cursor: 'not-allowed', opacity: 0.6,
            } : {}),
          }}
        >
          {canClaim ? `CLAIM +${dailyAmt} MXNP` : 'Vuelve mañana'}
        </button>
      </div>

      {/* ── Two-column: social tasks + referral ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginBottom: 20 }}>

        {/* Social tasks */}
        <div style={{ background: 'var(--surface1)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px' }}>
          <SectionLabel>📲 Redes Sociales</SectionLabel>

          {/* ── Twitter/X ── */}
          <ConnectRow
            icon="𝕏"
            label="Conectar cuenta de X (Twitter)"
            mxnp={5}
            connected={isXConnected}
            connectedLabel={xLabel}
            onConnect={linkTwitter}
            done={!!tasks.x_connect}
            onClaim={() => handleConnectClaim('x_connect', 5)}
          />
          <TaskRow
            icon="➕"
            label="Seguir @pronos_io en X"
            sub="Una vez · Verificación en &lt;24 h"
            mxnp={25}
            done={!!tasks.x_follow}
            locked={!isXConnected}
            lockMsg="🔒 Conecta tu cuenta X primero"
            onClaim={() => handleTask('x_follow', 25, X_PROFILE)}
          />

          {/* ── Instagram ── */}
          <ConnectRow
            icon="📸"
            label="Conectar cuenta de Instagram"
            mxnp={5}
            connected={isIGConnected}
            connectedLabel={igLabel}
            onConnect={linkInstagram}
            done={!!tasks.ig_connect}
            onClaim={() => handleConnectClaim('ig_connect', 5)}
          />
          <TaskRow
            icon="➕"
            label="Seguir @pronos.latam en Instagram"
            sub="Una vez · Verificación en &lt;24 h"
            mxnp={25}
            done={!!tasks.ig_follow}
            locked={!isIGConnected}
            lockMsg="🔒 Conecta tu cuenta Instagram primero"
            onClaim={() => handleTask('ig_follow', 25, IG_PROFILE)}
          />

          {/* ── TikTok ── */}
          <ConnectRow
            icon="🎵"
            label="Conectar cuenta de TikTok"
            mxnp={5}
            connected={isTTConnected}
            connectedLabel={ttLabel}
            onConnect={linkTikTok}
            done={!!tasks.tt_connect}
            onClaim={() => handleConnectClaim('tt_connect', 5)}
          />
          <TaskRow
            icon="➕"
            label="Seguir @pronos.io en TikTok"
            sub="Una vez · Verificación en &lt;24 h"
            mxnp={25}
            done={!!tasks.tt_follow}
            locked={!isTTConnected}
            lockMsg="🔒 Conecta tu cuenta TikTok primero"
            onClaim={() => handleTask('tt_follow', 25, TT_PROFILE)}
          />

          <div style={{ paddingTop: 10, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            ⏳ Los follows son verificados manualmente por el equipo Pronos
          </div>
        </div>

        {/* Referral */}
        <div style={{ background: 'var(--surface1)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px' }}>
          <SectionLabel>🤝 Programa de Referidos</SectionLabel>

          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', marginBottom: 2 }}>
            Tu link único de referido
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 12 }}>
            +100 MXNP por referido · el nuevo usuario recibe +50 MXNP · máx 10/ciclo
          </div>

          {/* Link + copy */}
          <div style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '9px 12px',
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)',
              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {refLink}
            </span>
            <button
              onClick={handleCopy}
              style={{
                background: 'rgba(0,232,122,0.1)', border: '1px solid rgba(0,232,122,0.3)',
                borderRadius: 6, padding: '4px 10px', fontSize: 10,
                fontFamily: 'var(--font-mono)', color: 'var(--green)',
                cursor: 'pointer', flexShrink: 0, letterSpacing: '0.06em', minWidth: 70,
              }}
            >
              {copied ? '✓ COPIADO' : 'COPIAR'}
            </button>
          </div>

          {/* Share buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {[
              { id: 'whatsapp', icon: '💬', label: 'WhatsApp', color: '#25D366', bg: 'rgba(37,211,102,0.08)' },
              { id: 'twitter',  icon: '𝕏',  label: 'X',        color: '#1DA1F2', bg: 'rgba(29,161,242,0.08)' },
              { id: 'telegram', icon: '✈️', label: 'Telegram', color: '#2AABEE', bg: 'rgba(42,171,238,0.08)' },
            ].map(s => (
              <button key={s.id} onClick={() => handleShare(s.id)} style={{
                flex: 1, background: s.bg, border: `1px solid ${s.color}40`,
                borderRadius: 8, padding: '9px 6px', fontSize: 9,
                fontFamily: 'var(--font-mono)', color: s.color, cursor: 'pointer',
                letterSpacing: '0.04em', textTransform: 'uppercase',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}>
                <span style={{ fontSize: 17 }}>{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>

          {/* Referral count */}
          <div style={{
            borderTop: '1px solid var(--border)', paddingTop: 12,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>Referidos este ciclo</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>0 / 10</span>
          </div>
        </div>
      </div>

      {/* ── Completed tasks summary ── */}
      <div style={{
        background: 'var(--surface1)', border: '1px solid var(--border)', borderRadius: 14,
        padding: '14px 22px', marginBottom: 16,
        display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'center',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--green)', letterSpacing: '0.06em' }}>
          ✓ Cuenta creada
        </span>
        {[
          { key: 'x_connect',  label: 'X conectado' },
          { key: 'x_follow',   label: 'X seguido' },
          { key: 'ig_connect', label: 'IG conectado' },
          { key: 'ig_follow',  label: 'IG seguido' },
          { key: 'tt_connect', label: 'TikTok conectado' },
          { key: 'tt_follow',  label: 'TikTok seguido' },
        ].map(({ key, label }) => (
          <span key={key} style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
            color: tasks[key] ? 'var(--green)' : 'var(--text-muted)',
            opacity: tasks[key] ? 1 : 0.4,
          }}>
            {tasks[key] ? '✓' : '○'} {label}
          </span>
        ))}
      </div>

      {/* ── Disclaimer ── */}
      <div style={{
        padding: '12px 16px', background: 'var(--surface1)',
        border: '1px solid var(--border)', borderRadius: 10,
        fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)',
        lineHeight: 1.7, letterSpacing: '0.03em',
      }}>
        ℹ️ MXNP son puntos de testnet — no tienen valor económico real. Los premios en USD ($500 por ciclo) se distribuyen al final de cada ciclo de 2 semanas a los Top 3 del leaderboard. Posiciones 4–10 reciben premios sorpresa. Verificación manual por el equipo Pronos en &lt;24 h. Mínimo 10 mercados operados para calificar.
      </div>
    </section>
  );
}
