/**
 * Earn MXNP — dedicated page at /earn.
 *
 * Single surface for every way users earn MXNP outside of trading:
 *   1. Daily claim with streak display
 *   2. Referral link + stats
 *   3. Social task catalog with submit flow
 *
 * The campaign doc lists daily + streak + social + referrals as the
 * onboarding funnel. This page replaces the sidebar snippets on the
 * Portfolio page and gives users a clear "here's how to farm MXNP" hub.
 */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useIsMobile } from '@app/lib/useIsMobile.js';
import {
  claimDaily,
  fetchDailyStatus,
  fetchReferralStats,
  fetchSocialTaskCatalog,
  submitSocialTask,
  fetchSocialLinks,
  unlinkSocial,
  socialLinkStartUrl,
} from '../lib/pointsApi.js';

function fmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('es-MX', { maximumFractionDigits: 2 });
}

// ─── Daily claim card ────────────────────────────────────────────────────────
// Remembers if the caller already claimed today (via /api/points/history
// response OR a claim that came back with alreadyClaimedToday=true). When
// already claimed, the button greys out and becomes non-interactive until
// the next server day (UTC midnight rollover).
function DailyClaimCard({ onClaimed, alreadyClaimedToday: initialClaimed, onClaim }) {
  const [state, setState] = useState({
    loading: false,
    msg: null,
    err: null,
    streakDay: null,
    claimed: !!initialClaimed,
  });

  // Keep local `claimed` in sync with parent updates (e.g. after a
  // refresh of the history list).
  useEffect(() => {
    if (initialClaimed && !state.claimed) {
      setState(s => ({ ...s, claimed: true }));
    }
  }, [initialClaimed]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handle() {
    if (state.claimed || state.loading) return;
    setState(s => ({ ...s, loading: true, msg: null, err: null }));
    try {
      const r = await claimDaily();
      setState({
        loading: false,
        err: null,
        streakDay: r.streakDay,
        claimed: true,
        msg: r.alreadyClaimedToday
          ? `Ya reclamaste hoy (+${r.amount} MXNP, racha día ${r.streakDay})`
          : `+${r.amount} MXNP — Racha día ${r.streakDay} 🔥`,
      });
      onClaimed?.(r);
      onClaim?.(r);
    } catch (e) {
      setState(s => ({ ...s, loading: false, err: e.code || e.message }));
    }
  }

  const locked = state.claimed;
  const buttonLabel = state.loading
    ? 'Reclamando…'
    : locked
    ? '✓ Ya reclamaste hoy'
    : 'Reclamar';

  return (
    <section style={panelStyle}>
      <div style={eyebrowStyle}>⚡ Reclamo diario</div>
      <h3 style={panelTitleStyle}>100 MXNP hoy, +20 MXNP por cada día consecutivo</h3>
      <p style={panelBodyStyle}>
        Día 1 = 100 MXNP. Día 2 = 120. Día 3 = 140. Y así sucesivamente. Entra todos
        los días para mantener la racha — si te saltas un día, vuelves al día 1.
      </p>
      {state.msg && (
        <div style={{ ...noticeStyle, color: 'var(--green)' }}>{state.msg}</div>
      )}
      {state.err && (
        <div style={{ ...noticeStyle, color: 'var(--red, #ef4444)' }}>Error: {state.err}</div>
      )}
      <button
        className="btn-primary"
        onClick={handle}
        disabled={state.loading || locked}
        style={{
          width: '100%',
          padding: '12px 20px',
          marginTop: 16,
          // Grey-locked styling when already claimed — overrides the green
          // `.btn-primary` accent so it's visually obvious the action is
          // unavailable until tomorrow.
          ...(locked && {
            background: 'var(--surface3, #2a2a2a)',
            color: 'var(--text-muted)',
            cursor: 'not-allowed',
            opacity: 0.8,
            border: '1px solid var(--border)',
          }),
        }}
      >
        {buttonLabel}
      </button>
      {locked && (
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-muted)',
          textAlign: 'center',
          marginTop: 8,
          letterSpacing: '0.04em',
        }}>
          Vuelve mañana para mantener la racha.
        </p>
      )}
    </section>
  );
}

