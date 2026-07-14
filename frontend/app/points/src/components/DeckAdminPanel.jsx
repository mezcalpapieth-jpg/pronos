import React, { useEffect, useState } from 'react';
import {
  adminCreateDeckInvite,
  adminDeckDashboard,
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

export default function DeckAdminPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [label, setLabel] = useState('');
  const [emailHint, setEmailHint] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [freshCode, setFreshCode] = useState(null);

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
    try {
      const result = await adminCreateDeckInvite({
        label,
        emailHint,
        code: customCode,
      });
      setFreshCode(result.code);
      setLabel('');
      setEmailHint('');
      setCustomCode('');
      await load();
    } catch (error) {
      setErr(error.code || error.message);
    }
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
            Código creado: <strong>{freshCode}</strong>. Guárdalo ahora; no se vuelve a mostrar.
          </div>
        )}
      </section>

      <section style={card}>
        <div style={monoLabel}>Invitaciones</div>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {invites.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Todavía no hay códigos.</p>}
          {invites.map(invite => (
            <div key={invite.id} style={rowStyle}>
              <div>
                <strong>{invite.label}</strong>
                <div style={smallMuted}>
                  {invite.emailHint || 'sin correo fijo'} · {invite.sessions} sesiones · {invite.totalMinutes} min
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ ...statusPill, color: invite.active ? '#22c55e' : '#ff6b6b' }}>
                  {invite.active ? 'Activo' : 'Revocado'}
                </span>
                {invite.active && (
                  <button type="button" onClick={() => revokeInvite(invite.id)} style={ghostButton}>
                    Revocar
                  </button>
                )}
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
          {sessions.map(s => (
            <div key={s.id} style={rowStyle}>
              <div>
                <strong>{s.viewerEmail}</strong>
                <div style={smallMuted}>{s.inviteLabel || 'sin etiqueta'} · {s.language.toUpperCase()} · última lámina {s.lastSlide || '-'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong>{s.totalMinutes} min</strong>
                <div style={smallMuted}>{new Date(s.lastSeenAt).toLocaleString()}</div>
              </div>
            </div>
          ))}
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
