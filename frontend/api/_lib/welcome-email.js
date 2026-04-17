/**
 * Welcome email for the points-app (sent when a user sets their username).
 *
 * Reuses the same RESEND_API_KEY + "Simon <simon@pronos.io>" sender the
 * waitlist uses, so no new vendor setup. If the key isn't set, the
 * function no-ops and returns false — callers should treat it as
 * best-effort (never block signup on a mail provider outage).
 *
 * The email is intentionally aspirational: it explains what Pronos is
 * today (off-chain MXNP competition, biweekly prizes) AND what's coming
 * (on-chain USDC markets, real prediction markets). The goal is to get
 * early users engaged with both the current product and the vision so
 * they stick around when trading goes live.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM_EMAIL = 'Simon <simon@pronos.io>';

export async function sendPointsWelcomeEmail({ email, username }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !email) return false;

  const handle = username ? `@${username}` : 'participante';
  const subject = `¡Bienvenido a Pronos, ${handle}! 🎯`;

  const html = `
<div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#080808;border-radius:14px;overflow:hidden;color:#f0f0f0;">
  <div style="padding:48px 32px 32px;text-align:center;background:linear-gradient(180deg,rgba(0,232,122,0.08) 0%,transparent 60%);">
    <div style="font-family:'Bebas Neue',Impact,sans-serif;font-size:42px;letter-spacing:0.04em;color:#00e87a;margin-bottom:8px;">PRONOS</div>
    <div style="width:60px;height:2px;background:#00e87a;margin:0 auto 28px;"></div>

    <h1 style="font-size:26px;color:#f0f0f0;margin:0 0 12px;font-weight:700;letter-spacing:0.02em;">
      ¡Bienvenido, ${handle}!
    </h1>
    <p style="font-size:15px;color:#999;line-height:1.6;margin:0 0 28px;">
      Ya tienes <strong style="color:#00e87a;">500 MXNP</strong> en tu cuenta para empezar a predecir.
    </p>
  </div>

  <div style="padding:0 32px 32px;">
    <div style="background:#111;border:1px solid rgba(0,232,122,0.18);border-radius:12px;padding:24px;margin-bottom:20px;">
      <div style="font-size:11px;color:#00e87a;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;margin-bottom:12px;">
        Qué es Pronos hoy
      </div>
      <p style="font-size:14px;color:#ccc;line-height:1.7;margin:0 0 14px;">
        Una <strong>competencia de predicciones en Latinoamérica</strong>. Compras acciones
        en eventos reales (deportes, política, crypto, cultura) usando MXNP — los puntos
        de la competencia. Los precios se mueven con la demanda, como en un mercado real.
      </p>
      <p style="font-size:14px;color:#ccc;line-height:1.7;margin:0;">
        Cada <strong style="color:#00e87a;">2 semanas</strong>, los Top&nbsp;3 del leaderboard ganan premios reales en efectivo:
      </p>
      <div style="margin-top:14px;font-size:14px;color:#ccc;line-height:1.9;">
        🥇 1° lugar → <strong style="color:#00e87a;">$5,000 MXN</strong><br/>
        🥈 2° lugar → <strong style="color:#00e87a;">$3,000 MXN</strong><br/>
        🥉 3° lugar → <strong style="color:#00e87a;">$2,000 MXN</strong><br/>
        🎁 Puestos 4° a 10° → premios sorpresa
      </div>
    </div>

    <div style="background:#111;border:1px solid rgba(255,85,0,0.18);border-radius:12px;padding:24px;margin-bottom:20px;">
      <div style="font-size:11px;color:#ff5500;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;margin-bottom:12px;">
        Qué viene después
      </div>
      <p style="font-size:14px;color:#ccc;line-height:1.7;margin:0 0 12px;">
        Estamos construyendo el primer <strong>mercado de predicciones on-chain</strong>
        diseñado para Latinoamérica. Lo que estás usando ahora con MXNP es el calentamiento —
        pronto podrás invertir <strong>Pesos</strong> sobre eventos reales, con liquidación
        automática y sin intermediarios.
      </p>
      <p style="font-size:14px;color:#ccc;line-height:1.7;margin:0;">
        Los usuarios activos de la competencia <strong style="color:#ff5500;">tendrán prioridad</strong>
        cuando abramos trading en Pesos. Mientras tanto, sube en el leaderboard, comparte
        con amigos y gana MXNP.
      </p>
    </div>

    <div style="background:#111;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;">
      <div style="font-size:11px;color:#888;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;margin-bottom:12px;">
        Cómo ganar MXNP sin gastarlo
      </div>
      <div style="font-size:14px;color:#ccc;line-height:2;">
        ⚡ <strong>Reclamo diario:</strong> 100 MXNP + 20 extra por cada día consecutivo<br/>
        🤝 <strong>Referidos:</strong> 100 MXNP por cada amigo que invites<br/>
        📲 <strong>Redes sociales:</strong> hasta 85 MXNP siguiendo a Pronos
      </div>
    </div>

    <div style="text-align:center;margin-top:32px;">
      <a href="https://pronos.io" style="display:inline-block;padding:14px 32px;background:#00e87a;color:#000;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;">
        Empezar a predecir →
      </a>
    </div>

    <p style="font-size:12px;color:#666;line-height:1.6;margin-top:32px;text-align:center;">
      MXNP son puntos de la competencia — no tienen valor económico directo.<br/>
      Los premios del leaderboard se pagan en efectivo (MXN).
    </p>

    <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;">
      <p style="font-size:12px;color:#555;margin:0;">
        — Simon, fundador de Pronos<br/>
        <a href="https://x.com/pronosmarket" style="color:#888;text-decoration:none;">@pronosmarket</a>
      </p>
    </div>
  </div>
</div>`;

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject,
        html,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error('[welcome-email] resend error', r.status, body.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[welcome-email] send failed', { message: e?.message });
    return false;
  }
}
