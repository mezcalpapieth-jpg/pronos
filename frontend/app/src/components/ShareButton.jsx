/**
 * ShareButton — opens a native share sheet on mobile, or copies the
 * share URL to clipboard with a "Copiado" toast on desktop.
 *
 * Used by both Points and MVP market detail pages. Renders a single
 * pill-shaped button that links to `/api/share/market?id=<id>&app=<which>`,
 * which is our crawler-friendly OG-tagged HTML wrapper. Bots see the
 * preview, humans get redirected to the actual SPA route.
 *
 * Props:
 *   marketId  — numeric points_markets.id
 *   app       — 'points' (default) | 'mvp'
 *   question  — used as the share text title (`title` for native share)
 *   compact   — if true, render a tiny icon-only button (for tight rows)
 */
import React, { useState } from 'react';

export default function ShareButton({ marketId, app = 'points', question, compact = false }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  if (!marketId) return null;

  // Build absolute URL so WhatsApp/Twitter previews resolve correctly.
  // Falls back to relative path if window isn't available (SSR-safe).
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://pronos.io';
  const shareUrl = `${origin}/api/share/market?id=${marketId}&app=${app}`;
  const shareText = question
    ? `${question} · Pronos`
    : 'Mira este mercado en Pronos';

  async function handleClick() {
    setError(null);
    // Native share sheet — works on iOS Safari, Android Chrome, etc.
    // Falls through to clipboard copy when unavailable (most desktop browsers).
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Pronos',
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch (e) {
        // User dismissed the sheet — silent. Real errors fall through
        // to clipboard so they at least get the URL.
        if (e?.name === 'AbortError') return;
      }
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        // Last-resort fallback: ancient browsers without clipboard API.
        const ta = document.createElement('textarea');
        ta.value = shareUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      setError('No se pudo copiar');
      setTimeout(() => setError(null), 2400);
    }
  }

  const label = compact
    ? (copied ? '✓' : error ? '✕' : '🔗')
    : (copied ? '✓ Copiado' : error || 'Compartir');

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: compact ? '6px 10px' : '8px 14px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: copied ? 'rgba(0,232,122,0.10)' : error ? 'rgba(255,69,69,0.10)' : 'var(--surface2)',
    color: copied ? 'var(--green)' : error ? 'var(--red)' : 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    fontSize: compact ? 12 : 12,
    letterSpacing: '0.04em',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      style={baseStyle}
      title={shareUrl}
      aria-label="Compartir mercado"
    >
      {!compact && <span aria-hidden="true">🔗</span>}
      {label}
    </button>
  );
}
