/**
 * EarnMXNP — MVP placeholder.
 *
 * The full Earn screen (daily claim, streaks, cycles, leaderboard) lives
 * in the Points app. For the on-chain MVP it's reduced to the two pieces
 * worth keeping until mainnet:
 *
 *   1. Social linking — OAuth via /api/social/:provider/start and
 *      /api/points/social-links so users can connect X / Instagram /
 *      TikTok. Rewards are NOT credited until mainnet; today the link
 *      just records the association.
 *   2. Referrals — every user has a /r/<username> landing; this component
 *      surfaces a copyable link + basic share buttons. Referrer credit
 *      also rolls over to mainnet.
 *
 * No MXNP balance, no streak counter, no daily-claim button. All mxp-
 * earning UI was intentionally stripped for the testnet MVP.
 */
import React, { useEffect, useState } from 'react';
import { usePointsAuth } from '../lib/pointsAuth.js';
import {
  fetchSocialLinks,
  socialLinkStartUrl,
  unlinkSocial,
} from '../lib/socialLinks.js';

const IG_PROFILE = 'https://www.instagram.com/pronos.latam/';
const TT_PROFILE = 'https://www.tiktok.com/@pronosmarkets';
const X_PROFILE  = 'https://twitter.com/pronos_io';

function buildShareUrl(platform, link) {
  const text = encodeURIComponent(`¡Únete a Pronos y predice eventos reales! 🎯\n${link}`);
  const url = encodeURIComponent(link);
  if (platform === 'whatsapp')  return `https://wa.me/?text=${text}`;
  if (platform === 'twitter')   return `https://twitter.com/intent/tweet?text=${text}`;
  if (platform === 'telegram')  return `https://t.me/share/url?url=${url}&text=${encodeURIComponent('¡Únete a Pronos! 🎯')}`;
  return link;
}

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

const SOCIAL_PROVIDERS = [
  {
    key: 'x',
    label: 'X (Twitter)',
    icon: '𝕏',
    href: X_PROFILE,
    available: true,
    comingSoonNote: null,
  },
  {
    key: 'instagram',
    label: 'Instagram',
    icon: '📸',
    href: IG_PROFILE,
    available: false,
    comingSoonNote: 'Esperando aprobación de Meta',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    icon: '🎵',
    href: TT_PROFILE,
    available: true,
    comingSoonNote: null,
  },
];

function SocialRow({
  icon,
  label,
  href,
  connected,
  connectedLabel,
  available,
  comingSoonNote,
  busy,
  onConnect,
  onDisconnect,
}) {
  const locked = !available && !connected;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 0', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 20, flexShrink: 0, width: 28, textAlign: 'center' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-body)', lineHeight: 1.3 }}>
          {label}
        </div>
        {connected ? (
          <div style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            ✓ {connectedLabel || 'Vinculado'}
          </div>
        ) : locked ? (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            {comingSoonNote || 'Próximamente'}
          </div>
        ) : href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', gap: 4, alignItems: 'center', marginTop: 4,
              fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
              textDecoration: 'none', letterSpacing: '0.04em',
            }}
          >
            VER PERFIL ↗
          </a>
        ) : null}
      </div>
      {connected ? (
        <button
          onClick={onDisconnect}
          disabled={busy}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '5px 12px',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-muted)',
            cursor: busy ? 'wait' : 'pointer',
            letterSpacing: '0.06em',
            flexShrink: 0,
            minWidth: 104,
            textAlign: 'center',
          }}
        >
          {busy ? '…' : 'DESCONECTAR'}
        </button>
      ) : (
        <button
          onClick={onConnect}
          disabled={locked || busy}
          style={{
            background: locked ? 'var(--surface2)' : 'rgba(0,232,122,0.1)',
            border: locked ? '1px solid var(--border)' : '1px solid rgba(0,232,122,0.3)',
            borderRadius: 8, padding: '5px 12px', fontSize: 10,
            fontFamily: 'var(--font-mono)', color: locked ? 'var(--text-muted)' : 'var(--green)',
            cursor: locked || busy ? 'not-allowed' : 'pointer',
            letterSpacing: '0.06em',
            flexShrink: 0,
            minWidth: 104,
            opacity: locked || busy ? 0.65 : 1,
          }}
        >
          {locked ? 'PRÓXIMAMENTE' : 'CONECTAR'}
        </button>
      )}
    </div>
  );
}

