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
 *   - No private fields (email, wallet address, balance ledger).
 *   - 404 on unknown usernames so we don't leak existence.
 *   - Active + history lists capped server-side at whatever the
 *     /u endpoint returns (no client-side override).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { historyPnlValue } from '../lib/historyPnl.js';

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
  lost:    { label: 'Perdió',  bg: 'rgba(255,69,69,0.10)',  fg: 'var(--red, #ef4444)' },
  pending: { label: 'Pendiente', bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b' },
  exited:  { label: 'Salió',   bg: 'var(--surface2)',       fg: 'var(--text-muted)' },
  open:    { label: 'Abierta', bg: 'rgba(59,130,246,0.12)', fg: '#60a5fa' },
};

const SOCIAL_STATUS_LABEL = {
  approved: { label: 'Aprobada', bg: 'rgba(0,232,122,0.12)', fg: 'var(--green)' },
  pending:  { label: 'Pendiente', bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b' },
  rejected: { label: 'Rechazada', bg: 'rgba(255,69,69,0.10)', fg: 'var(--red, #ef4444)' },
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

export default function PointsUserProfile() {
  const { username: paramUsername } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('activo'); // 'activo' | 'historial'
  const backTarget = typeof location.state?.from === 'string' && location.state.from.startsWith('/')
    ? location.state.from
    : null;

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
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/points/u?username=${encodeURIComponent(paramUsername || '')}`, {
      credentials: 'include',
    })
      .then(async r => {
        if (cancelled) return;
        if (r.status === 404) { setError('user_not_found'); return; }
        if (!r.ok) { setError('load_failed'); return; }
        const json = await r.json().catch(() => null);
        if (!json) { setError('load_failed'); return; }
        setData(json);
      })
      .catch(() => { if (!cancelled) setError('load_failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [paramUsername]);

  const pnlColor = useMemo(() => {
    if (!data) return 'var(--text-primary)';
    return data.stats.totalPnl > 0 ? 'var(--green)'
      : data.stats.totalPnl < 0 ? 'var(--red, #ef4444)' : 'var(--text-primary)';
  }, [data]);

  if (loading) {
    return (
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(20px, 4vw, 36px)' }}>
        <div style={{ textAlign: 'center', padding: 60, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
          Cargando perfil…
        </div>
      </main>
    );
  }

  if (error === 'user_not_found' || !data) {
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
            No tenemos un perfil para <strong>@{paramUsername}</strong>.
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

  const { user, stats, active, history } = data;
  const showAdminSocials = Object.prototype.hasOwnProperty.call(user, 'adminSocials')
    || Object.prototype.hasOwnProperty.call(user, 'adminSocialLinks');

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(20px, 4vw, 36px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        <div>
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
          }}>
            @{user.username}
          </h1>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Miembro desde {fmtDate(user.joinedAt)}
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

      {showAdminSocials && (
        <AdminSocialsPanel
          rows={Array.isArray(user.adminSocials) ? user.adminSocials : []}
          links={Array.isArray(user.adminSocialLinks) ? user.adminSocialLinks : []}
        />
      )}

      {/* Stat strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12, marginTop: 18, marginBottom: 24,
      }}>
        <Stat label="PnL total"     value={`${stats.totalPnl > 0 ? '+' : ''}${fmt(stats.totalPnl)} MXNP`} color={pnlColor} />
        <Stat label="Mercados"      value={String(stats.marketsTraded)} />
        <Stat label="Ganados"       value={String(stats.marketsWon)}  color="var(--green)" />
        <Stat label="Perdidos"      value={String(stats.marketsLost)} color="var(--red, #ef4444)" />
        <Stat label="Abiertos"      value={String(stats.marketsOpen)} />
        <Stat label="% Aciertos"
          value={stats.winRate == null ? '—' : `${fmt(stats.winRate, 1)}%`}
          color={stats.winRate != null && stats.winRate >= 50 ? 'var(--green)' : 'var(--text-primary)'}
        />
      </div>

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

function AdminSocialsPanel({ rows, links = [] }) {
  const hasRows = rows.length > 0;
  const hasLinks = links.length > 0;
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
        marginBottom: hasRows || hasLinks ? 10 : 0,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#f59e0b',
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
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: '#f59e0b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        marginBottom: 4,
                      }}>
                        {link.label || link.provider}
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
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--red, #ef4444)', marginTop: 4 }}>
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
        const pnlColor = pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red, #ef4444)' : 'var(--text-primary)';
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
        const pnlColor = pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red, #ef4444)' : 'var(--text-primary)';
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