// Wrapper that hydrates `alreadyClaimedToday` on mount so the inner card
// can render the locked state without waiting for a user click. Keeping
// the hydration out of DailyClaimCard itself means the same card is
// reusable in places (like PointsPortfolio) that already know the status.
function DailyClaimCardWithStatus({ onClaimed }) {
  const [status, setStatus] = useState(null); // null = loading, then the API payload
  async function load() {
    try {
      const r = await fetchDailyStatus();
      setStatus(r);
    } catch {
      // Fall back to "not claimed" — worst case the user clicks and the
      // server tells them they already claimed today.
      setStatus({ alreadyClaimedToday: false });
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <DailyClaimCard
      alreadyClaimedToday={!!status?.alreadyClaimedToday}
      onClaimed={(r) => {
        onClaimed?.(r);
        load();
      }}
    />
  );
}

// ─── Referral card ───────────────────────────────────────────────────────────
function ReferralCard() {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchReferralStats().then(setData).catch(() => setData(null));
  }, []);

  async function handleCopy() {
    if (!data?.link) return;
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch { /* clipboard blocked — ignore */ }
  }

  function share(platform) {
    const link = data?.link;
    if (!link) return;
    const msg = encodeURIComponent(
      `¡Únete a Pronos y gana MXNP prediciendo eventos reales! 🎯\n${link}`,
    );
    const urls = {
      whatsapp: `https://wa.me/?text=${msg}`,
      twitter:  `https://twitter.com/intent/tweet?text=${msg}`,
      telegram: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('¡Únete a Pronos!')}`,
    };
    window.open(urls[platform], '_blank', 'noopener,noreferrer');
  }

  if (!data?.authenticated) return null;

  return (
    <section style={panelStyle}>
      <div style={eyebrowStyle}>🤝 Programa de referidos</div>
      <h3 style={panelTitleStyle}>+100 MXNP por cada amigo que se registre</h3>
      <p style={panelBodyStyle}>
        Comparte tu link único. Cuando alguien crea su cuenta usándolo, tú recibes
        <strong style={{ color: 'var(--green)' }}> 100 MXNP</strong> y ellos reciben
        <strong style={{ color: 'var(--green)' }}> 50 MXNP</strong> de bienvenida extra.
      </p>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '10px 12px',
        marginBottom: 12,
      }}>
        <span style={{
          flex: 1, minWidth: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {data.link}
        </span>
        <button
          onClick={handleCopy}
          style={{
            background: 'rgba(0,232,122,0.1)',
            border: '1px solid rgba(0,232,122,0.3)',
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: 'var(--green)',
            cursor: 'pointer',
            letterSpacing: '0.06em',
            minWidth: 80,
          }}
        >
          {copied ? '✓ COPIADO' : 'COPIAR'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { id: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
          { id: 'twitter',  label: 'X',        color: '#1DA1F2' },
          { id: 'telegram', label: 'Telegram', color: '#2AABEE' },
        ].map(s => (
          <button
            key={s.id}
            onClick={() => share(s.id)}
            style={{
              flex: 1,
              padding: '10px 8px',
              background: `${s.color}15`,
              border: `1px solid ${s.color}40`,
              borderRadius: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: s.color,
              cursor: 'pointer',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 10,
        marginTop: 18,
      }}>
        <div style={statBoxStyle}>
          <div style={statLabelStyle}>Referidos</div>
          <div style={{ ...statValStyle, color: 'var(--green)' }}>{data.count}</div>
        </div>
        <div style={statBoxStyle}>
          <div style={statLabelStyle}>MXNP ganados</div>
          <div style={{ ...statValStyle, color: 'var(--green)' }}>+{fmt(data.totalEarned)}</div>
        </div>
      </div>
    </section>
  );
}

// ─── Social tasks ────────────────────────────────────────────────────────────
function SocialTaskRow({ task, onSubmit }) {
  const [submitting, setSubmitting] = useState(false);

  const STATUS_COPY = {
    not_submitted: { label: 'Reclamar',        primary: true,  disabled: false },
    pending:       { label: '⏳ En revisión',   primary: false, disabled: true  },
    approved:      { label: '✓ Aprobado',       primary: false, disabled: true  },
    rejected:      { label: 'Rechazado · reintentar', primary: true, disabled: false },
  };
  const ui = STATUS_COPY[task.status] || STATUS_COPY.not_submitted;

  async function handle() {
    if (ui.disabled) return;
    // Open the social-network profile in a new tab so the user can complete
    // the action, then submit the task as "pending review".
    if (task.url) window.open(task.url, '_blank', 'noopener,noreferrer');
    setSubmitting(true);
    try {
      await onSubmit(task.key);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '14px 16px',
      background: 'var(--surface2)',
      border: '1px solid var(--border)',
      borderRadius: 10,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>
          {task.label}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
          {task.description}
        </div>
        {task.status === 'rejected' && task.rejectionNote && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--red, #ef4444)', marginTop: 4 }}>
            Motivo: {task.rejectionNote}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>
          +{task.reward}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>MXNP</div>
      </div>
      <button
        onClick={handle}
        disabled={ui.disabled || submitting}
        style={{
          padding: '8px 14px',
          background: ui.primary ? 'var(--green)' : 'var(--surface3)',
          color: ui.primary ? '#000' : 'var(--text-muted)',
          border: ui.primary ? 'none' : '1px solid var(--border)',
          borderRadius: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.06em',
          cursor: ui.disabled || submitting ? 'not-allowed' : 'pointer',
          minWidth: 120,
          opacity: ui.disabled || submitting ? 0.6 : 1,
          textTransform: 'uppercase',
        }}
      >
        {submitting ? '…' : ui.label}
      </button>
    </div>
  );
}

// ─── Verified social connections (OAuth) ─────────────────────────────
// Separate from SocialTasksCard because the verification story is
// different: here we get a cryptographic handshake with the provider
// and auto-credit MXNP. SocialTasksCard stays for "follow/post"-style
// tasks where the only proof we can demand is a screenshot.
const SOCIAL_PROVIDERS = [
  {
    key: 'x',
    label: 'X (Twitter)',
    icon: '𝕏',
    reward: 50,
    available: true,
    comingSoonNote: null,
  },
  {
    key: 'instagram',
    label: 'Instagram',
    icon: '📸',
    reward: 50,
    available: false,
    comingSoonNote: 'Esperando aprobación de Meta',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    icon: '🎵',
    reward: 50,
    available: false,
    comingSoonNote: 'Esperando aprobación de TikTok',
  },
];

function SocialLinksCard() {
  const [links, setLinks] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    try {
      const r = await fetchSocialLinks();
      const map = {};
      for (const l of r.links || []) map[l.provider] = l;
      setLinks(map);
    } catch (e) {
      setErr(e.code || e.message);
    }
  }
  useEffect(() => { load(); }, []);

  // Surface the callback's link/link_error query params as a banner.
  // The callback redirects to /earn?linked=x on success or
  // /earn?link_error=x:<code> on failure.
  useEffect(() => {
    const url = new URL(window.location.href);
    const linked = url.searchParams.get('linked');
    const linkError = url.searchParams.get('link_error');
    if (linked || linkError) {
      // Strip the params so a refresh doesn't re-show the banner.
      url.searchParams.delete('linked');
      url.searchParams.delete('link_error');
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    }
    if (linkError) setErr(linkError);
  }, []);

  async function handleConnect(provider) {
    if (!SOCIAL_PROVIDERS.find(p => p.key === provider)?.available) return;
    // Full page redirect — provider OAuth needs to navigate away.
    window.location.href = socialLinkStartUrl(provider, '/earn');
  }

  async function handleDisconnect(provider) {
    setBusy(provider);
    try {
      await unlinkSocial(provider);
      await load();
    } catch (e) {
      setErr(e.code || e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section style={panelStyle}>
      <div style={eyebrowStyle}>🔗 Cuentas verificadas</div>
      <h3 style={panelTitleStyle}>Conecta tus redes sociales</h3>
      <p style={panelBodyStyle}>
        Verificamos tu cuenta directamente con la red social — no hace falta capturas
        ni revisión manual. Ganas MXNP en cuanto conectas.
      </p>
      {err && (
        <div style={{ ...noticeStyle, color: 'var(--red, #ef4444)' }}>Error: {err}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        {SOCIAL_PROVIDERS.map(p => {
          const link = links?.[p.key] || null;
          const isLinked = !!link;
          const locked = !p.available && !isLinked;
          return (
            <div
              key={p.key}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 16px',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
              }}
            >
              <div style={{
                fontSize: 20, width: 28, textAlign: 'center',
                filter: locked ? 'grayscale(1)' : 'none',
                opacity: locked ? 0.5 : 1,
              }}>
                {p.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {p.label}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                  {isLinked
                    ? `Conectado como @${link.handle || '—'}`
                    : (locked ? p.comingSoonNote : 'Verificación automática vía OAuth')}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>
                  {isLinked && link.rewardCredited ? '✓' : `+${p.reward}`}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>MXNP</div>
              </div>
              {isLinked ? (
                <button
                  onClick={() => handleDisconnect(p.key)}
                  disabled={busy === p.key}
                  style={{
                    padding: '8px 14px',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    cursor: busy === p.key ? 'wait' : 'pointer',
                    minWidth: 120,
                    opacity: busy === p.key ? 0.6 : 1,
                    textTransform: 'uppercase',
                  }}
                >
                  {busy === p.key ? '…' : 'Desconectar'}
                </button>
              ) : (
                <button
                  onClick={() => handleConnect(p.key)}
                  disabled={locked}
                  style={{
                    padding: '8px 14px',
                    background: locked ? 'var(--surface3)' : 'var(--green)',
                    color: locked ? 'var(--text-muted)' : '#000',
                    border: locked ? '1px solid var(--border)' : 'none',
                    borderRadius: 8,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    cursor: locked ? 'not-allowed' : 'pointer',
                    minWidth: 120,
                    opacity: locked ? 0.6 : 1,
                    textTransform: 'uppercase',
                  }}
                >
                  {locked ? 'Próximamente' : 'Conectar'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// (Turnkey delegated-signing card was removed from this page on
// 2026-04-30. The points app is purely off-chain MXNP and never calls
// into a signing flow, so prompting here just confused users. The MVP
// — the on-chain product — handles the authorization in two places:
//   1. New MVP signups: a one-time step right after the username
//      modal, before the user lands on the home feed.
//   2. Legacy points-app accounts that signed up pre-MVP and so
//      missed step 1: a dismissable banner on the Portfolio page,
//      shown until they accept (banner self-hides forever once
//      delegation goes active).
//
// The PointsDelegationModal component itself is still imported by the
// MVP and the new banner — only the *trigger* lives elsewhere.

function SocialTasksCard() {
  const [tasks, setTasks] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const r = await fetchSocialTaskCatalog();
      setTasks(r.tasks);
    } catch (e) {
      setErr(e.code || e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function handleSubmit(taskKey) {
    try {
      await submitSocialTask(taskKey);
      await load();
    } catch (e) {
      setErr(e.code || e.message);
    }
  }

  return (
    <section style={panelStyle}>
      <div style={eyebrowStyle}>📲 Tareas sociales</div>
      <h3 style={panelTitleStyle}>Sigue a Pronos y gana MXNP</h3>
      <p style={panelBodyStyle}>
        Completa la tarea en la red social y marca "Reclamar". El equipo revisa en
        menos de 24 h. Si se rechaza, puedes reintentar con nueva captura.
      </p>
      {err && (
        <div style={{ ...noticeStyle, color: 'var(--red, #ef4444)' }}>Error: {err}</div>
      )}
      {!tasks && !err && (
        <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', padding: 20 }}>
          Cargando…
        </div>
      )}
      {tasks && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {tasks.map(t => (
            <SocialTaskRow key={t.key} task={t} onSubmit={handleSubmit} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function PointsEarn({ onOpenLogin }) {
  const navigate = useNavigate();
  const { authenticated, user, loading, refresh } = usePointsAuth();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!loading && !authenticated) {
      // Fall back to the login modal so the user can sign in without
      // losing context of where they came from.
      onOpenLogin?.();
    }
  }, [loading, authenticated, onOpenLogin]);

  if (loading) {
    return (
      <main style={{ padding: 80, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
        Cargando…
      </main>
    );
  }
  if (!authenticated) {
    return (
      <main style={{ padding: '80px 48px', maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 40, marginBottom: 16 }}>
          Gana MXNP
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
          Crea tu cuenta (gratis) para ver tu racha, referir amigos, y completar tareas sociales.
        </p>
        <button className="btn-primary" onClick={onOpenLogin} style={{ padding: '12px 24px' }}>
          Crear cuenta
        </button>
      </main>
    );
  }

  const balance = Number(user?.balance || 0);

  return (
    <main style={{
      padding: isMobile ? '32px 16px 56px' : '60px 48px',
      maxWidth: 1160,
      margin: '0 auto',
    }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(32px, 5vw, 52px)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-primary)',
          marginBottom: 8,
        }}>
          Gana MXNP
        </h1>
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          Balance actual:&nbsp;
          <strong style={{ color: 'var(--green)', fontWeight: 700 }}>
            {fmt(balance)} MXNP
          </strong>
          &nbsp;· @{user?.username}
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 24,
      }}>
        <DailyClaimCardWithStatus onClaimed={refresh} />
        <ReferralCard />
      </div>

      <div style={{ marginTop: 24 }}>
        <SocialLinksCard />
      </div>

      <div style={{ marginTop: 24 }}>
        <SocialTasksCard />
      </div>

      <div style={{
        marginTop: 32,
        padding: '12px 16px',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--text-muted)',
        lineHeight: 1.7,
      }}>
        ℹ️ MXNP son puntos de la competencia — no tienen valor económico directo.
        Los 3 mejores del leaderboard cada 2 semanas reciben $5,000, $3,000 y $2,000 MXN
        en efectivo. Posiciones 4°–10° reciben premios sorpresa. Verificación manual de
        tareas sociales en &lt;24 h.
      </div>
    </main>
  );
}

// ─── Shared styles ──────────────────────────────────────────────────────────
const panelStyle = {
  background: 'var(--surface1)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: '24px 26px',
};

const eyebrowStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.14em',
  color: 'var(--green)',
  textTransform: 'uppercase',
  marginBottom: 8,
};

const panelTitleStyle = {
  fontFamily: 'var(--font-body)',
  fontSize: 18,
  color: 'var(--text-primary)',
  lineHeight: 1.3,
  margin: '0 0 8px',
  fontWeight: 600,
};

const panelBodyStyle = {
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  color: 'var(--text-secondary)',
  lineHeight: 1.6,
  margin: 0,
};

const noticeStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  padding: '10px 12px',
  borderRadius: 8,
  marginTop: 12,
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
};

const statBoxStyle = {
  padding: '12px 14px',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  textAlign: 'center',
};

const statLabelStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  letterSpacing: '0.1em',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  marginBottom: 4,
};

const statValStyle = {
  fontFamily: 'var(--font-display)',
  fontSize: 22,
  letterSpacing: '0.02em',
};
