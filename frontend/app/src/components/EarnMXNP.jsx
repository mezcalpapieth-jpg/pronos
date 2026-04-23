/**
 * EarnMXNP — MVP placeholder.
 *
 * The full Earn screen (daily claim, streaks, cycles, leaderboard) lives
 * in the Points app. For the on-chain MVP it's reduced to the two pieces
 * worth keeping until mainnet:
 *
 *   1. Social linking — OAuth via /api/points/social/* so users can
 *      connect X / Instagram / TikTok. Rewards are NOT credited until
 *      mainnet; today the link just records the association.
 *   2. Referrals — every user has a /r/<username> landing; this component
 *      surfaces a copyable link + basic share buttons. Referrer credit
 *      also rolls over to mainnet.
 *
 * No MXNP balance, no streak counter, no daily-claim button. All mxp-
 * earning UI was intentionally stripped for the testnet MVP.
 */
import React, { useEffect, useState } from 'react';
import { usePointsAuth } from '../lib/pointsAuth.js';

const IG_PROFILE = 'https://www.instagram.com/pronos.latam/';
const TT_PROFILE = 'https://www.tiktok.com/@pronos.io';
const X_PROFILE  = 'https://twitter.com/pronos_io';

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function socialStartUrl(provider, returnTo = '/mvp/portfolio') {
  return `/api/points/social/start?provider=${encodeURIComponent(provider)}&returnTo=${encodeURIComponent(returnTo)}`;
}

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

function SocialRow({ icon, label, href, connected, connectedLabel, onConnect }) {
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
        <span style={{
          padding: '5px 12px',
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--text-muted)', letterSpacing: '0.06em',
          flexShrink: 0, minWidth: 84, textAlign: 'center',
        }}>
          CONECTADO
        </span>
      ) : (
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

export default function EarnMXNP() {
  const { authenticated, user } = usePointsAuth();
  const [links, setLinks] = useState({ twitter: null, instagram: null, tiktok: null });
  const [copied, setCopied] = useState(false);

  const username = user?.username || null;
  const referralLink = username ? `https://pronos.io/r/${username}` : '';

  // Pull linked social accounts from the server. Safe no-op if the
  // endpoint isn't present yet — we just render "not linked" state.
  useEffect(() => {
    if (!authenticated) return;
    let alive = true;
    getJson('/api/points/social/links')
      .then(({ ok, data }) => {
        if (!alive || !ok) return;
        setLinks({
          twitter:   data?.links?.twitter || null,
          instagram: data?.links?.instagram || null,
          tiktok:    data?.links?.tiktok || null,
        });
      })
      .catch(() => { /* optional endpoint */ });
    return () => { alive = false; };
  }, [authenticated]);

  function handleConnect(provider) {
    window.location.href = socialStartUrl(provider);
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
            Las recompensas por conectar redes se acreditan a partir del lanzamiento en mainnet.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <SocialRow
          icon="𝕏"
          label="Vincula tu cuenta de X (Twitter)"
          href={X_PROFILE}
          connected={!!links.twitter}
          connectedLabel={links.twitter?.handle ? `@${links.twitter.handle}` : null}
          onConnect={() => handleConnect('twitter')}
        />
        <SocialRow
          icon="📸"
          label="Vincula tu cuenta de Instagram"
          href={IG_PROFILE}
          connected={!!links.instagram}
          connectedLabel={links.instagram?.handle ? `@${links.instagram.handle}` : null}
          onConnect={() => handleConnect('instagram')}
        />
        <SocialRow
          icon="🎵"
          label="Vincula tu cuenta de TikTok"
          href={TT_PROFILE}
          connected={!!links.tiktok}
          connectedLabel={links.tiktok?.handle ? `@${links.tiktok.handle}` : null}
          onConnect={() => handleConnect('tiktok')}
        />
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
