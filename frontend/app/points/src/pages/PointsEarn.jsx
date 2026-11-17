/**
 * Perfil — dedicated page at /earn.
 *
 * Single user hub for account rewards outside of trading:
 *   1. Daily claim with streak display
 *   2. Referral link + stats
 *   3. Social task catalog with submit flow
 *
 * The campaign doc lists daily + streak + social + referrals as the
 * onboarding funnel. This page replaces the sidebar snippets on the
 * Portfolio page and gives users a clear "here's how to farm MXNP" hub.
 */
import React, { useEffect, useState } from 'react';
import { Check, Instagram, Music2, X } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useLang, useT } from '@app/lib/i18n.js';
import { useIsMobile } from '@app/lib/useIsMobile.js';
import { Button, Card, Checkbox, Input } from '../ui/index.jsx';
import SocialTaskAccountPrompt from '../components/SocialTaskAccountPrompt.jsx';
import { hasSocialTaskAccount, SOCIAL_LINKS_CHANGED_EVENT } from '../lib/socialTaskAccount.js';
import {
  claimDaily,
  fetchDailyStatus,
  fetchPwaInstallStatus,
  claimPwaInstallBonus,
  fetchReferralStats,
  fetchSocialTaskCatalog,
  submitSocialTask,
  fetchSocialLinks,
  saveProfileSettings,
  saveSocialLink,
  unlinkSocial,
  socialLinkStartUrl,
  publicErrorMessage,
} from '../lib/pointsApi.js';

function fmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('es-MX', { maximumFractionDigits: 2 });
}

function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator?.standalone === true;
}

function installPlatform() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/i.test(ua)) return 'android';
  return 'mobile';
}

function safeProfileImageUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value).trim());
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    return '';
  }
  return '';
}

function millisUntilIso(iso, nowMs = Date.now()) {
  const targetMs = Date.parse(iso || '');
  if (!Number.isFinite(targetMs)) return null;
  return Math.max(0, targetMs - nowMs);
}

