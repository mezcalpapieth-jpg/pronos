import { TOURNAMENT_REWARDS } from '../../shared/points-rewards.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM_EMAIL = 'Pronos <support@pronos.io>';
const MARKETS_URL = 'https://pronos.io/points/';
const EARN_URL = 'https://pronos.io/points/earn';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendPointsWelcomeEmail({ email, username, language }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !email) return false;

  const { signupBonus, dailyBase, dailyStep, dailyMax } = TOURNAMENT_REWARDS;
  const isEn = language === 'en';
  const handle = username ? `, @${escapeHtml(username)}` : '';
  const subject = isEn ? 'Welcome to Pronos' : 'Bienvenido a Pronos';
  const heading = isEn ? `Welcome${handle}!` : `¡Te damos la bienvenida${handle}!`;
  const bonus = isEn
    ? `You already have <strong>${signupBonus} MXNP</strong> to start making predictions on real events. MXNP are Pronos points with no cash value.`
    : `Ya tienes <strong>${signupBonus} MXNP</strong> para predecir eventos reales. Los MXNP son puntos de Pronos sin valor en efectivo.`;
  const tournaments = isEn
    ? 'Pronos runs month-long tournaments. When a tournament is active, its rules and prizes are published on the tournament page. You can explore markets between tournaments.'
    : 'Los torneos de Pronos duran un mes. Cuando haya uno activo, sus reglas y premios se publican en la página del torneo. Puedes explorar mercados entre torneos.';
  const rewards = isEn
    ? `Claim ${dailyBase} MXNP each day, plus ${dailyStep} per consecutive day up to ${dailyMax} MXNP. You can also earn points through eligible referrals and approved social tasks.`
    : `Reclama ${dailyBase} MXNP al día, con ${dailyStep} adicionales por día consecutivo hasta ${dailyMax} MXNP. También puedes ganar puntos con referidos válidos y tareas sociales aprobadas.`;
  const marketsLabel = isEn ? 'Explore markets' : 'Explorar mercados';
  const earnLabel = isEn ? 'Earn MXNP' : 'Ganar MXNP';

  const html = `
<div lang="${isEn ? 'en' : 'es'}" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#101010;border-radius:14px;color:#f0f0f0;">
  <div style="color:#ff5500;font-size:24px;font-weight:700;letter-spacing:0.06em;">PRONOS</div>
  <h1 style="font-size:26px;margin:16px 0 12px;">${heading}</h1>
  <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">${bonus}</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
    <a href="${MARKETS_URL}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#ff5500;color:#080808;text-decoration:none;font-weight:700;">${marketsLabel}</a>
  </p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">${tournaments}</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">${rewards}</p>
  <p style="font-size:15px;line-height:1.6;margin:0;">
    <a href="${EARN_URL}" style="color:#ff8954;font-weight:700;">${earnLabel}</a>
  </p>
</div>`;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: username ? `${subject}, @${username}` : subject,
        html,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      console.error('[welcome-email] resend error', response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[welcome-email] send failed', { message: error?.message });
    return false;
  }
}
