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

const SUPPORT_ATTACHMENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_SUPPORT_ATTACHMENTS = 3;
const MAX_SUPPORT_ATTACHMENT_BYTES = 1_500_000;
const MAX_SUPPORT_ATTACHMENT_TOTAL_BYTES = 3_000_000;

function formatAttachmentSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1000))} KB`;
}

function attachmentErrorMessage(code, lang) {
  const messages = {
    too_many: {
      es: 'Puedes adjuntar máximo 3 imágenes.',
      en: 'You can attach up to 3 images.',
    },
    unsupported: {
      es: 'Solo aceptamos imágenes JPG, PNG, WEBP, HEIC o HEIF.',
      en: 'Only JPG, PNG, WEBP, HEIC, or HEIF images are supported.',
    },
    too_large: {
      es: 'Cada imagen debe pesar menos de 1.5 MB.',
      en: 'Each image must be under 1.5 MB.',
    },
    total_too_large: {
      es: 'Las imágenes juntas deben pesar menos de 3 MB.',
      en: 'Images together must be under 3 MB.',
    },
    read_failed: {
      es: 'No se pudo leer una imagen. Intenta con otra captura.',
      en: 'Could not read one image. Try another screenshot.',
    },
  };
  return messages[code]?.[lang] || messages.read_failed[lang];
}

function inferAttachmentType(file) {
  const type = String(file?.type || '').toLowerCase();
  if (SUPPORT_ATTACHMENT_TYPES.has(type)) return type;
  const name = String(file?.name || '').toLowerCase();
  if (/\.(jpe?g)$/.test(name)) return 'image/jpeg';
  if (/\.png$/.test(name)) return 'image/png';
  if (/\.webp$/.test(name)) return 'image/webp';
  if (/\.heic$/.test(name)) return 'image/heic';
  if (/\.heif$/.test(name)) return 'image/heif';
  return '';
}

function readAttachmentFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const type = inferAttachmentType(file);
      const rawDataUrl = String(reader.result || '');
      const dataUrl = rawDataUrl.startsWith('data:;base64,') && type
        ? rawDataUrl.replace('data:;base64,', `data:${type};base64,`)
        : rawDataUrl;
      resolve({
        name: file.name,
        type,
        size: file.size,
        dataUrl,
      });
    };
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

function SupportAttachments({ attachments, compact = false }) {
  const items = Array.isArray(attachments) ? attachments.filter(a => a?.dataUrl) : [];
  if (!items.length) return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: compact ? 'repeat(auto-fit, minmax(74px, 1fr))' : 'repeat(auto-fit, minmax(94px, 1fr))',
      gap: 8,
      marginTop: 8,
      maxWidth: compact ? 260 : '100%',
    }}>
      {items.map((attachment, index) => (
        <a
          key={`${attachment.name || 'img'}-${index}`}
          href={attachment.dataUrl}
          target="_blank"
          rel="noreferrer"
          download={attachment.name || `captura-${index + 1}`}
          style={{
            display: 'block',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.03)',
            textDecoration: 'none',
          }}
        >
          <img
            src={attachment.dataUrl}
            alt={attachment.name || 'captura'}
            style={{
              display: 'block',
              width: '100%',
              height: compact ? 58 : 76,
              objectFit: 'cover',
            }}
          />
          <div style={{
            padding: '5px 6px',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {attachment.name || `captura-${index + 1}`}
          </div>
        </a>
      ))}
    </div>
  );
}

export default function PointsSupport({ onOpenLogin }) {
  const lang = useLang();
  const isMobile = useIsMobile();
  const { authenticated, user, loading } = usePointsAuth();
  const [tickets, setTickets] = useState([]);
  const [form, setForm] = useState({ type: 'markets', subject: '', message: '' });
  const [attachments, setAttachments] = useState([]);
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
      await createSupportTicket({ ...form, attachments });
      setForm({ type: form.type, subject: '', message: '' });
      setAttachments([]);
      setOk(lang === 'en' ? 'Ticket sent.' : 'Ticket enviado.');
      await load();
    } catch (error) {
      setErr(publicErrorMessage(error, lang, 'default'));
    } finally {
      setBusy(false);
    }
  }

  async function handleAttachmentFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setErr(null);
    setOk(null);

    if (attachments.length + files.length > MAX_SUPPORT_ATTACHMENTS) {
      setErr(attachmentErrorMessage('too_many', lang));
      return;
    }

    const next = [...attachments];
    let totalBytes = next.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    for (const file of files) {
      if (!inferAttachmentType(file)) {
        setErr(attachmentErrorMessage('unsupported', lang));
        return;
      }
      if (file.size > MAX_SUPPORT_ATTACHMENT_BYTES) {
        setErr(attachmentErrorMessage('too_large', lang));
        return;
      }
      totalBytes += file.size;
      if (totalBytes > MAX_SUPPORT_ATTACHMENT_TOTAL_BYTES) {
        setErr(attachmentErrorMessage('total_too_large', lang));
        return;
      }
      try {
        next.push(await readAttachmentFile(file));
      } catch {
        setErr(attachmentErrorMessage('read_failed', lang));
        return;
      }
    }
    setAttachments(next);
  }

  function removeAttachment(index) {
    setAttachments(items => items.filter((_, i) => i !== index));
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

            <label style={labelStyle}>
              {lang === 'en' ? 'Screenshots' : 'Capturas'}
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              onChange={handleAttachmentFiles}
              disabled={busy || attachments.length >= MAX_SUPPORT_ATTACHMENTS}
              style={inputStyle}
            />
            <p style={{
              margin: '6px 0 0',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              lineHeight: 1.5,
            }}>
              {lang === 'en'
                ? 'Up to 3 images, 1.5 MB each and 3 MB total. Do not upload passwords, keys, IDs, or sensitive documents.'
                : 'Hasta 3 imágenes, 1.5 MB cada una y 3 MB en total. No subas contraseñas, llaves, identificaciones ni documentos sensibles.'}
            </p>

            {attachments.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {attachments.map((attachment, index) => (
                  <div
                    key={`${attachment.name}-${index}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '52px minmax(0, 1fr) auto',
                      gap: 10,
                      alignItems: 'center',
                      border: '1px solid var(--border)',
                      borderRadius: 9,
                      padding: 8,
                      background: 'rgba(255,255,255,0.025)',
                    }}
                  >
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      style={{
                        width: 52,
                        height: 42,
                        objectFit: 'cover',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        color: 'var(--text-primary)',
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {attachment.name}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                        {formatAttachmentSize(attachment.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => removeAttachment(index)}
                      style={{ padding: '6px 10px', fontSize: 10 }}
                    >
                      {lang === 'en' ? 'Remove' : 'Quitar'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {err && <p style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{err}</p>}
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
                        <SupportAttachments attachments={message.attachments} compact />
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
