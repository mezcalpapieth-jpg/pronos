/**
 * GET /api/share/referral?username=<username>
 *
 * Bot-friendly wrapper for referral links. Crawlers get OG / Twitter
 * metadata and humans are redirected to the real points-app referral route.
 */

const FALLBACK_BASE_URL = 'https://pronos.io';

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

function baseUrl() {
  const fromEnv = process.env.PUBLIC_BASE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : FALLBACK_BASE_URL);
  return fromEnv.replace(/\/+$/, '');
}

export default async function handler(req, res) {
  const username = normalizeUsername(req.query?.username);
  if (!username) {
    return res.status(404).send(notFound());
  }

  const base = baseUrl();
  const targetPath = `/points/r/${username}`;
  const canonicalUrl = `${base}/r/${username}`;
  const ogImage = `${base}/api/og/referral?username=${encodeURIComponent(username)}`;
  const title = `Únete a Pronos con @${username}`;
  const description = `@${username} te invitó a competir en mercados de predicción y ganar MXNP.`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.status(200).send(renderHtml({
    title,
    description,
    ogImage,
    canonicalUrl,
    targetPath,
  }));
}

function renderHtml({ title, description, ogImage, canonicalUrl, targetPath }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonicalUrl)}">

  <meta property="og:type" content="website">
  <meta property="og:url" content="${esc(canonicalUrl)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(title)}">
  <meta property="og:site_name" content="Pronos">
  <meta property="og:locale" content="es_MX">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(ogImage)}">
  <meta name="twitter:image:alt" content="${esc(title)}">

  <meta http-equiv="refresh" content="0; url=${esc(targetPath)}">
  <script>window.location.replace(${JSON.stringify(targetPath)});</script>

  <style>
    body {
      margin: 0;
      background: #000;
      color: #f0f0f0;
      font-family: 'DM Sans', system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
      padding: 0 24px;
    }
    a { color: #ff5500; }
  </style>
</head>
<body>
  <div>
    <p>Cargando invitación...</p>
    <p style="font-size: 13px; color: #888;">
      Si no eres redirigido, <a href="${esc(targetPath)}">haz clic aquí</a>.
    </p>
  </div>
</body>
</html>`;
}

function notFound() {
  return `<!DOCTYPE html><html><head><title>Pronos</title>
<meta name="description" content="Invitación no encontrada en Pronos.">
<meta property="og:title" content="Pronos">
<meta property="og:description" content="Predice eventos reales, gana MXNP y sube en el torneo.">
<meta property="og:image" content="https://pronos.io/og-image.png">
<meta http-equiv="refresh" content="0; url=/points/">
<script>window.location.replace('/points/');</script>
</head><body><p>Cargando...</p></body></html>`;
}
