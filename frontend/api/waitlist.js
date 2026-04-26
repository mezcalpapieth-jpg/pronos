import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { rateLimit, clientIp } from './_lib/rate-limit.js';

const sql      = neon(process.env.DATABASE_URL);
const sqlWrite = sql;

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'Simon <simon@pronos.io>';

async function sendWelcomeEmail(email, name) {
  if (!RESEND_API_KEY) return false;

  const greeting = name ? `Hola ${name}` : 'Hola';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="dark light" />
  <meta name="supported-color-schemes" content="dark light" />
  <title>¡Estás en la lista de espera de Pronos!</title>
  <style>
    /* Most clients ignore <style>, but Apple Mail / iOS use it. The
       inline styles below are the source of truth for everyone else. */
    a { color: #FF5500; text-decoration: none; }
    .dim { color: #888; }
    .social-row a:hover { opacity: 0.85; }
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .px-pad { padding-left: 24px !important; padding-right: 24px !important; }
      .py-pad { padding-top: 32px !important; padding-bottom: 32px !important; }
      h1 { font-size: 22px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#000000;font-family:'DM Sans',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!-- Hidden preheader text — shows in the inbox preview line -->
  <div style="display:none;font-size:1px;color:#000;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${greeting}, ya estás dentro de la beta de Pronos. Te avisamos en cuanto abramos.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <!-- Card -->
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0"
          style="width:600px;max-width:600px;background:#0B0B0B;border:1px solid rgba(255,85,0,0.18);border-radius:16px;overflow:hidden;">

          <!-- Brand bar -->
          <tr>
            <td align="center" class="px-pad py-pad" style="padding:48px 40px 8px;">
              <div style="font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-size:42px;line-height:1;letter-spacing:0.06em;color:#FF5500;font-weight:400;">
                PRONOS
              </div>
              <div style="width:48px;height:2px;background:#FF5500;margin:14px auto 0;border-radius:1px;"></div>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td class="px-pad" style="padding:32px 40px 8px;text-align:center;">
              <h1 style="margin:0 0 14px;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:26px;line-height:1.25;color:#F2F2F2;font-weight:600;letter-spacing:-0.01em;">
                ${greeting}, ¡estás dentro!&nbsp;🎉
              </h1>
              <p style="margin:0;font-size:15px;line-height:1.65;color:#A0A0A0;">
                Gracias por unirte a la lista de espera de
                <strong style="color:#F2F2F2;font-weight:600;">Pronos</strong> —
                el primer mercado de predicciones de Latinoamérica.
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="px-pad" style="padding:18px 40px 8px;text-align:center;">
              <p style="margin:0;font-size:15px;line-height:1.65;color:#A0A0A0;">
                Estamos construyendo algo diferente: predicciones reales sobre
                <strong style="color:#D8D8D8;font-weight:600;">deportes</strong>,
                <strong style="color:#D8D8D8;font-weight:600;">política</strong> y
                <strong style="color:#D8D8D8;font-weight:600;">entretenimiento</strong>,
                con liquidación automática y sin intermediarios.
              </p>
            </td>
          </tr>

          <!-- "What's next" callout -->
          <tr>
            <td class="px-pad" style="padding:24px 40px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:#111111;border:1px solid rgba(255,85,0,0.22);border-radius:10px;">
                <tr>
                  <td style="padding:18px 22px;">
                    <p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#FF5500;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">
                      ¿Qué sigue?
                    </p>
                    <p style="margin:0;font-size:14px;line-height:1.6;color:#A0A0A0;">
                      Te avisaremos en cuanto abramos la beta. Serás de los primeros
                      en probar la plataforma y participar en los mercados iniciales.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Socials -->
          <tr>
            <td class="px-pad" style="padding:28px 40px 4px;text-align:center;">
              <p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:#666;letter-spacing:0.02em;">
                Mientras tanto, síguenos para novedades:
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" class="social-row" style="margin:0 auto;">
                <tr>
                  <td style="padding:0 8px;">
                    <a href="https://www.instagram.com/pronos.latam/" style="display:inline-block;padding:8px 14px;border:1px solid rgba(255,85,0,0.32);border-radius:8px;color:#FF5500;font-size:13px;font-weight:600;letter-spacing:0.02em;text-decoration:none;">
                      Instagram&nbsp;·&nbsp;@pronos.latam
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px;">
                    <a href="https://www.tiktok.com/@pronos.io" style="display:inline-block;padding:8px 14px;border:1px solid rgba(255,255,255,0.14);border-radius:8px;color:#D8D8D8;font-size:13px;font-weight:600;letter-spacing:0.02em;text-decoration:none;">
                      TikTok&nbsp;·&nbsp;@pronos.io
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 8px;">
                    <a href="https://twitter.com/pronos_io" style="display:inline-block;padding:8px 14px;border:1px solid rgba(255,255,255,0.14);border-radius:8px;color:#D8D8D8;font-size:13px;font-weight:600;letter-spacing:0.02em;text-decoration:none;">
                      X&nbsp;·&nbsp;@pronos_io
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td class="px-pad" style="padding:32px 40px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.06);margin-top:24px;">
              <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#555;letter-spacing:0.02em;">
                — Simon, fundador de Pronos
              </p>
              <p style="margin:8px 0 0;font-size:11px;line-height:1.5;color:#3A3A3A;">
                Estás recibiendo este correo porque te uniste a la lista de espera en
                <a href="https://pronos.io" style="color:#3A3A3A;text-decoration:underline;">pronos.io</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const r = await fetch('https://api.resend.com/emails', {
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

  if (!r.ok) {
    const err = await r.text().catch(() => 'unknown');
    console.error('Resend error:', r.status, err);
  }
  return r.ok;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS' });
  if (cors) return cors;

  // GET /api/waitlist — view all signups. Requires the migrate key, passed
  // via Authorization: Bearer (preferred) or legacy ?key= query param.
  if (req.method === 'GET') {
    const expected = process.env.MIGRATE_KEY;
    if (!expected) {
      return res.status(500).json({ error: 'Waitlist admin not configured' });
    }
    const authHeader = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    const provided = authHeader ? authHeader[1] : req.query.key;
    if (provided !== expected) {
      return res.status(403).json({ error: 'Invalid key' });
    }
    try {
      const rows = await sql`SELECT id, email, name, source, email_sent, created_at FROM waitlist ORDER BY created_at DESC`;
      return res.status(200).json({ total: rows.length, signups: rows });
    } catch (e) {
      console.error('waitlist GET error:', { message: e.message, code: e.code });
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  // Rate limit signup spam: 5 submissions per IP per minute. Legit users
  // never hit this; spammers get 429 after the 5th attempt.
  const limited = rateLimit(req, res, {
    key: `waitlist:${clientIp(req)}`,
    limit: 5,
    windowMs: 60_000,
  });
  if (limited) return;

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

    let emailSent = false;
    if (isNew) {
      emailSent = await sendWelcomeEmail(email, name?.trim());
      if (emailSent) {
        await sqlWrite`UPDATE waitlist SET email_sent = true WHERE email = ${email.toLowerCase().trim()}`;
      }
    }

    return res.status(200).json({
      ok: true,
      new: isNew,
      emailSent,
      message: isNew ? '¡Te has unido a la lista!' : 'Ya estás en la lista de espera.',
    });
  } catch (e) {
    // Log internals server-side; don't leak them to the client — PostgreSQL
    // errors contain table/column/constraint names that help attackers map
    // the schema.
    console.error('waitlist POST error:', { message: e.message, code: e.code, detail: e.detail });
    return res.status(500).json({ error: 'Error interno' });
  }
}
