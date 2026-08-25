/**
 * PointsUserProfile — /u/:username
 *
 * Public read-only profile page. Anyone can land here (no auth) and
 * see a user's active positions, settled history, and aggregate PnL.
 * Driven by /api/points/u?username=<name>; everything else (the data
 * shape, layout, MXNP formatting) mirrors the Portfolio page so users
 * recognize what they're looking at.
 *
 * Public surface — keep it bounded:
 *   - No private fields (email, wallet address, balance ledger rows).
 *   - 404 on unknown usernames so we don't leak existence.
 *   - Active + history lists capped server-side at whatever the
 *     /u endpoint returns (no client-side override).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { historyPnlValue } from '../lib/historyPnl.js';
import { fetchPnlHistory } from '../lib/pointsApi.js';
import PnlChartCard from '../components/PnlChartCard.jsx';

function fmt(n, d = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

const STATUS_LABEL = {
  won:     { label: 'Ganó',    bg: 'rgba(0,232,122,0.12)', fg: 'var(--green)' },
  lost:    { label: 'Perdió',  bg: 'rgba(255,69,69,0.10)',  fg: 'var(--danger)' },
  pending: { label: 'Pendiente', bg: 'rgba(245,158,11,0.12)', fg: 'var(--warning)' },
  exited:  { label: 'Salió',   bg: 'var(--surface2)',       fg: 'var(--text-muted)' },
  canceled:{ label: 'Anulado', bg: 'rgba(148,163,184,0.08)', fg: 'var(--text-muted)' },
  open:    { label: 'Abierta', bg: 'rgba(59,130,246,0.12)', fg: 'var(--info)' },
};

const SOCIAL_STATUS_LABEL = {
  approved: { label: 'Aprobada', bg: 'rgba(0,232,122,0.12)', fg: 'var(--green)' },
  pending:  { label: 'Pendiente', bg: 'rgba(245,158,11,0.12)', fg: 'var(--warning)' },
  rejected: { label: 'Rechazada', bg: 'rgba(255,69,69,0.10)', fg: 'var(--danger)' },
};

function safeExternalHref(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    return null;
  }
  return null;
}

function ProfileAvatar({ src, name, username, size = 72 }) {
  const [broken, setBroken] = useState(false);
  const safeSrc = safeExternalHref(src);
  useEffect(() => { setBroken(false); }, [safeSrc]);
  const initial = String(name || username || '?').trim().slice(0, 1).toUpperCase() || '?';

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      overflow: 'hidden',
      flex: '0 0 auto',
      border: '1px solid var(--border)',
      background: 'linear-gradient(135deg, rgba(255,80,0,0.22), rgba(0,232,122,0.12))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-display)',
      fontSize: Math.max(22, Math.round(size * 0.38)),
      lineHeight: 1,
    }}>
      {safeSrc && !broken ? (
        <img
          src={safeSrc}
          alt=""
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}

function decodeUsername(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function usernameFromProfileLocation(paramUsername, pathname, search) {
  const direct = String(paramUsername || '').trim();
  if (direct) return direct;

  const pathMatch = String(pathname || '').match(/(?:^|\/)u\/([^/?#]+)/);
  if (pathMatch?.[1]) return decodeUsername(pathMatch[1]);

  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const rewrittenUsername = params.get('username') || params.get('profile') || params.get('u');
  if (rewrittenUsername) return String(rewrittenUsername).trim();

  const rewrittenPath = String(params.get('path') || '').trim();
  const queryPathMatch = rewrittenPath.match(/(?:^|\/)u\/([^/?#]+)/);
  if (queryPathMatch?.[1]) return decodeUsername(queryPathMatch[1]);

  return '';
}

function pickedOutcomeLabelFromTransactions(transactions = []) {
  const picked = new Map();
  for (const tx of transactions || []) {
    if (tx?.side !== 'buy') continue;
    const label = String(tx.outcomeLabel || '').trim();
    if (!label || label === '—') continue;
    const key = Number.isInteger(Number(tx.outcomeIndex))
      ? String(tx.outcomeIndex)
      : label.toLowerCase();
    const current = picked.get(key) || { label, collateral: 0, shares: 0 };
    current.collateral += Number(tx.collateral || 0);
    current.shares += Number(tx.shares || 0);
    picked.set(key, current);
  }
  return Array.from(picked.values())
    .sort((a, b) => (b.collateral - a.collateral) || (b.shares - a.shares))
    .map(item => item.label)
    .join(', ');
}

export default function PointsUserProfile() {
  const { username: paramUsername } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('activo'); // 'activo' | 'historial'
  const [pnlSeries, setPnlSeries] = useState([]);
  const [pnlLoading, setPnlLoading] = useState(true);
  const [pnlRange, setPnlRange] = useState(0); // 0 = since first trade
  const [pnlCycleScope, setPnlCycleScope] = useState('current');
  const [currentCyclePnl, setCurrentCyclePnl] = useState(null);
  const backTarget = typeof location.state?.from === 'string' && location.state.from.startsWith('/')
    ? location.state.from
    : null;
  const profileUsername = useMemo(
    () => usernameFromProfileLocation(paramUsername, location.pathname, location.search),
    [paramUsername, location.pathname, location.search],
  );

  function handleBack() {
    if (backTarget) {
      navigate(backTarget);
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/portfolio');
  }

  useEffect(() => {
    let cancelled = false;
    const username = String(profileUsername || '').trim();
    setCurrentCyclePnl(null);
    setLoading(true);
    setError(null);
    setData(null);
    async function loadProfile() {
      if (!username) {
        setError('user_not_found');
        return;
      }
      const base = `/api/points/u?username=${encodeURIComponent(username)}`;
      const attempts = [
        { url: base, credentials: 'include' },
        { url: `${base}&_=${Date.now()}`, credentials: 'include' },
        { url: `${base}&public=1&_=${Date.now()}`, credentials: 'omit' },
      ];
      for (let i = 0; i < attempts.length; i += 1) {
        const attempt = attempts[i];
        const r = await fetch(attempt.url, {
          credentials: attempt.credentials,
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (cancelled) return;
        if (r.status === 404 && i === 0) continue;
        if (r.status === 404) { setError('user_not_found'); return; }
        if (!r.ok && attempt.credentials !== 'omit') continue;
        if (!r.ok) { setError('load_failed'); return; }
        const json = await r.json().catch(() => null);
        if (!json?.user) { setError('load_failed'); return; }
        setData(json);
        return;
      }
    }
    loadProfile()
      .catch(() => { if (!cancelled) setError('load_failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [profileUsername]);

  // Kept out of the profile fetch above: the chart is additive, so it must
  // never delay or fail the page that carries the actual profile data.
  useEffect(() => {
    let cancelled = false;
    const username = String(profileUsername || '').trim();
    if (!username) { setPnlSeries([]); setPnlLoading(false); return undefined; }
    setPnlLoading(true);
    fetchPnlHistory({ username, days: pnlRange, cycle: pnlCycleScope })
      .then(({ series }) => { if (!cancelled) setPnlSeries(series || []); })
      .finally(() => { if (!cancelled) setPnlLoading(false); });
    return () => { cancelled = true; };
  }, [profileUsername, pnlRange, pnlCycleScope]);

  useEffect(() => {
    let cancelled = false;
    const username = String(profileUsername || '').trim();
    if (!username) { setCurrentCyclePnl(null); return undefined; }
    fetchPnlHistory({ username, days: 0, cycle: 'current' })
      .then(({ current }) => {
        if (!cancelled) setCurrentCyclePnl(Number(current || 0));
      })
      .catch(() => {
        if (!cancelled) setCurrentCyclePnl(null);
      });
    return () => { cancelled = true; };
  }, [profileUsername]);

  const pnlColor = useMemo(() => {
    if (!data) return 'var(--text-primary)';
    return data.stats.totalPnl > 0 ? 'var(--success)'
      : data.stats.totalPnl < 0 ? 'var(--danger)' : 'var(--text-primary)';
  }, [data]);

  const currentPnlColor = useMemo(() => {
    const value = Number(currentCyclePnl);
    if (!Number.isFinite(value)) return 'var(--text-primary)';
    return value > 0 ? 'var(--success)' : value < 0 ? 'var(--danger)' : 'var(--text-primary)';
  }, [currentCyclePnl]);

  if (loading) {
    return (
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(20px, 4vw, 36px)' }}>
        <div style={{ textAlign: 'center', padding: 60, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
          Cargando perfil…
        </div>
      </main>
    );
  }

  if (error === 'user_not_found') {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(20px, 4vw, 36px)' }}>
        <div style={{
          padding: 40, textAlign: 'center',
          background: 'var(--surface1)', border: '1px solid var(--border)',
          borderRadius: 14,
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, marginBottom: 8 }}>
            Usuario no encontrado
          </div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
            No tenemos un perfil para <strong>@{profileUsername || paramUsername}</strong>.
          </p>
          <button
            onClick={handleBack}
            style={{
              marginTop: 12, padding: '10px 18px', background: 'var(--surface2)',
              border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-primary)', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 12,
            }}
          >
            ← Volver
          </button>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(20px, 4vw, 36px)' }}>
        <div style={{
          padding: 40, textAlign: 'center',
          background: 'var(--surface1)', border: '1px solid var(--border)',
          borderRadius: 14,
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, marginBottom: 8 }}>
            No pudimos cargar el perfil
          </div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
            El perfil existe, pero hubo un error al cargarlo. Recarga la página o intenta de nuevo.
          </p>
          <button
            onClick={() => { window.location.reload(); }}
            style={{
              marginTop: 12, padding: '10px 18px', background: 'var(--surface2)',
              border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-primary)', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 12,
            }}
          >
            Recargar
          </button>
        </div>
      </main>
    );
  }

  const { user, stats, active, history } = data;
  const balance = Number(user.balance ?? user.currentBalance ?? stats.currentBalance ?? 0);
  const currentPnlValue = currentCyclePnl == null ? null : Number(currentCyclePnl);
  const publicSocialLinks = Array.isArray(user.socialLinks) ? user.socialLinks : [];
  const displayName = String(user.displayName || '').trim();
  const profileImageUrl = safeExternalHref(user.profileImageUrl);
  const showAdminSocials = Object.prototype.hasOwnProperty.call(user, 'adminSocials')
    || Object.prototype.hasOwnProperty.call(user, 'adminSocialLinks');

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(20px, 4vw, 36px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <ProfileAvatar src={profileImageUrl} name={displayName} username={user.username} />
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 11,
              letterSpacing: '0.14em', color: 'var(--text-muted)',
              textTransform: 'uppercase', marginBottom: 4,
            }}>
              Perfil público
            </div>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 5vw, 42px)',
              color: 'var(--text-primary)', margin: 0, letterSpacing: '0.02em',
              overflowWrap: 'anywhere',
            }}>
              {displayName || `@${user.username}`}
            </h1>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {displayName ? `@${user.username} · ` : ''}Miembro desde {fmtDate(user.joinedAt)}
            </div>
          </div>
        </div>
        <button
          onClick={handleBack}
          style={{
            padding: '8px 14px', background: 'var(--surface2)',
            border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--text-secondary)', cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
          }}
        >
          ← Volver
        </button>
      </div>

      {publicSocialLinks.length > 0 && (
        <PublicSocialLinksPanel links={publicSocialLinks} />
      )}

      {showAdminSocials && (
        <AdminSocialsPanel
          rows={Array.isArray(user.adminSocials) ? user.adminSocials : []}
          links={Array.isArray(user.adminSocialLinks) ? user.adminSocialLinks : []}
          email={user.adminEmail || null}
        />
      )}

      {/* Stat strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12, marginTop: 18, marginBottom: 24,
      }}>
        <Stat label="Balance actual" value={`${fmt(balance)} MXNP`} color="var(--orange)" />
        <Stat
          label="PnL ciclo actual"
          value={Number.isFinite(currentPnlValue) ? `${currentPnlValue > 0 ? '+' : ''}${fmt(currentPnlValue)} MXNP` : '—'}
          color={currentPnlColor}
        />
        <Stat label="PnL histórico" value={`${stats.totalPnl > 0 ? '+' : ''}${fmt(stats.totalPnl)} MXNP`} color={pnlColor} />
        <Stat label="Mercados"      value={String(stats.marketsTraded)} />
        <Stat label="Ganados"       value={String(stats.marketsWon)}  color="var(--green)" />
        <Stat label="Perdidos"      value={String(stats.marketsLost)} color="var(--danger)" />
        <Stat label="Abiertos"      value={String(stats.marketsOpen)} />
        <Stat label="% Aciertos"
          value={stats.winRate == null ? '—' : `${fmt(stats.winRate, 1)}%`}
          color={stats.winRate != null && stats.winRate >= 50 ? 'var(--green)' : 'var(--text-primary)'}
        />
      </div>

      <PnlChartCard
        series={pnlSeries}
        range={pnlRange}
        onRangeChange={setPnlRange}
        cycleScope={pnlCycleScope}
        onCycleScopeChange={setPnlCycleScope}
        loading={pnlLoading}
        emptySubLabel="Este usuario aún no tiene predicciones cerradas."
      />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
        {['activo', 'historial'].map(k => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              background: 'transparent', border: 'none',
              padding: '10px 16px',
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.04em',
              color: tab === k ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: tab === k ? 700 : 400,
              borderBottom: tab === k ? '2px solid var(--green)' : '2px solid transparent',
              marginBottom: -1, cursor: 'pointer',
            }}
          >
            {k === 'activo' ? `Activo · ${active.length}` : `Historial · ${history.length}`}
          </button>
        ))}
      </div>

      {tab === 'activo' && (
        <ActiveList rows={active} onOpen={mid => navigate(`/market?id=${mid}`)} />
      )}
      {tab === 'historial' && (
        <HistoryList rows={history} onOpen={mid => navigate(`/market?id=${mid}`)} />
      )}
    </main>
  );
}

function PublicSocialLinksPanel({ links }) {
  return (
    <section style={{
      marginTop: 18,
      marginBottom: 24,
      padding: 14,
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 12,
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--orange)',
        marginBottom: 10,
      }}>
        Redes públicas
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {links.map((link) => {
          const href = safeExternalHref(link.profileUrl);
          const content = (
            <>
              <span style={{
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                color: 'var(--text-primary)',
                fontWeight: 700,
              }}>
                {link.label || link.provider}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-muted)',
              }}>
                @{link.handle || 'perfil'}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: link.verified ? 'var(--green)' : 'var(--text-muted)',
              }}>
                {link.verified ? 'Verificada' : 'Manual'}
              </span>
            </>
          );
          const style = {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            minHeight: 36,
            padding: '8px 12px',
            borderRadius: 999,
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            textDecoration: 'none',
          };
          return href ? (
            <a
              key={`${link.provider}-${link.handle || href}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={style}
            >
              {content}
            </a>
          ) : (
            <div key={`${link.provider}-${link.handle || 'manual'}`} style={style}>
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AdminSocialsPanel({ rows, links = [], email = null }) {
  const hasRows = rows.length > 0;
  const hasLinks = links.length > 0;
  const emailText = email || 'Sin email';
  return (
    <section style={{
      marginTop: 18,
      marginBottom: 24,
      padding: 14,
      background: 'rgba(245,158,11,0.06)',
      border: '1px solid rgba(245,158,11,0.22)',
      borderRadius: 12,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        alignItems: 'center',
        marginBottom: 10,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--warning)',
        }}>
          Sociales · admin
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-muted)',
        }}>
          {links.length} conectadas · {rows.length} envíos
        </div>
      </div>
      <div style={{
        display: 'grid',
        gap: 3,
        padding: '8px 10px',
        marginBottom: hasRows || hasLinks ? 10 : 0,
        background: 'rgba(0,0,0,0.14)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 8,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: 'var(--text-muted)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}>
          Email admin
        </div>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          color: email ? 'var(--text-primary)' : 'var(--text-muted)',
          overflowWrap: 'anywhere',
        }}>
          {emailText}
        </div>
      </div>

      {!hasRows && !hasLinks ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          Sin sociales conectadas ni tareas enviadas.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {hasLinks && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}>
                Cuentas conectadas
              </div>
              {links.map((link) => {
                const profileHref = safeExternalHref(link.profileUrl);
                const handle = link.handle ? `@${link.handle}` : 'Sin handle';
                return (
                  <div
                    key={`${link.provider}-${link.providerUserId || link.handle || link.linkedAt}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      gap: 12,
                      alignItems: 'center',
                      padding: '10px 12px',
                      background: 'rgba(0,0,0,0.16)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        marginBottom: 4,
                      }}>
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: 'var(--warning)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                        }}>
                          {link.label || link.provider}
                        </span>
                        <span style={{
                          padding: '1px 6px',
                          borderRadius: 999,
                          background: link.verified ? 'rgba(0,232,122,0.12)' : 'rgba(255,255,255,0.06)',
                          color: link.verified ? 'var(--green)' : 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 8,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                        }}>
                          {link.verified ? 'Verificada' : 'Manual'}
                        </span>
                        <span style={{
                          padding: '1px 6px',
                          borderRadius: 999,
                          background: link.isPublic ? 'rgba(0,232,122,0.12)' : 'rgba(255,255,255,0.06)',
                          color: link.isPublic ? 'var(--green)' : 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 8,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                        }}>
                          {link.isPublic ? 'Pública' : 'Privada'}
                        </span>
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: 13,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {handle}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: link.rewardCredited ? 'var(--green)' : 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}>
                        {link.rewardCredited ? 'Bono aplicado' : 'Sin bono'}
                      </span>
                      {profileHref && (
                        <a
                          href={profileHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            color: 'var(--green)',
                            textDecoration: 'underline',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Abrir
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {hasRows && hasLinks && (
            <div style={{
              height: 1,
              background: 'rgba(255,255,255,0.08)',
              margin: '4px 0',
            }} />
          )}

          {hasRows && (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}>
              Tareas sociales
            </div>
          )}
          {rows.map((row) => {
            const status = SOCIAL_STATUS_LABEL[row.status] || SOCIAL_STATUS_LABEL.pending;
            const proofHref = safeExternalHref(row.proofUrl);
            const targetHref = safeExternalHref(row.targetUrl);
            return (
              <div
                key={row.id || `${row.taskKey}-${row.createdAt}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '10px 12px',
                  background: 'rgba(0,0,0,0.16)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginBottom: 4,
                    flexWrap: 'wrap',
                  }}>
                    <span style={{
                      padding: '2px 7px',
                      borderRadius: 6,
                      background: status.bg,
                      color: status.fg,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}>
                      {status.label}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                    }}>
                      {row.network}
                    </span>
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {row.label || row.taskKey}
                  </div>
                  {row.rejectionNote && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--danger)', marginTop: 4 }}>
                      {row.rejectionNote}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                    +{Number(row.reward || 0)} MXNP
                  </span>
                  {targetHref && (
                    <a
                      href={targetHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: 'var(--orange)',
                        textDecoration: 'underline',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Ver post
                    </a>
                  )}
                  {proofHref && proofHref !== targetHref && (
                    <a
                      href={proofHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: 'var(--green)',
                        textDecoration: 'underline',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Ver prueba
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{
      padding: 12,
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 10,
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9,
        letterSpacing: '0.12em', color: 'var(--text-muted)',
        textTransform: 'uppercase', marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 20,
        color: color || 'var(--text-primary)',
        letterSpacing: '0.02em',
      }}>
        {value}
      </div>
    </div>
  );
}

function ActiveList({ rows, onOpen }) {
  if (rows.length === 0) {
    return <Empty msg="Este usuario no tiene posiciones abiertas." />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map(p => {
        const pnl = Number(p.unrealizedPnl || 0);
        const pnlColor = pnl > 0 ? 'var(--success)' : pnl < 0 ? 'var(--danger)' : 'var(--text-primary)';
        return (
          <div
            key={`${p.marketId}-${p.outcomeIndex}`}
            onClick={() => onOpen(p.marketId)}
            role="button"
            style={{
              padding: '14px 16px',
              background: 'var(--surface1)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              cursor: 'pointer',
              transition: 'border-color 0.12s',
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              gap: 12,
              alignItems: 'center',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--font-body)', fontSize: 14,
                color: 'var(--text-primary)', marginBottom: 4,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {p.question}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10,
                color: 'var(--text-muted)', letterSpacing: '0.06em',
              }}>
                {p.outcomeLabel} · {fmt(p.shares)} acciones · costo {fmt(p.costBasis)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 18,
                color: 'var(--text-primary)', letterSpacing: '0.02em',
              }}>
                {fmt(p.currentValue)} MXNP
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, color: pnlColor,
                letterSpacing: '0.04em',
              }}>
                {pnl >= 0 ? '+' : ''}{fmt(pnl)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HistoryList({ rows, onOpen }) {
  if (rows.length === 0) {
    return <Empty msg="Sin historial todavía." />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map(m => {
        const tag = STATUS_LABEL[m.outcomeStatus] || STATUS_LABEL.open;
        const pnl = historyPnlValue(m);
        const pnlColor = pnl > 0 ? 'var(--success)' : pnl < 0 ? 'var(--danger)' : 'var(--text-primary)';
        const pickedLabel = m.pickedOutcomeLabel || pickedOutcomeLabelFromTransactions(m.transactions);
        return (
          <div
            key={m.marketId}
            onClick={() => onOpen(m.marketId)}
            role="button"
            style={{
              padding: '14px 16px',
              background: 'var(--surface1)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              cursor: 'pointer',
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center',
                marginBottom: 4,
              }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 6,
                  background: tag.bg, color: tag.fg,
                  fontFamily: 'var(--font-mono)', fontSize: 9,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                }}>
                  {tag.label}
                </span>
                {m.finalScore && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                    {m.finalScore}
                  </span>
                )}
              </div>
              <div style={{
                fontFamily: 'var(--font-body)', fontSize: 14,
                color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {m.question}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {pickedLabel ? `Eligió ${pickedLabel}` : ''}
                {pickedLabel && m.resolvedAt ? ' · ' : ''}
                {m.resolvedAt ? `Resuelto ${fmtDate(m.resolvedAt)}` : ''}
              </div>
            </div>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 18,
              color: pnlColor, letterSpacing: '0.02em',
              textAlign: 'right',
            }}>
              {pnl >= 0 ? '+' : ''}{fmt(pnl)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Empty({ msg }) {
  return (
    <div style={{
      padding: 40, textAlign: 'center',
      background: 'var(--surface1)', border: '1px dashed var(--border)',
      borderRadius: 12, fontFamily: 'var(--font-mono)', fontSize: 12,
      color: 'var(--text-muted)',
    }}>
      {msg}
    </div>
  );
}
