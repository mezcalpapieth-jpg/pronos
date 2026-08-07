const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM_EMAIL = 'Pronos <support@pronos.io>';
const DEFAULT_SUPPORT_EMAIL = 'support@pronos.io';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendEmail({ to, subject, html, replyTo = null }) {
  const key = process.env.RESEND_API_KEY;
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!key || recipients.length === 0) return false;

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.SUPPORT_FROM_EMAIL || DEFAULT_FROM_EMAIL,
        to: recipients,
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        html,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error('[support-email] resend error', r.status, body.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[support-email] send failed', { message: e?.message });
    return false;
  }
}

function ticketShell({ title, intro, body }) {
  return `
<div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:0 auto;background:#0b0b0b;color:#f5f5f5;border:1px solid #222;border-radius:14px;overflow:hidden;">
  <div style="padding:28px 30px;border-bottom:1px solid #222;">
    <div style="font-size:12px;letter-spacing:0.14em;color:#ff5c00;text-transform:uppercase;margin-bottom:10px;">Pronos soporte</div>
    <h1 style="font-size:24px;line-height:1.25;margin:0;color:#fff;">${escapeHtml(title)}</h1>
    ${intro ? `<p style="font-size:14px;color:#aaa;line-height:1.6;margin:12px 0 0;">${escapeHtml(intro)}</p>` : ''}
  </div>
  <div style="padding:28px 30px;font-size:14px;color:#d8d8d8;line-height:1.7;white-space:pre-wrap;">${escapeHtml(body)}</div>
</div>`;
}

export async function notifySupportTicketCreated(ticket, message) {
  const supportEmail = process.env.SUPPORT_TO_EMAIL || DEFAULT_SUPPORT_EMAIL;
  return sendEmail({
    to: supportEmail,
    replyTo: ticket.email || null,
    subject: `[Pronos soporte #${ticket.id}] ${ticket.subject}`,
    html: ticketShell({
      title: `Nuevo ticket #${ticket.id}`,
      intro: `${ticket.username} · ${ticket.type} · ${ticket.email || 'sin email'}`,
      body: message,
    }),
  });
}

export async function notifySupportTicketReply(ticket, message) {
  if (!ticket?.email) return false;
  return sendEmail({
    to: ticket.email,
    subject: `[Pronos soporte #${ticket.id}] ${ticket.subject}`,
    html: ticketShell({
      title: `Respuesta de Pronos`,
      intro: `Ticket #${ticket.id}`,
      body: message,
    }),
  });
}