export default function EarnMXNP() {
  const { authenticated, user } = usePointsAuth();
  const [links, setLinks] = useState({ x: null, instagram: null, tiktok: null });
  const [socialError, setSocialError] = useState('');
  const [socialNotice, setSocialNotice] = useState('');
  const [busySocial, setBusySocial] = useState(null);
  const [copied, setCopied] = useState(false);

  const username = user?.username || null;
  const referralLink = username ? `https://pronos.io/r/${username}` : '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const linked = url.searchParams.get('linked');
    const linkError = url.searchParams.get('link_error');
    if (linked || linkError) {
      url.searchParams.delete('linked');
      url.searchParams.delete('link_error');
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    }
    if (linked) setSocialNotice(`${linked} vinculado correctamente.`);
    if (linkError) setSocialError(linkError);
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setLinks({ x: null, instagram: null, tiktok: null });
      return;
    }
    let alive = true;
    fetchSocialLinks()
      .then((nextLinks) => {
        if (alive) setLinks(nextLinks);
      })
      .catch((e) => {
        if (alive) setSocialError(e?.code || e?.message || 'social_links_failed');
      });
    return () => { alive = false; };
  }, [authenticated]);

  function handleConnect(provider) {
    window.location.href = socialLinkStartUrl(provider, '/mvp/portfolio');
  }

  async function handleDisconnect(provider) {
    setBusySocial(provider);
    setSocialError('');
    setSocialNotice('');
    try {
      await unlinkSocial(provider);
      setLinks(await fetchSocialLinks());
    } catch (e) {
      setSocialError(e?.code || e?.message || 'unlink_failed');
    } finally {
      setBusySocial(null);
    }
  }

  function copyReferral() {
    if (!referralLink) return;
    try {
      navigator.clipboard?.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  return (
    <div style={{
      padding: 20,
      border: '1px solid var(--border)',
      borderRadius: 14,
      background: 'var(--surface1)',
      marginTop: 20,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 6, gap: 12,
      }}>
        <div>
          <SectionLabel>Conectar cuentas</SectionLabel>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
            Verificamos tu cuenta directamente con la red social. Las recompensas se acreditan a partir del lanzamiento en mainnet.
          </div>
        </div>
      </div>

      {socialNotice && (
        <div style={{
          marginTop: 12,
          padding: '10px 12px',
          borderRadius: 8,
          background: 'rgba(0,232,122,0.08)',
          border: '1px solid rgba(0,232,122,0.24)',
          color: 'var(--green)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
        }}>
          {socialNotice}
        </div>
      )}
      {socialError && (
        <div style={{
          marginTop: 12,
          padding: '10px 12px',
          borderRadius: 8,
          background: 'rgba(255,69,69,0.08)',
          border: '1px solid rgba(255,69,69,0.24)',
          color: 'var(--red)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
        }}>
          Error: {socialError}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {SOCIAL_PROVIDERS.map((provider) => {
          const linked = links[provider.key] || null;
          return (
            <SocialRow
              key={provider.key}
              icon={provider.icon}
              label={`Vincula tu cuenta de ${provider.label}`}
              href={provider.href}
              connected={!!linked}
              connectedLabel={linked?.handle ? `@${linked.handle}` : null}
              available={provider.available}
              comingSoonNote={provider.comingSoonNote}
              busy={busySocial === provider.key}
              onConnect={() => handleConnect(provider.key)}
              onDisconnect={() => handleDisconnect(provider.key)}
            />
          );
        })}
      </div>

      {/* Referrals */}
      <div style={{ marginTop: 24 }}>
        <SectionLabel>Invita amigos</SectionLabel>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginBottom: 12, lineHeight: 1.5 }}>
          Cada referido que invites cuenta para tu historial. Las recompensas por referidos también se activan en mainnet.
        </div>

        {referralLink ? (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 12px', borderRadius: 8, background: 'var(--surface2)',
              marginBottom: 12, fontFamily: 'var(--font-mono)', fontSize: 12,
              border: '1px solid var(--border)',
            }}>
              <span style={{ flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {referralLink}
              </span>
              <button
                onClick={copyReferral}
                style={{
                  background: copied ? 'rgba(0,232,122,0.15)' : 'transparent',
                  border: '1px solid rgba(0,232,122,0.3)',
                  borderRadius: 6, padding: '4px 10px',
                  color: 'var(--green)', fontFamily: 'var(--font-mono)',
                  fontSize: 10, cursor: 'pointer', letterSpacing: '0.06em',
                }}
              >
                {copied ? '✓ COPIADO' : 'COPIAR'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { p: 'whatsapp', label: 'WhatsApp' },
                { p: 'twitter',  label: 'X'        },
                { p: 'telegram', label: 'Telegram' },
              ].map(s => (
                <a
                  key={s.p}
                  href={buildShareUrl(s.p, referralLink)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1, minWidth: 100, textAlign: 'center',
                    padding: '8px 12px', borderRadius: 8,
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)',
                    textDecoration: 'none', letterSpacing: '0.06em',
                  }}
                >
                  {s.label.toUpperCase()}
                </a>
              ))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Necesitas un nombre de usuario para generar tu link de referidos.
          </div>
        )}
      </div>
    </div>
  );
}
