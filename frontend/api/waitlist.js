import { neon } from '@neondatabase/serverless';

const sqlWrite = neon(process.env.DATABASE_WRITE_URL || process.env.DATABASE_URL);

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'Simon <simon@pronos.io>';

async function sendWelcomeEmail(email, name) {
  if (!RESEND_API_KEY) return false;

  const greeting = name ? `Hola ${name}` : 'Hola';

  const html = `
<div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;background:#080808;border-radius:12px;overflow:hidden;">
  <div style="padding:40px 32px;text-align:center;">
    <div style="font-family:'Bebas Neue',Impact,sans-serif;font-size:36px;letter-spacing:0.04em;color:#FF5500;margin-bottom:8px;">PRONOS</div>
    <div style="width:40px;height:2px;background:#FF5500;margin:0 auto 32px;"></div>

    <h1 style="font-size:22px;color:#F0F0F0;margin-bottom:16px;font-weight:600;">${greeting}, ¡estás dentro! 🎉</h1>

    <p style="font-size:15px;color:#999;line-height:1.7;margin-bottom:24px;">
      Gracias por unirte a la lista de espera de <strong style="color:#F0F0F0;">Pronos</strong> — el primer mercado de predicciones on-chain de Latinoamérica.
    </p>

    <p style="font-size:15px;color:#999;line-height:1.7;margin-bottom:24px;">
      Estamos construyendo algo diferente: predicciones reales sobre deportes, política y entretenimiento, con liquidación automática y sin intermediarios.
    </p>

    <div style="background:#111;border:1px solid rgba(255,85,0,0.2);border-radius:8px;padding:20px;margin-bottom:24px;">
      <p style="font-size:14px;color:#FF5500;margin-bottom:8px;font-weight:600;">¿Qué sigue?</p>
      <p style="font-size:14px;color:#999;line-height:1.6;margin:0;">
        Te avisaremos en cuanto abramos la beta. Serás de los primeros en probar la plataforma y participar en los mercados iniciales.
      </p>
    </div>

    <p style="font-size:14px;color:#555;line-height:1.6;">
      Mientras tanto, síguenos para novedades:<br/>
      <a href="https://x.com/pronosmarket" style="color:#FF5500;text-decoration:none;">@pronosmarket</a>
    </p>

    <div style="margin-top:32px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.07);">
      <p style="font-size:12px;color:#444;">
        — Simon, fundador de Pronos
      </p>
    </div>
  </div>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject: '¡Estás en la lista de espera de Pronos! 🔥',
      html,
    }),
  });

  return res.ok;
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const allowed = origin === 'https://pronos.io' || origin === 'http://localhost:3333';
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://pronos.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { email, name } = req.body || {};

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email válido requerido' });
  }

  try {
    // Insert (ignore duplicate)
    const rows = await sqlWrite`
      INSERT INTO waitlist (email, name)
      VALUES (${email.toLowerCase().trim()}, ${name?.trim() || null})
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `;

    const isNew = rows.length > 0;

    if (isNew) {
      const sent = await sendWelcomeEmail(email, name?.trim());
      if (sent) {
        await sqlWrite`UPDATE waitlist SET email_sent = true WHERE email = ${email.toLowerCase().trim()}`;
      }
    }

    return res.status(200).json({
      ok: true,
      new: isNew,
      message: isNew ? '¡Te has unido a la lista!' : 'Ya estás en la lista de espera.',
    });
  } catch (e) {
    console.error('waitlist error:', e);
    return res.status(500).json({ error: 'Error interno' });
  }
}
