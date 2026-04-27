/**
 * GET /api/share/market?id=<marketId>[&app=points|mvp]
 *
 * Bot-friendly wrapper around a market page. Returns a tiny HTML
 * document with proper OG / Twitter Card meta tags pointing at the
 * dynamic image at /api/og/market?id=N, then redirects humans to the
 * actual SPA route (/market or /mvp/market) via meta-refresh + JS.
 *
 * Why we need this: the Points + MVP frontends are Vite SPAs serving
 * the same index.html for every route. Crawlers (WhatsApp, Twitter,
 * Telegram, FB, iMessage) don't execute JS, so they only see the
 * static <head> from index.html — which has generic Pronos OG meta,
 * not per-market data. This endpoint fills that gap by serving a
 * crawler-friendly HTML stub for share URLs.
 *
 * Use:
 *   const shareUrl = `https://pronos.io/api/share/market?id=${id}&app=mvp`;
 *   // share that URL on WhatsApp/X/etc; the human who clicks it
 *   // ends up on /mvp/market?id=<id> via the redirect.
 *
 * Twitter Card: summary_large_image with our 1200×630 SVG.
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Compose a one-line summary from outcomes + their probabilities.
// e.g. "México 61% · Empate 22% · Sudáfrica 17%". Caps at 200 chars.
function summarize(outcomes, prices, isResolved, winnerIdx) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return 'Predice y gana MXNB on-chain.';
  if (isResolved && winnerIdx != null) {
    const winner = outcomes[winnerIdx];
    return winner ? `Ganó: ${winner}.` : 'Mercado resuelto.';
  }
  const parts = outcomes.slice(0, 4).map((label, i) => {
    const pct = Math.round((prices[i] || 0) * 100);
    return `${label} ${pct}%`;
  });
  const rest = outcomes.length > 4 ? ` · +${outcomes.length - 4} más` : '';
  const out = parts.join(' · ') + rest;
  return out.length > 200 ? out.slice(0, 197) + '…' : out;
}

function pricesFromReserves(reserves, n) {
  if (!Array.isArray(reserves) || reserves.length === 0) {
    return Array.from({ length: n || 2 }, () => 1 / (n || 2));
  }
  const invs = reserves.map(r => Number(r) > 0 ? 1 / Number(r) : 0);
  const total = invs.reduce((s, v) => s + v, 0) || 1;
  return invs.map(v => v / total);
}

export default async function handler(req, res) {
  try {
    const id = Number.parseInt(req.query.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).send(notFound('id_required'));
    }
    // app= picks which SPA route the human gets redirected to.
    // Defaults to /market for Points; pass app=mvp for /mvp/market.
    const appHint = req.query.app === 'mvp' ? 'mvp' : 'points';
    const targetPath = appHint === 'mvp' ? `/mvp/market?id=${id}` : `/market?id=${id}`;

    const rows = await sql`
      SELECT m.question, m.category, m.outcomes, m.reserves,
             m.status, m.outcome, m.archived_at, m.mode
      FROM points_markets m
      WHERE m.id = ${id} LIMIT 1
    `;
    if (rows.length === 0 || rows[0].archived_at) {
      return res.status(404).send(notFound('market_not_found'));
    }
    const r = rows[0];
    const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
    const reserves = parseJsonb(r.reserves, []).map(Number);
    const prices = pricesFromReserves(reserves, outcomes.length);
    const isResolved = r.status === 'resolved';
    const winnerIdx = isResolved && r.outcome != null ? Number(r.outcome) : null;

    const title = `${r.question} — Pronos`;
    const description = summarize(outcomes, prices, isResolved, winnerIdx);
    // Use absolute URL for og:image so crawlers can fetch it cross-origin.
    // VERCEL_URL is the deploy host on preview; pronos.io on prod via env.
    const baseUrl = process.env.PUBLIC_BASE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://pronos.io');
    const ogImage = `${baseUrl}/api/og/market?id=${id}`;
    const canonicalUrl = `${baseUrl}${targetPath}`;

    const html = renderHtml({
      title,
      description,
      ogImage,
      canonicalUrl,
      targetPath,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Short cache so crawlers re-fetch updated previews after resolution
    res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=120');
    return res.status(200).send(html);
  } catch (e) {
    console.error('[share/market] error', { message: e?.message });
    return res.status(500).send(notFound('share_failed'));
  }
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

  <!-- Open Graph -->
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

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(ogImage)}">
  <meta name="twitter:image:alt" content="${esc(title)}">

  <!-- Redirect humans to the actual SPA route. Crawlers stop at the
       meta tags above; the meta-refresh + JS fallbacks fire only in
       real browsers. -->
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
    <p>Cargando mercado…</p>
    <p style="font-size: 13px; color: #888;">
      Si no eres redirigido, <a href="${esc(targetPath)}">haz clic aquí</a>.
    </p>
  </div>
</body>
</html>`;
}

function notFound(code) {
  return `<!DOCTYPE html><html><head><title>Pronos · ${esc(code)}</title>
<meta name="description" content="Mercado no encontrado en Pronos.">
<meta property="og:title" content="Pronos">
<meta property="og:description" content="Predice y gana MXNB on-chain.">
<meta property="og:image" content="https://pronos.io/og-image.png">
<meta http-equiv="refresh" content="0; url=/">
<script>window.location.replace('/');</script>
</head><body><p>Cargando…</p></body></html>`;
}
