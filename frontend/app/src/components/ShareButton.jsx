/**
 * ShareButton — opens a popover with platform-specific share options
 * (WhatsApp, X, Telegram, Instagram-via-copy, Email, Copy link). On
 * touch devices that support `navigator.share` we ALSO offer the OS
 * native share sheet at the top of the menu.
 *
 * Why a popover instead of just calling navigator.share: on desktop
 * (and many embedded browsers) navigator.share isn't available, so
 * the previous implementation fell through to clipboard-copy and the
 * user had no obvious way to push the link into a specific app. The
 * popover gives an explicit "share to WhatsApp / X / Telegram"
 * affordance regardless of platform.
 *
 * Each platform button opens the platform's share intent in a new
 * tab. Instagram has no URL-based share intent so we copy the link
 * and surface a "Copia el link y pégalo en Instagram" toast — same
 * as how Twitter/Spotify/etc. handle IG sharing.
 *
 * The shared URL points at /api/share/market?id=N&app=X — that
 * endpoint serves a crawler-friendly HTML stub with proper OG /
 * Twitter Card meta tags pointing at /api/og/market?id=N (1200×630
 * dynamic preview), then redirects humans to the SPA route. So
 * WhatsApp/Telegram/X show a real market card preview, not a
 * generic Pronos logo.
 *
 * Props:
 *   marketId  — numeric points_markets.id
 *   app       — 'points' (default) | 'mvp'
 *   question  — used as share text (`title` for native share)
 *   compact   — if true, render a tiny icon-only button (for tight rows)
 */
import React, { useState, useEffect, useRef } from 'react';

const PLATFORMS = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: '🟢',
    // wa.me allows omitting the recipient phone — opens chat picker
    intent: ({ url, text }) =>
      `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
  {
    id: 'x',
    label: 'X',
    icon: '𝕏',
    intent: ({ url, text }) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    icon: '✈',
    intent: ({ url, text }) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    id: 'instagram',
    label: 'Instagram',
    icon: '📷',
    // Instagram has no URL share intent. We copy the link and toast
    // the user to paste it. This is how every other app handles IG.
    intent: null,
  },
  {
    id: 'email',
    label: 'Email',
    icon: '✉',
    intent: ({ url, text }) =>
      `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(url)}`,
  },
];

export default function ShareButton({ marketId, app = 'points', question, compact = false }) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const popoverRef = useRef(null);
  const wrapRef = useRef(null);

  if (!marketId) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://pronos.io';
  const shareUrl = `${origin}/api/share/market?id=${marketId}&app=${app}`;
  const shareText = question
    ? `${question} · Pronos`
    : 'Mira este mercado en Pronos';

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function flashToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  async function copyToClipboard() {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const ta = document.createElement('textarea');
        ta.value = shareUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function handlePlatform(p) {
    if (p.id === 'instagram') {
      // Copy + toast — IG has no share intent URL.
      const ok = await copyToClipboard();
      flashToast(ok ? 'Link copiado — pégalo en Instagram' : 'No se pudo copiar');
      setOpen(false);
      return;
    }
    if (p.intent) {
      const url = p.intent({ url: shareUrl, text: shareText });
      // _blank with noopener — never give the share host opener access
      // to our window. Telegram in particular has used this in the past
      // to redirect the originating tab.
      window.open(url, '_blank', 'noopener,noreferrer');
      setOpen(false);
    }
  }

  async function handleCopy() {
    const ok = await copyToClipboard();
    flashToast(ok ? '✓ Link copiado' : 'No se pudo copiar');
    setOpen(false);
  }

  async function handleNative() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Pronos', text: shareText, url: shareUrl });
      } catch (e) {
        if (e?.name !== 'AbortError') flashToast('Cancelado');
      }
      setOpen(false);
    }
  }

  const hasNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  const triggerLabel = compact
    ? '🔗'
    : (toast || 'Compartir');

  const triggerStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: compact ? '6px 10px' : '8px 14px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: toast ? 'rgba(0,232,122,0.10)' : 'var(--surface2)',
    color: toast ? 'var(--green)' : 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    letterSpacing: '0.04em',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={triggerStyle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Compartir mercado"
        title={shareUrl}
      >
        {!compact && <span aria-hidden="true">🔗</span>}
        {triggerLabel}
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 200,
            background: 'var(--surface1)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 6,
            boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            fontFamily: 'var(--font-sans, sans-serif)',
          }}
        >
          {hasNativeShare && (
            <ShareMenuItem icon="📤" label="Compartir…" onClick={handleNative} />
          )}
          {PLATFORMS.map(p => (
            <ShareMenuItem
              key={p.id}
              icon={p.icon}
              label={p.label}
              onClick={() => handlePlatform(p)}
            />
          ))}
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />
          <ShareMenuItem icon="🔗" label="Copiar link" onClick={handleCopy} />
        </div>
      )}
    </div>
  );
}

function ShareMenuItem({ icon, label, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 8,
        border: 'none',
        background: 'transparent',
        color: 'var(--text-primary)',
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span aria-hidden="true" style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
