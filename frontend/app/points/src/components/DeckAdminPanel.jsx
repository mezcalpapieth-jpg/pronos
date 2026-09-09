import React, { useEffect, useState } from 'react';
import {
  adminCreateDeckInvite,
  adminDeckDashboard,
  adminResetDeckInviteCode,
  adminRevokeDeckInvite,
} from '../lib/pointsApi.js';

const card = {
  background: 'var(--surface1)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 16,
};

const monoLabel = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

function deckAccessUrl() {
  if (typeof window === 'undefined') return 'https://pronos.io/deck';
  return `${window.location.origin}/deck`;
}

function pageLabel(value) {
  if (value === 'investor_dashboard') return 'Investor dashboard';
  return String(value || 'page')
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function deckInviteMessage(invite, code) {
  const accessCode = code || invite?.shareCode || '';
  const greeting = invite?.label ? `Hola ${invite.label},` : 'Hola,';
  return [
    greeting,
    '',
    'Te comparto el deck de Pronos:',
    deckAccessUrl(),
    accessCode ? `Contraseña: ${accessCode}` : 'Contraseña: pendiente de reemitir desde admin.',
    '',
    'Cualquier duda me dices.',
  ].join('\n');
}

export default function DeckAdminPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [label, setLabel] = useState('');
  const [emailHint, setEmailHint] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [freshCode, setFreshCode] = useState(null);
  const [freshInvite, setFreshInvite] = useState(null);
  const [shareOverrideCodes, setShareOverrideCodes] = useState({});
  const [copiedInviteId, setCopiedInviteId] = useState(null);
  const [resettingInviteId, setResettingInviteId] = useState(null);
  const [expandedSessionIds, setExpandedSessionIds] = useState({});

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      setData(await adminDeckDashboard());
    } catch (e) {
      setErr(e.code || e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createInvite(e) {
    e.preventDefault();
    setErr(null);
    setFreshCode(null);
    setFreshInvite(null);
    try {
      const result = await adminCreateDeckInvite({
        label,
        emailHint,
        code: customCode,
      });
      const createdInvite = { ...(result.invite || {}), shareCode: result.code };
      setFreshCode(result.code);
      setFreshInvite(createdInvite);
      if (createdInvite.id) {
        setShareOverrideCodes(prev => ({ ...prev, [createdInvite.id]: result.code }));
      }
      setLabel('');
      setEmailHint('');
      setCustomCode('');
      await load();
    } catch (error) {
      setErr(error.code || error.message);
    }
  }

  function shareCodeForInvite(invite) {
    return shareOverrideCodes[invite.id] || invite.shareCode || null;
  }

  async function copyInvite(invite) {
    const code = shareCodeForInvite(invite);
    const message = deckInviteMessage(invite, code);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
      } else {
        window.prompt('Copia este mensaje', message);
      }
      setCopiedInviteId(invite.id);
      window.setTimeout(() => setCopiedInviteId(null), 1800);
    } catch (error) {
      setErr(error.message || 'copy_failed');
    }
  }

  async function shareInvite(invite) {
    const code = shareCodeForInvite(invite);
    const message = deckInviteMessage(invite, code);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Deck de Pronos', text: message, url: deckAccessUrl() });
      } else {
        await copyInvite(invite);
      }
    } catch (error) {
      if (error.name !== 'AbortError') setErr(error.message || 'share_failed');
    }
  }

  async function resetInviteCode(invite) {
    if (!window.confirm('¿Reemitir una nueva contraseña para esta invitación? La anterior dejará de funcionar.')) return;
    setErr(null);
    setResettingInviteId(invite.id);
    try {
      const result = await adminResetDeckInviteCode({ id: invite.id });
      const updatedInvite = { ...invite, ...(result.invite || {}), shareCode: result.code };
      setFreshCode(result.code);
      setFreshInvite(updatedInvite);
      setShareOverrideCodes(prev => ({ ...prev, [invite.id]: result.code }));
      await load();
    } catch (error) {
      setErr(error.code || error.message);
    } finally {
      setResettingInviteId(null);
    }
  }

  function emailHref(invite) {
    const to = invite.emailHint || '';
    return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent('Deck de Pronos')}&body=${encodeURIComponent(deckInviteMessage(invite, shareCodeForInvite(invite)))}`;
  }

  function whatsappHref(invite) {
    return `https://wa.me/?text=${encodeURIComponent(deckInviteMessage(invite, shareCodeForInvite(invite)))}`;
  }

  function toggleSession(id) {
    setExpandedSessionIds(prev => ({ ...prev, [id]: !prev[id] }));
  }

  async function revokeInvite(id) {
    if (!window.confirm('¿Revocar este código de acceso?')) return;
    setErr(null);
    try {
      await adminRevokeDeckInvite(id);
      await load();
    } catch (error) {
      setErr(error.code || error.message);
    }
  }

  if (loading && !data) {
    return <div style={{ ...card, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando deck...</div>;
  }

  const summary = data?.summary || {};
  const slides = data?.slides || [];
  const pages = data?.pages || [];
  const sessions = data?.sessions || [];
  const questions = data?.questions || [];
  const invites = data?.invites || [];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {err && (
        <div style={{ ...card, borderColor: 'rgba(239,68,68,0.45)', color: '#ff6b6b' }}>
          {err}
        </div>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <Metric label="Sesiones" value={summary.sessions || 0} />
        <Metric label="Viewers" value={summary.viewers || 0} />
        <Metric label="Minutos" value={summary.totalMinutes || 0} />
        <Metric label="Dashboard viewers" value={summary.dashboardViewers || 0} />
        <Metric label="Min dashboard" value={summary.dashboardMinutes || 0} />
        <Metric label="Preguntas" value={summary.questions || 0} />
      </section>

      <section style={card}>
        <div style={monoLabel}>Crear nombre y contraseña</div>
        <form onSubmit={createInvite} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1fr auto', gap: 10, marginTop: 12 }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nombre / persona / fondo" required style={inputStyle} />
          <input value={emailHint} onChange={(e) => setEmailHint(e.target.value)} placeholder="Correo opcional" style={inputStyle} />
          <input value={customCode} onChange={(e) => setCustomCode(e.target.value)} placeholder="Contraseña/código" style={inputStyle} />
          <button type="submit" style={buttonStyle}>Crear</button>
        </form>
        {freshCode && (
          <div style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 8,
            background: 'rgba(34,197,94,0.12)',
            border: '1px solid rgba(34,197,94,0.4)',
            color: '#22c55e',
            fontFamily: 'var(--font-mono)',
          }}>
            <div>Código listo: <strong>{freshCode}</strong></div>
            {freshInvite && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                <button type="button" onClick={() => copyInvite(freshInvite)} style={shareButton}>Copiar mensaje</button>
                <a href={emailHref(freshInvite)} style={shareButton}>Email</a>
                <a href={whatsappHref(freshInvite)} target="_blank" rel="noreferrer" style={shareButton}>WhatsApp</a>
                <button type="button" onClick={() => shareInvite(freshInvite)} style={shareButton}>Compartir</button>
              </div>
            )}
          </div>
        )}
      </section>

      <section style={card}>
        <div style={monoLabel}>Invitaciones</div>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {invites.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Todavía no hay códigos.</p>}
          {invites.map(invite => {
            const shareCode = shareCodeForInvite(invite);
            return (
            <div key={invite.id} style={rowStyle}>
              <div>
                <strong>{invite.label}</strong>
                <div style={smallMuted}>
                  {invite.emailHint || 'sin correo fijo'} · {invite.sessions} sesiones · {invite.totalMinutes} min deck · {invite.dashboardMinutes || 0} min dashboard
                </div>
                <div style={shareLine}>
                  {shareCode
                    ? `Deck: ${deckAccessUrl()} · Contraseña: ${shareCode}`
                    : 'Contraseña anterior no recuperable. Reemite el código para compartirlo.'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ ...statusPill, color: invite.active ? '#22c55e' : '#ff6b6b' }}>
                  {invite.active ? 'Activo' : 'Revocado'}
                </span>
                {invite.active && (
                  <>
                    {shareCode && (
                      <>
                        <button type="button" onClick={() => copyInvite(invite)} style={ghostButton}>
                          {copiedInviteId === invite.id ? 'Copiado' : 'Copiar'}
                        </button>
                        <a href={emailHref(invite)} style={ghostButton}>Email</a>
                        <a href={whatsappHref(invite)} target="_blank" rel="noreferrer" style={ghostButton}>WhatsApp</a>
                        <button type="button" onClick={() => shareInvite(invite)} style={ghostButton}>Compartir</button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => resetInviteCode(invite)}
                      disabled={resettingInviteId === invite.id}
                      style={{ ...ghostButton, opacity: resettingInviteId === invite.id ? 0.55 : 1 }}
                    >
                      {resettingInviteId === invite.id ? 'Reemitiendo...' : 'Reemitir contraseña'}
                    </button>
                    <button type="button" onClick={() => revokeInvite(invite.id)} style={ghostButton}>
                      Revocar
                    </button>
                  </>
                )}
              </div>
            </div>
          );
          })}
        </div>
      </section>

      <section style={card}>
        <div style={monoLabel}>Investor dashboard</div>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {pages.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Sin vistas del dashboard todavía.</p>}
          {pages.map(row => (
            <div key={row.pageKey} style={rowStyle}>
              <div>
                <strong>{pageLabel(row.pageKey)}</strong>
                <div style={smallMuted}>
                  {row.sessions} sesiones · {row.viewers} viewers · {row.events} eventos
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong>{row.totalMinutes} min</strong>
                <div style={smallMuted}>{row.lastEventAt ? new Date(row.lastEventAt).toLocaleString() : 'sin fecha'}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 0.8fr)', gap: 18 }}>
        <div style={card}>
          <div style={monoLabel}>Tiempo por lámina</div>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {slides.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Sin eventos todavía.</p>}
            {slides.map(row => (
              <div key={`${row.language}-${row.slideNumber}`} style={rowStyle}>
                <div>
                  <strong>{row.language.toUpperCase()} · Lámina {row.slideNumber}</strong>
                  <div style={smallMuted}>{row.sessions} sesiones · {row.events} eventos</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>{row.totalMinutes} min</strong>
                  <div style={smallMuted}>{row.avgMinutes} min promedio</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={card}>
          <div style={monoLabel}>Preguntas</div>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {questions.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Sin preguntas.</p>}
            {questions.map(q => (
              <article key={q.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={smallMuted}>{q.viewerEmail} · {q.language.toUpperCase()} · lámina {q.slideNumber || '-'}</div>
                <p style={{ margin: '8px 0 0', lineHeight: 1.45 }}>{q.question}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section style={card}>
        <div style={monoLabel}>Sesiones recientes</div>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {sessions.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Sin sesiones todavía.</p>}
          {sessions.map(s => {
            const expanded = Boolean(expandedSessionIds[s.id]);
            const slideBreakdown = Array.isArray(s.slideBreakdown) ? s.slideBreakdown : [];
            const pageBreakdown = Array.isArray(s.pageBreakdown) ? s.pageBreakdown : [];
            const maxActivityMinutes = Math.max(
              ...slideBreakdown.map(row => Number(row.totalMinutes || 0)),
              ...pageBreakdown.map(row => Number(row.totalMinutes || 0)),
              0.1,
            );
            return (
            <div key={s.id} style={sessionCardStyle}>
              <button type="button" onClick={() => toggleSession(s.id)} style={sessionSummaryButton}>
                <div style={{ textAlign: 'left' }}>
                  <strong>{s.viewerEmail}</strong>
                  <div style={smallMuted}>{s.inviteLabel || 'sin etiqueta'} · {s.language.toUpperCase()} · última lámina {s.lastSlide || '-'}</div>
                </div>
                <div style={{ textAlign: 'right', display: 'grid', gap: 4 }}>
                  <strong>{s.totalMinutes} min deck</strong>
                  <span style={smallMuted}>{s.dashboardMinutes || 0} min dashboard</span>
                  <span style={smallMuted}>{new Date(s.lastSeenAt).toLocaleString()}</span>
                  <span style={sessionToggleText}>{expanded ? 'Ocultar detalle' : 'Ver detalle'} · {slideBreakdown.length + pageBreakdown.length}</span>
                </div>
              </button>
              {expanded && (
                <div style={sessionBreakdownStyle}>
                  {slideBreakdown.length === 0 && pageBreakdown.length === 0 && (
                    <p style={{ ...smallMuted, margin: 0 }}>Sin tiempo registrado todavía.</p>
                  )}
                  {slideBreakdown.map(row => {
                    const width = `${Math.max(8, Math.round((Number(row.totalMinutes || 0) / maxActivityMinutes) * 100))}%`;
                    return (
                      <div key={`${s.id}-${row.language}-${row.slideNumber}`} style={slideTimeRowStyle}>
                        <div style={{ minWidth: 112 }}>
                          <strong>Lámina {row.slideNumber}</strong>
                          <div style={smallMuted}>{String(row.language || s.language || 'en').toUpperCase()} · {row.events} eventos</div>
                        </div>
                        <div style={slideBarTrackStyle}>
                          <div style={{ ...slideBarFillStyle, width }} />
                        </div>
                        <div style={{ minWidth: 76, textAlign: 'right', fontWeight: 800 }}>
                          {row.totalMinutes} min
                        </div>
                      </div>
                    );
                  })}
                  {pageBreakdown.map(row => {
                    const width = `${Math.max(8, Math.round((Number(row.totalMinutes || 0) / maxActivityMinutes) * 100))}%`;
                    return (
                      <div key={`${s.id}-${row.pageKey}`} style={slideTimeRowStyle}>
                        <div style={{ minWidth: 112 }}>
                          <strong>{pageLabel(row.pageKey)}</strong>
                          <div style={smallMuted}>{row.events} eventos</div>
                        </div>
                        <div style={slideBarTrackStyle}>
                          <div style={{ ...dashboardBarFillStyle, width }} />
                        </div>
                        <div style={{ minWidth: 76, textAlign: 'right', fontWeight: 800 }}>
                          {row.totalMinutes} min
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
          })}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={card}>
      <div style={monoLabel}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 42, marginTop: 8 }}>{value}</div>
    </div>
  );
}

const inputStyle = {
  border: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.045)',
  color: 'var(--text-primary)',
  borderRadius: 8,
  padding: '12px 12px',
};

const buttonStyle = {
  border: '1px solid rgba(255,90,31,0.75)',
  background: '#ff5a1f',
  color: '#090909',
  borderRadius: 8,
  padding: '12px 16px',
  fontWeight: 800,
  cursor: 'pointer',
};

const ghostButton = {
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-primary)',
  borderRadius: 8,
  padding: '8px 10px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  textDecoration: 'none',
};

const shareButton = {
  ...ghostButton,
  borderColor: 'rgba(34,197,94,0.45)',
  color: '#22c55e',
  background: 'rgba(0,0,0,0.16)',
};

const rowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 14,
  alignItems: 'center',
  padding: 12,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.02)',
};

const sessionCardStyle = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.02)',
  overflow: 'hidden',
};

const sessionSummaryButton = {
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 14,
  alignItems: 'center',
  padding: 12,
  border: 0,
  background: 'transparent',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};

const sessionToggleText = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#ff5a1f',
};

const sessionBreakdownStyle = {
  display: 'grid',
  gap: 8,
  padding: '0 12px 12px',
  borderTop: '1px solid var(--border)',
};

const slideTimeRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(112px, 0.7fr) minmax(120px, 1.4fr) auto',
  gap: 12,
  alignItems: 'center',
  paddingTop: 10,
};

const slideBarTrackStyle = {
  height: 8,
  borderRadius: 999,
  background: 'rgba(255,255,255,0.07)',
  overflow: 'hidden',
};

const slideBarFillStyle = {
  height: '100%',
  borderRadius: 999,
  background: 'linear-gradient(90deg, rgba(255,90,31,0.92), rgba(34,197,94,0.82))',
};

const dashboardBarFillStyle = {
  height: '100%',
  borderRadius: 999,
  background: 'linear-gradient(90deg, rgba(96,165,250,0.92), rgba(255,90,31,0.82))',
};

const shareLine = {
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  lineHeight: 1.5,
  marginTop: 8,
  overflowWrap: 'anywhere',
};

const smallMuted = {
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  marginTop: 4,
};

const statusPill = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};
