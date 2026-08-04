import React, { useEffect, useState } from 'react';
import { useLang } from '@app/lib/i18n.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useIsMobile } from '@app/lib/useIsMobile.js';
import { createSupportTicket, fetchSupportTickets, publicErrorMessage } from '../lib/pointsApi.js';

const TYPE_LABELS = {
  socials: { es: 'Redes sociales', en: 'Socials' },
  markets: { es: 'Mercados', en: 'Markets' },
  other: { es: 'Otro', en: 'Other' },
};

export default function PointsSupport({ onOpenLogin }) {
  const lang = useLang();
  const isMobile = useIsMobile();
  const { authenticated, user, loading } = usePointsAuth();
  const [tickets, setTickets] = useState([]);
  const [form, setForm] = useState({ type: 'markets', subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);

  async function load() {
    if (!authenticated) return;
    const data = await fetchSupportTickets();
    setTickets(Array.isArray(data.tickets) ? data.tickets : []);
  }

  useEffect(() => {
    load().catch(() => setTickets([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await createSupportTicket(form);
      setForm({ type: form.type, subject: '', message: '' });
      setOk(lang === 'en' ? 'Ticket sent.' : 'Ticket enviado.');
      await load();
    } catch (error) {
      setErr(publicErrorMessage(error, lang, 'default'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main style={{ padding: '80px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando...</main>;
  }

  if (!authenticated) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '72px 24px' }}>
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 28,
          background: 'var(--surface1)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--orange)',
            marginBottom: 10,
          }}>
            Soporte
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 34, margin: '0 0 12px' }}>
            {lang === 'en' ? 'Sign in to contact support' : 'Inicia sesión para contactar soporte'}
          </h1>
          <button type="button" className="btn-primary" onClick={onOpenLogin}>
            {lang === 'en' ? 'Sign in' : 'Iniciar sesión'}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: 'clamp(28px, 5vw, 64px) 24px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(280px, 420px)',
        gap: 24,
        alignItems: 'start',
      }}>
        <section>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--orange)',
            marginBottom: 10,
          }}>
            Soporte
          </div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(34px, 6vw, 56px)',
            margin: '0 0 12px',
            letterSpacing: '0.02em',
          }}>
            {lang === 'en' ? 'How can we help?' : '¿Cómo te ayudamos?'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, maxWidth: 640 }}>
            {lang === 'en'
              ? 'Create a ticket for social tasks, markets, payments, or anything else. We will answer here and by email when possible.'
              : 'Crea un ticket sobre redes sociales, mercados, pagos o cualquier otra cosa. Te contestaremos aquí y por correo cuando sea posible.'}
          </p>

          <form onSubmit={submit} style={{
            marginTop: 24,
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--surface1)',
            padding: 22,
          }}>
            <label style={labelStyle}>Tipo</label>
            <select
              value={form.type}
              onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}
              style={inputStyle}
            >
              {Object.entries(TYPE_LABELS).map(([value, labels]) => (
                <option key={value} value={value}>{labels[lang] || labels.es}</option>
              ))}
            </select>

            <label style={labelStyle}>Asunto</label>
            <input
              value={form.subject}
              onChange={(e) => setForm(f => ({ ...f, subject: e.target.value }))}
              maxLength={160}
              style={inputStyle}
              placeholder={lang === 'en' ? 'Short summary' : 'Resumen corto'}
            />

            <label style={labelStyle}>Mensaje</label>
            <textarea
              value={form.message}
              onChange={(e) => setForm(f => ({ ...f, message: e.target.value }))}
              rows={7}
              maxLength={4000}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
              placeholder={lang === 'en' ? 'Tell us what happened...' : 'Cuéntanos qué pasó...'}
            />

            {err && <p style={{ color: '#ef4444', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{err}</p>}
            {ok && <p style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{ok}</p>}

            <button type="submit" className="btn-primary" disabled={busy} style={{ width: '100%', marginTop: 10 }}>
              {busy ? (lang === 'en' ? 'Sending...' : 'Enviando...') : (lang === 'en' ? 'Send ticket' : 'Enviar ticket')}
            </button>
          </form>
        </section>

        <aside style={{
          border: '1px solid var(--border)',
          borderRadius: 14,
          background: 'var(--surface1)',
          padding: 20,
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 14,
          }}>
            {lang === 'en' ? 'Your tickets' : 'Tus tickets'} · @{user?.username}
          </div>
          {tickets.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>
              {lang === 'en' ? 'No tickets yet.' : 'Todavía no tienes tickets.'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {tickets.map(ticket => (
                <article key={ticket.id} style={{
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 14,
                  background: 'rgba(255,255,255,0.02)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>#{ticket.id} · {ticket.subject}</strong>
                    <span style={{ color: ticket.status === 'open' ? 'var(--green)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {ticket.status}
                    </span>
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(ticket.messages || []).slice(-3).map(message => (
                      <div key={message.id} style={{
                        color: message.senderType === 'admin' ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontSize: 13,
                        lineHeight: 1.55,
                      }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase' }}>
                          {message.senderType === 'admin' ? 'Pronos' : 'Tú'}
                        </span>
                        <br />
                        {message.body}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

const labelStyle = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  margin: '14px 0 6px',
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 9,
  color: 'var(--text-primary)',
  padding: '11px 12px',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  outline: 'none',
};
