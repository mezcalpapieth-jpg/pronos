/**
 * Draft-only email copy for Top 5 winners.
 *
 * This module intentionally does not send email. It only builds subject,
 * HTML, and text payloads that an admin flow can use after the recipient
 * list is reviewed.
 */

const DEFAULT_PROFILE_URL = 'https://pronos.io/earn';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function winnerHandle(username) {
  const clean = String(username || '').trim();
  return clean ? `@${clean.replace(/^@+/, '')}` : 'participante';
}

function placeLabel(rank) {
  const n = Number(rank);
  return Number.isInteger(n) && n > 0 ? `${n}° lugar` : 'Top 5';
}

export function buildWinnerPhoneRequestEmail({
  username,
  rank,
  profileUrl = DEFAULT_PROFILE_URL,
} = {}) {
  const handle = winnerHandle(username);
  const place = placeLabel(rank);
  const safeHandle = escapeHtml(handle);
  const safePlace = escapeHtml(place);
  const safeProfileUrl = escapeHtml(profileUrl || DEFAULT_PROFILE_URL);
  const subject = 'Pronos: necesitamos tu teléfono para coordinar tu premio';

  const text = [
    `Hola ${handle},`,
    '',
    `Felicidades: quedaste en ${place} del ciclo de Pronos.`,
    '',
    'Para coordinar tu premio, entra a Perfil y agrega tu teléfono:',
    profileUrl || DEFAULT_PROFILE_URL,
    '',
    'En Perfil, toca "Añade tu teléfono", escribe tu número y guarda el perfil. Te contactaremos por ahí para coordinar la entrega.',
    '',
    'No mandes datos bancarios ni documentos por correo. Solo necesitamos que el teléfono quede guardado en tu cuenta de Pronos.',
    '',
    'Equipo Pronos',
  ].join('\n');

  const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:0 auto;background:#0b0b0b;color:#f5f5f5;border:1px solid #222;border-radius:14px;overflow:hidden;">
  <div style="padding:30px;border-bottom:1px solid #222;">
    <div style="font-size:12px;letter-spacing:0.14em;color:#00e87a;text-transform:uppercase;margin-bottom:10px;">Pronos premios</div>
    <h1 style="font-size:24px;line-height:1.25;margin:0;color:#fff;">Felicidades, ${safeHandle}</h1>
    <p style="font-size:14px;color:#aaa;line-height:1.6;margin:12px 0 0;">Quedaste en <strong style="color:#00e87a;">${safePlace}</strong> del ciclo de Pronos.</p>
  </div>
  <div style="padding:30px;font-size:14px;color:#d8d8d8;line-height:1.7;">
    <p style="margin:0 0 16px;">Para coordinar tu premio, entra a Perfil y agrega tu teléfono.</p>
    <p style="margin:0 0 22px;">Toca <strong style="color:#fff;">Añade tu teléfono</strong>, escribe tu número y guarda el perfil. Te contactaremos por ahí para coordinar la entrega.</p>
    <a href="${safeProfileUrl}" style="display:inline-block;padding:13px 20px;background:#00e87a;color:#000;text-decoration:none;border-radius:8px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;">Añade tu teléfono</a>
    <p style="font-size:12px;color:#777;line-height:1.6;margin:26px 0 0;">No mandes datos bancarios ni documentos por correo. Solo necesitamos que el teléfono quede guardado en tu cuenta de Pronos.</p>
  </div>
</div>`;

  return { subject, html, text };
}

export function buildWinnerPhoneRequestEmailDrafts(winners = [], options = {}) {
  const { userSignups, ...emailOptions } = options || {};
  const usersByUsername = new Map((Array.isArray(userSignups) ? userSignups : [])
    .map(user => [String(user?.username || '').toLowerCase(), user])
    .filter(([username]) => username));

  return (Array.isArray(winners) ? winners : []).slice(0, 5).map((winner, index) => {
    const statsUser = usersByUsername.get(String(winner?.username || '').toLowerCase()) || {};
    const rank = Number(winner?.rank) || index + 1;
    const email = String(winner?.email || statsUser.email || '').trim() || null;
    const phoneNumber = String(winner?.phoneNumber || statsUser.phoneNumber || '').trim() || null;
    return {
      to: email,
      username: winner?.username || null,
      phoneNumber,
      rank,
      ...buildWinnerPhoneRequestEmail({
        ...emailOptions,
        username: winner?.username,
        rank,
      }),
    };
  });
}