export function formatDailyClaimCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${ss}s`;
  }
  return `${minutes}m ${ss}s`;
}

// ─── Daily claim card ────────────────────────────────────────────────────────
// Remembers if the caller already claimed today (via /api/points/history
// response OR a claim that came back with alreadyClaimedToday=true). When
// already claimed, the button greys out and becomes non-interactive until
// the next Mexico City midnight rollover.
function DailyClaimCard({ onClaimed, alreadyClaimedToday: initialClaimed, nextClaimAtUtc, onClaim }) {
  const lang = useLang();
  const [nowMs, setNowMs] = useState(Date.now());
  const [state, setState] = useState({
    loading: false,
    msg: null,
    err: null,
    streakDay: null,
    claimed: !!initialClaimed,
    nextClaimAtUtc: nextClaimAtUtc || null,
  });

  // Keep local `claimed` in sync with parent updates (e.g. after a
  // refresh of the history list).
  useEffect(() => {
    if (initialClaimed || nextClaimAtUtc) {
      setState(s => ({
        ...s,
        claimed: initialClaimed ? true : s.claimed,
        nextClaimAtUtc: nextClaimAtUtc || s.nextClaimAtUtc,
      }));
    }
  }, [initialClaimed, nextClaimAtUtc]);

  const nextClaimIso = state.nextClaimAtUtc || nextClaimAtUtc;
  const remainingMs = millisUntilIso(nextClaimIso, nowMs);
  const hasClaimTimer = remainingMs !== null;

  useEffect(() => {
    if (!state.claimed || !hasClaimTimer) return undefined;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.claimed, nextClaimIso, hasClaimTimer]);

  useEffect(() => {
    if (!state.claimed || !hasClaimTimer || remainingMs > 0) return;
    setState(s => ({
      ...s,
      claimed: false,
      msg: null,
      nextClaimAtUtc: null,
    }));
  }, [state.claimed, hasClaimTimer, remainingMs]);

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
        nextClaimAtUtc: r.nextClaimAtUtc || nextClaimIso || null,
        msg: r.alreadyClaimedToday
          ? `Ya reclamaste hoy (+${r.amount} MXNP, racha día ${r.streakDay})`
          : `+${r.amount} MXNP — Racha día ${r.streakDay}`,
      });
      onClaimed?.(r);
      onClaim?.(r);
    } catch (e) {
      setState(s => ({ ...s, loading: false, err: publicErrorMessage(e, lang, 'default') }));
    }
  }

  const locked = state.claimed;
  const buttonLabel = state.loading
    ? 'Reclamando…'
    : locked
    ? remainingMs !== null
      ? `Disponible en ${formatDailyClaimCountdown(remainingMs)}`
      : 'Ya reclamaste hoy'
    : 'Reclamar';

  return (
    <Card className="points-profile-panel">
      <div className="points-profile-eyebrow">Reclamo diario</div>
      <h3 className="points-profile-title">100 MXNP hoy, +20 MXNP por cada día consecutivo</h3>
      <p className="points-profile-description">
        Día 1 = 100 MXNP. Día 2 = 120. Día 3 = 140. El reclamo llega hasta 200 MXNP.
        Entra todos los días para mantener la racha; si te saltas un día, vuelves al día 1.
      </p>
      {state.msg && (
        <div style={{ ...noticeStyle, color: 'var(--green)' }}>{state.msg}</div>
      )}
      {state.err && (
        <div style={{ ...noticeStyle, color: 'var(--danger)' }}>{state.err}</div>
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
            background: 'var(--surface3)',
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
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          textAlign: 'center',
          marginTop: 8,
          letterSpacing: '0.04em',
        }}>
          Se reinicia a medianoche de Ciudad de México.
        </p>
      )}
    </Card>
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
      nextClaimAtUtc={status?.nextClaimAtUtc}
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
      `¡Únete a Pronos y gana MXNP prediciendo eventos reales!\n${link}`,
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
    <Card className="points-profile-panel">
      <div className="points-profile-eyebrow">Programa de referidos</div>
      <h3 className="points-profile-title">+100 MXNP por cada amigo que se registre</h3>
      <p className="points-profile-description">
        Comparte tu link único. Cuando alguien crea su cuenta usándolo, tú recibes
        <strong style={{ color: 'var(--green)' }}> 100 MXNP</strong> y ellos reciben
        <strong style={{ color: 'var(--green)' }}> 250 MXNP</strong>. El bono de invitador
        cuenta hasta 10 referidos por ciclo.
      </p>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--points-radius-md)',
        padding: '10px 12px',
        marginBottom: 12,
      }}>
        <span style={{
          flex: 1, minWidth: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
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
            borderRadius: 'var(--points-radius-sm)',
            padding: '6px 12px',
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--green)',
            cursor: 'pointer',
            letterSpacing: '0.06em',
            minWidth: 80,
          }}
        >
          {copied ? 'COPIADO' : 'COPIAR'}
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
              borderRadius: 'var(--points-radius-sm)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
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
    </Card>
  );
}

function InstallAppBonusCard({ onClaimed }) {
  const lang = useLang();
  const t = useT();
  const isMobile = useIsMobile();
  const [status, setStatus] = useState(null);
  const [standalone, setStandalone] = useState(() => isStandaloneDisplay());
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let active = true;
    fetchPwaInstallStatus()
      .then(r => { if (active) setStatus(r); })
      .catch(() => {
        if (active) setStatus({ claimed: false, amount: 50, mobileEligible: isMobile });
      });
    return () => { active = false; };
  }, [isMobile]);

  useEffect(() => {
    function update() {
      setStandalone(isStandaloneDisplay());
    }
    update();
    const mq = window.matchMedia?.('(display-mode: standalone)');
    mq?.addEventListener?.('change', update);
    mq?.addListener?.(update);
    return () => {
      mq?.removeEventListener?.('change', update);
      mq?.removeListener?.(update);
    };
  }, []);

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setDeferredPrompt(event);
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  if (!isMobile && !standalone) return null;

  const claimed = !!status?.claimed;
  const platform = installPlatform();
  const canClaim = standalone && !claimed;
  const detail = claimed
    ? t('points.earn.install.claimed')
    : canClaim
    ? t('points.earn.install.ready')
    : platform === 'ios'
    ? t('points.earn.install.ios')
    : t('points.earn.install.android');

  async function handleInstall() {
    if (!deferredPrompt) return;
    setErr(null);
    setMsg(null);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') {
        setMsg(t('points.earn.install.openFromHome'));
      }
    } finally {
      setDeferredPrompt(null);
    }
  }

  async function handleClaim() {
    if (!canClaim || busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const result = await claimPwaInstallBonus({
        standalone: true,
        displayMode: 'standalone',
        platform,
      });
      setStatus({
        claimed: true,
        amount: result.amount || 50,
        claimedAt: result.claimedAt || new Date().toISOString(),
        mobileEligible: true,
      });
      setMsg(result.alreadyClaimed
        ? t('points.earn.install.claimed')
        : `+${fmt(result.amount || 50)} MXNP`);
      onClaimed?.(result);
    } catch (e) {
      setErr(publicErrorMessage(e, lang, 'pwa_bonus_claim_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="points-profile-panel">
      <div className="points-profile-eyebrow">{t('points.earn.install.eyebrow')}</div>
      <h3 className="points-profile-title">{t('points.earn.install.title')}</h3>
      <p className="points-profile-description">{t('points.earn.install.body')}</p>
      <p className="points-profile-description points-profile-provider-note">
        {detail}
      </p>

      {msg && (
        <div style={{ ...noticeStyle, color: 'var(--green)' }}>{msg}</div>
      )}
      {err && (
        <div style={{ ...noticeStyle, color: 'var(--danger)' }}>{err}</div>
      )}

      {deferredPrompt && !standalone && !claimed && (
        <button
          className="btn-primary"
          onClick={handleInstall}
          style={{ width: '100%', padding: '12px 20px', marginTop: 16 }}
        >
          {t('points.earn.install.installButton')}
        </button>
      )}

      {canClaim && (
        <button
          className="btn-primary"
          onClick={handleClaim}
          disabled={busy}
          style={{ width: '100%', padding: '12px 20px', marginTop: 16 }}
        >
          {busy ? '...' : t('points.earn.install.claim')}
        </button>
      )}

      {claimed && (
        <div style={{
          width: '100%',
          padding: '12px 20px',
          marginTop: 16,
          background: 'var(--surface3)',
          color: 'var(--text-muted)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--points-radius-md)',
          fontFamily: 'var(--font-body)',
          fontWeight: 700,
          textAlign: 'center',
        }}>
          {t('points.earn.install.claimed')}
        </div>
      )}
    </Card>
  );
}

// ─── Social tasks ────────────────────────────────────────────────────────────
function socialTaskNetworkLabel(task) {
  const network = String(task?.network || task?.platform || '').trim().toLowerCase();
  if (network === 'x' || network === 'twitter') return 'X';
  if (network === 'instagram') return 'Instagram';
  if (network === 'tiktok') return 'TikTok';
  return '';
}

function socialTaskAccountText(task) {
  const account = task?.socialAccount || task?.social_account || null;
  return hasSocialTaskAccount(task) ? `@${String(account).trim().replace(/^@/, '')}` : null;
}

function SocialTaskRow({ task, onSubmit }) {
  const [submitting, setSubmitting] = useState(false);
  const isAutoVerify = !!task.autoVerify;
  const t = useT();
  const network = socialTaskNetworkLabel(task);
  const account = socialTaskAccountText(task);

  const status = task.status || 'not_submitted';
  const approved = status === 'approved';
  const disabled = approved || status === 'pending';
  const action = disabled
    ? status
    : isAutoVerify
      ? (status === 'rejected' ? 'verifyAgain' : 'verify')
      : (status === 'rejected' ? 'retry' : 'submit');

  async function handle(event) {
    if (disabled) return;
    setSubmitting(true);
    try {
      await onSubmit(task, event.currentTarget);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="points-profile-task-row">
      <div className="points-profile-task-copy">
        <strong>{task.label}</strong>
        <p>{task.description}</p>
        {(account || network) && (
          <p>
            {account
              ? t('points.earn.socialTask.savedAccount', { account })
              : t('points.earn.socialTask.missingAccount', { network })}
          </p>
        )}
        {status === 'rejected' && task.rejectionNote && (
          <p className="points-profile-error">{t('points.earn.socialTask.rejectionNote', { note: task.rejectionNote })}</p>
        )}
      </div>
      <div className="points-profile-task-actions">
        <span className="points-profile-reward"><span className="points-ui-number">+{task.reward}</span> MXNP</span>
        {task.url && (
          <Button as="a" href={task.url} target="_blank" rel="noopener noreferrer">
            {t('points.earn.socialTask.open')}
          </Button>
        )}
        <Button onClick={handle} disabled={disabled || submitting} variant={disabled ? 'quiet' : 'primary'}>
          {approved && <Check size={16} aria-hidden="true" />}
          {submitting ? t('points.earn.socialTask.sending') : t(`points.earn.socialTask.${action}`)}
        </Button>
      </div>
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
    label: 'X',
    icon: X,
    reward: 100,
    available: false,
    manualAllowed: true,
  },
  {
    key: 'instagram',
    label: 'Instagram',
    icon: Instagram,
    reward: 100,
    available: false,
    manualAllowed: true,
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    icon: Music2,
    reward: 100,
    available: false,
    manualAllowed: true,
  },
];

function SocialLinksCard() {
  const lang = useLang();
  const t = useT();
  const [links, setLinks] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(null);
  const [saveBusy, setSaveBusy] = useState(null);

  async function load() {
    try {
      const r = await fetchSocialLinks();
      const map = {};
      for (const l of r.links || []) map[l.provider] = l;
      setLinks(map);
      const nextDrafts = {};
      for (const provider of SOCIAL_PROVIDERS) {
        const link = map[provider.key] || {};
        nextDrafts[provider.key] = {
          handle: link.handle || '',
          isPublic: !!link.isPublic,
        };
      }
      setDrafts(nextDrafts);
    } catch (e) {
      setErr(publicErrorMessage(e, lang, 'social_link_failed'));
    }
  }
  useEffect(() => {
    load();
    window.addEventListener(SOCIAL_LINKS_CHANGED_EVENT, load);
    return () => window.removeEventListener(SOCIAL_LINKS_CHANGED_EVENT, load);
  }, []);

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
    if (linkError) {
      setOk(null);
      setErr(publicErrorMessage(linkError, lang, 'social_link_failed'));
    } else if (linked) {
      setErr(null);
      setOk(lang === 'en' ? 'Social account connected.' : 'Cuenta social conectada.');
    }
  }, []);

  function updateDraft(provider, patch) {
    setDrafts(current => ({
      ...current,
      [provider]: {
        ...(current[provider] || { handle: '', isPublic: false }),
        ...patch,
      },
    }));
    setErr(null);
    setOk(null);
  }

  async function handleConnect(provider) {
    if (!SOCIAL_PROVIDERS.find(p => p.key === provider)?.available) return;
    // Full page redirect — provider OAuth needs to navigate away.
    window.location.href = socialLinkStartUrl(provider, '/earn');
  }

  async function handleSave(provider) {
    const draft = drafts[provider] || {};
    setSaveBusy(provider);
    setErr(null);
    setOk(null);
    try {
      await saveSocialLink({
        provider,
        handle: draft.handle,
        isPublic: !!draft.isPublic,
      });
      setOk(lang === 'en' ? 'Social profile saved.' : 'Perfil social guardado.');
    } catch (e) {
      setErr(publicErrorMessage(e, lang, 'social_link_failed'));
    } finally {
      setSaveBusy(null);
    }
  }

  async function handleDisconnect(provider) {
    setBusy(provider);
    setErr(null);
    setOk(null);
    try {
      await unlinkSocial(provider);
    } catch (e) {
      setErr(publicErrorMessage(e, lang, 'social_link_failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="points-profile-panel">
      <div className="points-profile-eyebrow">{t('points.earn.socialLinks.eyebrow')}</div>
      <h3 className="points-profile-title">{t('points.earn.socialLinks.title')}</h3>
      <p className="points-profile-description">{t('points.earn.socialLinks.description')}</p>
      {err && <p role="alert" className="points-profile-notice points-profile-error">{err}</p>}
      {ok && <p role="status" className="points-profile-notice">{ok}</p>}
      <div className="points-profile-social-list">
        {SOCIAL_PROVIDERS.map(p => {
          const link = links?.[p.key] || null;
          const isLinked = !!link;
          const locked = !p.available && !p.manualAllowed && !isLinked;
          const draft = drafts[p.key] || { handle: link?.handle || '', isPublic: !!link?.isPublic };
          const canEditHandle = !isLinked || link.source === 'manual';
          const canSave = isLinked || p.manualAllowed;
          const handleValue = canEditHandle ? draft.handle : (link?.handle || '');
          const saving = saveBusy === p.key;
          const actionPending = saving || busy === p.key;
          const ProviderIcon = p.icon;
          const method = isLinked
            ? (link.verified ? 'verified' : 'manual')
            : (p.available ? 'automatic' : 'manual');
          return (
            <div key={p.key} className="points-profile-provider">
              <ProviderIcon aria-hidden="true" size={18} />
              <div>
                <div className="points-profile-provider-name">
                  <strong>{p.label}</strong>
                  <span>{t(`points.earn.socialLinks.${method}`)}</span>
                </div>
                <p className="points-profile-provider-help">
                  {isLinked
                    ? t('points.earn.socialLinks.savedAs', { handle: link.handle || '–' })
                    : t(p.manualAllowed ? 'points.earn.socialLinks.manualHelp' : 'points.earn.socialLinks.automaticHelp')}
                </p>
                {canSave && (
                  <Input
                    value={handleValue}
                    onChange={e => updateDraft(p.key, { handle: e.target.value })}
                    disabled={!canEditHandle || actionPending}
                    placeholder={t('points.earn.socialLinks.placeholder')}
                    aria-label={t('points.earn.socialLinks.username', { network: p.label })}
                  />
                )}
                <div className="points-profile-provider-actions">
                  <Checkbox
                    checked={!!draft.isPublic}
                    disabled={!canSave || actionPending}
                    onChange={e => updateDraft(p.key, { isPublic: e.target.checked })}
                  >
                    {t(draft.isPublic ? 'points.earn.socialLinks.public' : 'points.earn.socialLinks.private')}
                  </Checkbox>
                  <div>
                    {!isLinked && p.available && (
                      <Button variant="primary" onClick={() => handleConnect(p.key)}>
                        {t('points.earn.socialLinks.connect')}
                      </Button>
                    )}
                    {canSave && (
                      <Button
                        onClick={() => handleSave(p.key)}
                        disabled={actionPending || !String(draft.handle || '').trim()}
                      >
                        {saving ? '…' : t('points.earn.socialLinks.save')}
                      </Button>
                    )}
                    {isLinked && (
                      <Button onClick={() => handleDisconnect(p.key)} disabled={busy === p.key}>
                        {busy === p.key ? '…' : t('points.earn.socialLinks.remove')}
                      </Button>
                    )}
                    {locked && <Button disabled>{t('points.earn.socialLinks.soon')}</Button>}
                  </div>
                </div>
                {!p.available && (
                  <p className="points-profile-provider-note">
                    {t('points.earn.socialLinks.comingSoon', { network: p.label })}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ProfileSettingsCard({ user, onSaved }) {
  const lang = useLang();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [profileImageUrl, setProfileImageUrl] = useState(user?.profileImageUrl || '');
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || '');
  const [phoneOpen, setPhoneOpen] = useState(() => Boolean(user?.phoneRequired || user?.phoneNumber));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);
  const previewUrl = safeProfileImageUrl(profileImageUrl);
  const publicProfilePath = user?.username ? `/u/${encodeURIComponent(user.username)}` : null;

  useEffect(() => {
    setDisplayName(user?.displayName || '');
    setProfileImageUrl(user?.profileImageUrl || '');
    setPhoneNumber(user?.phoneNumber || '');
    if (user?.phoneRequired || user?.phoneNumber) setPhoneOpen(true);
  }, [user?.displayName, user?.profileImageUrl, user?.phoneNumber, user?.phoneRequired]);

  async function handleSave() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await saveProfileSettings({ displayName, profileImageUrl, phoneNumber });
      await onSaved?.();
      setOk(lang === 'en' ? 'Profile saved.' : 'Perfil guardado.');
    } catch (e) {
      setErr(publicErrorMessage(e, lang, 'profile_update_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="points-profile-panel">
      <div className="points-profile-eyebrow">{lang === 'en' ? 'Public profile' : 'Perfil público'}</div>
      <h3 className="points-profile-title">
        {lang === 'en' ? 'Personalize how others see you' : 'Personaliza cómo te ven'}
      </h3>
      <p className="points-profile-description">
        {lang === 'en'
          ? 'Add a name and profile picture for your public profile. Your email and phone stay private and are only visible to admins.'
          : 'Agrega tu nombre y foto para tu perfil público. Tu email y teléfono se mantienen privados y solo los ven admins.'}
      </p>
      {user?.phoneRequired && (
        <div style={{
          ...noticeStyle,
          color: 'var(--orange)',
          borderColor: 'rgba(255,80,0,0.35)',
          background: 'rgba(255,80,0,0.08)',
        }}>
          {lang === 'en'
            ? 'Phone verification requested: add your phone here and save your profile so the team can contact you.'
            : 'Verificación telefónica solicitada: agrega tu teléfono aquí y guarda tu perfil para que el equipo pueda contactarte.'}
        </div>
      )}
      {user?.apiBlockedAt && (
        <div style={{
          ...noticeStyle,
          color: 'var(--danger)',
          borderColor: 'rgba(239,68,68,0.4)',
          background: 'rgba(239,68,68,0.08)',
        }}>
          {lang === 'en'
            ? 'API access is blocked for this account. Contact the team if you think this is a mistake.'
            : 'El acceso API está bloqueado para esta cuenta. Contacta al equipo si crees que es un error.'}
        </div>
      )}
      {err && (
        <div style={{ ...noticeStyle, color: 'var(--danger)' }}>{err}</div>
      )}
      {ok && (
        <div style={{ ...noticeStyle, color: 'var(--green)' }}>{ok}</div>
      )}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '72px minmax(0, 1fr)',
        gap: 14,
        alignItems: 'center',
        marginTop: 16,
      }}>
        <div style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          overflow: 'hidden',
          border: '1px solid var(--border)',
          background: 'linear-gradient(135deg, rgba(255,80,0,0.22), rgba(0,232,122,0.12))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-xl)',
          lineHeight: 1,
        }}>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <span>{String(displayName || user?.username || '?').trim().slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-sm)',
            fontWeight: 800,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {displayName?.trim() || `@${user?.username || 'usuario'}`}
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            marginTop: 3,
          }}>
            @{user?.username || 'usuario'}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        <label className="points-profile-field">
          {lang === 'en' ? 'Name' : 'Nombre'}
          <Input
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setErr(null);
              setOk(null);
            }}
            maxLength={60}
            placeholder={lang === 'en' ? 'Your public name' : 'Tu nombre público'}
          />
        </label>
        <label className="points-profile-field">
          {lang === 'en' ? 'Profile picture URL' : 'URL de foto de perfil'}
          <Input
            value={profileImageUrl}
            onChange={(e) => {
              setProfileImageUrl(e.target.value);
              setErr(null);
              setOk(null);
            }}
            placeholder="https://..."
          />
        </label>
        <div className="points-profile-phone">
          <Button
            variant={user?.phoneRequired && !phoneOpen ? 'primary' : 'secondary'}
            onClick={() => setPhoneOpen(open => !open)}
            aria-describedby="profile-phone-privacy"
            aria-expanded={phoneOpen}
          >
            {phoneOpen
              ? (lang === 'en' ? 'Hide phone' : 'Ocultar teléfono')
              : phoneNumber?.trim()
                ? (lang === 'en' ? 'Edit phone' : 'Editar teléfono')
                : (lang === 'en' ? 'Add your phone' : 'Añade tu teléfono')}
          </Button>
          <p id="profile-phone-privacy" className="points-profile-hint points-profile-provider-note">
            {lang === 'en'
              ? 'Your phone number is private: only admins can see it. It will not appear on your public profile or be shared with other users.'
              : 'Tu teléfono es privado: solo los administradores pueden verlo. No se mostrará en tu perfil público ni se compartirá con otros usuarios.'}
          </p>
          {phoneOpen && (
            <label className="points-profile-field points-profile-provider-note">
              {lang === 'en' ? 'Private phone' : 'Teléfono privado'}
              <Input
                type="tel"
                aria-describedby="profile-phone-privacy"
                autoComplete="tel"
                inputMode="tel"
                value={phoneNumber}
                onChange={(e) => {
                  setPhoneNumber(e.target.value);
                  setErr(null);
                  setOk(null);
                }}
                maxLength={32}
                placeholder="+52 55 0000 0000"
              />
              <span className="points-profile-hint">
                {lang === 'en'
                  ? 'We will only use it to coordinate prizes or account review.'
                  : 'Lo usaremos solo para coordinar premios o revisión de cuenta.'}
              </span>
            </label>
          )}
        </div>
      </div>
      <div className="points-profile-settings-actions">
        <Button variant="primary" onClick={handleSave} disabled={busy}>
          {busy ? '...' : (lang === 'en' ? 'Save profile' : 'Guardar perfil')}
        </Button>
        {publicProfilePath && (
          <Button as={Link} to={publicProfilePath}>
            {lang === 'en' ? 'View public profile' : 'Ver perfil público'}
          </Button>
        )}
      </div>
    </Card>
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
  const lang = useLang();
  const translate = useT();
  const location = useLocation();
  const taskKey = new URLSearchParams(location.search).get('task');
  const [tasks, setTasks] = useState(null);
  const [accountTask, setAccountTask] = useState(null);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);

  async function load() {
    try {
      const r = await fetchSocialTaskCatalog(taskKey);
      setTasks(r.tasks);
    } catch (e) {
      setErr(publicErrorMessage(e, lang, 'load_failed'));
    }
  }
  useEffect(() => {
    load();
    window.addEventListener(SOCIAL_LINKS_CHANGED_EVENT, load);
    return () => window.removeEventListener(SOCIAL_LINKS_CHANGED_EVENT, load);
  }, [taskKey]);

  async function handleSubmit(task, trigger) {
    setErr(null);
    setOk(null);
    if (!hasSocialTaskAccount(task)) {
      setAccountTask({ task, trigger });
      return;
    }
    try {
      const result = await submitSocialTask(task.key);
      await load();
      if (result?.autoVerified) {
        setOk(lang === 'en'
          ? 'X follow verified automatically. MXNP credited.'
          : 'Follow de X verificado automáticamente. MXNP acreditado.');
      }
    } catch (e) {
      if (e?.code === 'social_account_required') {
        setAccountTask({ task, trigger });
        return;
      }
      if ((e?.code === 'x_account_required' || e?.code === 'x_reconnect_required')
        && task?.requiresProvider === 'x') {
        window.location.href = socialLinkStartUrl('x', '/earn');
        return;
      }
      setErr(publicErrorMessage(e, lang, 'default'));
    }
  }

  return (
    <Card className="points-profile-panel">
      {accountTask && <SocialTaskAccountPrompt key={accountTask.task.key} task={accountTask.task}
        returnFocusTo={accountTask.trigger}
        onCancel={() => setAccountTask(null)} onSaved={async link => {
          const task = { ...accountTask.task, socialAccount: link.handle };
          setAccountTask(null);
          await handleSubmit(task, accountTask.trigger);
        }} />}
      <div className="points-profile-eyebrow">{translate('points.earn.socialTask.eyebrow')}</div>
      <h3 className="points-profile-title">{translate('points.earn.socialTask.title')}</h3>
      <p className="points-profile-description">{translate('points.earn.socialTask.description')}</p>
      {err && <p role="alert" className="points-profile-notice points-profile-error">{err}</p>}
      {ok && <p role="status" className="points-profile-notice">{ok}</p>}
      {!tasks && !err && (
        <p className="points-profile-provider-note">{translate('points.earn.socialTask.loading')}</p>
      )}
      {tasks && (
        <div className="points-profile-task-list">
          {tasks.map(t => <SocialTaskRow key={t.key} task={t} onSubmit={handleSubmit} />)}
          {tasks.length === 0 && (
            <p className="points-profile-provider-note">{translate('points.earn.socialTask.empty')}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function DeveloperApiCard() {
  const lang = useLang();
  const copy = lang === 'en'
    ? {
        eyebrow: 'Developer access',
        title: 'API access',
        body: 'Create a key only if you are building bots, dashboards, or internal tooling. Keep secrets private and rotate keys you stop using.',
        meta: 'Phone verification may be required before higher-risk usage is approved.',
        cta: 'Create API key',
      }
    : {
        eyebrow: 'Acceso developer',
        title: 'Acceso API',
        body: 'Crea una key solo si vas a construir bots, dashboards o herramientas internas. Mantén tus secretos privados y revoca keys que ya no uses.',
        meta: 'Podemos pedir verificación telefónica antes de aprobar uso de mayor riesgo.',
        cta: 'Crear API key',
      };

  return (
    <Card className="points-profile-panel">
      <div className="points-profile-eyebrow">{copy.eyebrow}</div>
      <h3 className="points-profile-title">{copy.title}</h3>
      <p className="points-profile-description">{copy.body}</p>
      <p className="points-profile-description points-profile-provider-note">
        {copy.meta}
      </p>
      <Link
        to="/developer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 44,
          width: '100%',
          marginTop: 18,
          padding: '12px 18px',
          borderRadius: 'var(--points-radius-sm)',
          background: 'transparent',
          border: '1px solid rgba(255, 85, 0, 0.5)',
          color: 'var(--orange)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          fontWeight: 900,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          textDecoration: 'none',
        }}
      >
        {copy.cta}
      </Link>
    </Card>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function PointsEarn({ onOpenLogin }) {
  const navigate = useNavigate();
  const { authenticated, user, loading, refresh } = usePointsAuth();
  const isMobile = useIsMobile();
  const lang = useLang();
  const t = useT();

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
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', marginBottom: 16 }}>
          {t('points.earn.title')}
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
          Crea tu cuenta (gratis) para ver tu racha, referir amigos, y completar tareas sociales.
        </p>
        <button className="btn-primary" onClick={onOpenLogin} style={{ padding: '12px 24px' }}>
          {lang === 'en' ? 'Log In' : 'Únete'}
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
          {t('points.earn.title')}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
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
        <ProfileSettingsCard user={user} onSaved={refresh} />
        <DailyClaimCardWithStatus onClaimed={refresh} />
        <ReferralCard />
        <InstallAppBonusCard onClaimed={refresh} />
      </div>

      <div style={{ marginTop: 24 }}>
        <SocialLinksCard />
      </div>

      <div style={{ marginTop: 24 }}>
        <SocialTasksCard />
      </div>

      <div style={{ marginTop: 24, maxWidth: 520 }}>
        <DeveloperApiCard />
      </div>

      <div style={{
        marginTop: 32,
        padding: '12px 16px',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--points-radius-md)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-muted)',
        lineHeight: 1.7,
      }}>
        MXNP son puntos de la competencia. No tienen valor económico directo.
        Los ciclos de premios están pausados por ahora y vuelven pronto. Verificación
        manual de tareas sociales en &lt;24 h.
      </div>
    </main>
  );
}

// ─── Shared styles ──────────────────────────────────────────────────────────
const noticeStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  padding: '10px 12px',
  borderRadius: 'var(--points-radius-sm)',
  marginTop: 12,
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
};

const statBoxStyle = {
  padding: '12px 14px',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--points-radius-md)',
  textAlign: 'center',
};

const statLabelStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  letterSpacing: '0.1em',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  marginBottom: 4,
};

const statValStyle = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--text-lg)',
  letterSpacing: '0.02em',
};
