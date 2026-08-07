/**
 * GET /api/og/referral?username=<username>
 *
 * Lightweight 1200x630 SVG card for referral-share previews. Kept as a
 * pure SVG, matching /api/og/market, so we avoid native image-rendering
 * dependencies in the API runtime.
 */

const PALETTE = {
  bg: '#000000',
  surface: '#101010',
  border: 'rgba(255,255,255,0.10)',
  text: '#F4F4F4',
  textDim: '#9A9A9A',
  textMuted: '#666666',
  accent: '#FF5500',
  green: '#00E87A',
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeUsername(value) {
  const raw = String(value || '').trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z][a-z0-9_]{2,19}$/.test(raw) ? raw : null;
}

export default async function handler(req, res) {
  const username = normalizeUsername(req.query?.username);
  if (!username) {
    return res.status(400).json({ error: 'invalid_username' });
  }

  const svg = renderSvg(username);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  return res.status(200).send(svg);
}

function renderSvg(username) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <radialGradient id="glow" cx="18%" cy="18%" r="80%">
      <stop offset="0%" stop-color="${PALETTE.accent}" stop-opacity="0.34"/>
      <stop offset="55%" stop-color="${PALETTE.accent}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="${PALETTE.bg}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#161616"/>
      <stop offset="100%" stop-color="#080808"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="${PALETTE.bg}"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="66" y="64" width="1068" height="502" rx="34" fill="url(#panel)" stroke="${PALETTE.border}" stroke-width="2"/>
  <text x="116" y="140" fill="${PALETTE.accent}" font-family="Bebas Neue, Impact, sans-serif" font-size="44" letter-spacing="5">PRONOS</text>
  <circle cx="288" cy="124" r="8" fill="${PALETTE.accent}"/>
  <text x="116" y="222" fill="${PALETTE.textDim}" font-family="DM Mono, ui-monospace, monospace" font-size="24" letter-spacing="5">INVITACION PRIVADA</text>
  <text x="116" y="318" fill="${PALETTE.text}" font-family="DM Sans, system-ui, sans-serif" font-size="70" font-weight="800">Compite en Pronos</text>
  <text x="116" y="392" fill="${PALETTE.textDim}" font-family="DM Sans, system-ui, sans-serif" font-size="34">Predice eventos reales, gana MXNP y sube en el torneo.</text>
  <rect x="116" y="442" width="456" height="72" rx="22" fill="rgba(0,232,122,0.10)" stroke="rgba(0,232,122,0.35)" stroke-width="2"/>
  <text x="148" y="489" fill="${PALETTE.green}" font-family="DM Mono, ui-monospace, monospace" font-size="28" font-weight="700">@${esc(username)} te invitó</text>
  <text x="815" y="488" fill="${PALETTE.textMuted}" font-family="DM Mono, ui-monospace, monospace" font-size="20" letter-spacing="3">PRONOS.IO</text>
</svg>`;
}
