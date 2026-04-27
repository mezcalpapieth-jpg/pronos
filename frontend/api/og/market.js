/**
 * GET /api/og/market?id=<marketId>
 *
 * Dynamic OG card image (1200×630 SVG) for a single market. Used by
 * /api/share/market HTML wrapper as the og:image source so WhatsApp,
 * Twitter, Telegram, iMessage, Slack etc. can render rich previews
 * when someone shares a Pronos market URL.
 *
 * Pure SVG — no satori / no resvg / zero native deps. Most consumer
 * platforms render SVG OG images fine; if Twitter/FB ever start
 * complaining (their rasterizer occasionally chokes on complex SVG),
 * swap this to satori + @resvg/resvg-js for PNG output. The SVG is
 * structured to be a near-1:1 match of how that conversion would look.
 *
 * Cache: edge-cached for 5 minutes via Cache-Control header. Markets
 * don't change often enough to justify per-request rendering, and
 * crawlers re-fetch on share anyway.
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

const PALETTE = {
  bg:        '#000000',
  surface:   '#0B0B0B',
  surface2:  '#141414',
  border:    'rgba(255,255,255,0.08)',
  text:      '#F2F2F2',
  textDim:   '#A0A0A0',
  textMuted: '#666666',
  accent:    '#FF5500',  // Pronos orange
  green:     '#22c55e',
  red:       '#ef4444',
  gold:      '#f59e0b',
  blue:      '#3b82f6',
  purple:    '#8b5cf6',
};
const OUTCOME_COLORS = [PALETTE.green, PALETTE.red, PALETTE.gold, PALETTE.blue, PALETTE.purple];

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

// XML-escape so questions/labels with quotes/angle brackets don't break
// the SVG. Crawlers parse this strictly.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Greedy word-wrap into N lines of approx `maxChars` each, capped at
// `maxLines`. Final line gets an ellipsis if more text remains.
function wrapText(text, maxChars, maxLines) {
  const words = String(text || '').trim().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length <= maxChars) { cur = candidate; continue; }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // Truncate the final line with an ellipsis if there's leftover text.
  const remainingWords = words.slice(lines.join(' ').split(/\s+/).length);
  if (remainingWords.length > 0 && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > 3 ? `${last.slice(0, last.length - 1)}…` : `${last}…`;
  }
  return lines;
}

function pricesFromReserves(reserves, n) {
  if (!Array.isArray(reserves) || reserves.length === 0) {
    return Array.from({ length: n || 2 }, () => 1 / (n || 2));
  }
  if (reserves.length === 2) {
    const [a, b] = reserves.map(Number);
    if (!a || !b) return [0.5, 0.5];
    return [b / (a + b), a / (a + b)];
  }
  const invs = reserves.map(r => Number(r) > 0 ? 1 / Number(r) : 0);
  const total = invs.reduce((s, v) => s + v, 0) || 1;
  return invs.map(v => v / total);
}

function formatVolume(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return Math.round(v).toLocaleString('en-US');
}

function formatDeadline(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

export default async function handler(req, res) {
  try {
    const id = Number.parseInt(req.query.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid_id' });
    }

    const rows = await sql`
      SELECT m.*,
        (SELECT COALESCE(SUM(collateral), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
      FROM points_markets m
      WHERE m.id = ${id} AND m.archived_at IS NULL
      LIMIT 1
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'market_not_found' });
    }
    const r = rows[0];

    const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
    const reserves = parseJsonb(r.reserves, []).map(Number);
    const livePrices = pricesFromReserves(reserves, outcomes.length);
    const isResolved = r.status === 'resolved';
    const winnerIdx = isResolved && r.outcome != null ? Number(r.outcome) : null;
    const prices = outcomes.map((_, i) =>
      isResolved ? (winnerIdx === i ? 1 : 0) : (livePrices[i] || 0),
    );
    const tradeVolume = Number(r.trade_volume || 0);
    const deadline = formatDeadline(r.end_time);
    const isOnchain = r.mode === 'onchain';

    const questionLines = wrapText(r.question || '', 38, 3);

    const svg = renderSvg({
      icon: r.icon || '📈',
      category: (r.category || 'general').toUpperCase(),
      questionLines,
      outcomes,
      prices,
      finalScore: r.final_score || null,
      isResolved,
      winnerIdx,
      isOnchain,
      tradeVolume,
      deadline,
    });

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).send(svg);
  } catch (e) {
    console.error('[og/market] error', { message: e?.message });
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: 'og_render_failed', detail: e?.message?.slice(0, 240) || null });
  }
}

function renderSvg({
  icon, category, questionLines, outcomes, prices,
  finalScore, isResolved, winnerIdx, isOnchain,
  tradeVolume, deadline,
}) {
  const W = 1200, H = 630;
  // Show top 4 outcomes max — beyond that the bars become unreadable.
  const visible = outcomes.slice(0, 4).map((label, i) => ({
    label,
    pct: Math.round((prices[i] || 0) * 100),
    color: OUTCOME_COLORS[i % OUTCOME_COLORS.length],
    isWinner: isResolved && winnerIdx === i,
  }));
  const moreCount = Math.max(0, outcomes.length - visible.length);

  // Outcome rows take the right half. Bar geometry: container 480 wide,
  // each row 56 tall with 14px gap.
  const barX = 660, barW = 480, rowH = 56, rowGap = 14;
  const rowsTop = 220;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="${PALETTE.bg}"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
    <linearGradient id="accent-fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"  stop-color="${PALETTE.accent}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${PALETTE.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg-grad)"/>
  <!-- Subtle accent bar at top -->
  <rect x="0" y="0" width="${W}" height="6" fill="${PALETTE.accent}"/>
  <rect x="0" y="6" width="${W * 0.4}" height="2" fill="url(#accent-fade)"/>

  <!-- Brand block (top-left) -->
  <text x="64" y="78" fill="${PALETTE.accent}" font-family="Bebas Neue, Impact, sans-serif"
    font-size="44" letter-spacing="3" font-weight="400">PRONOS</text>
  <circle cx="220" cy="62" r="6" fill="${PALETTE.green}"/>

  <!-- Category chip -->
  <text x="64" y="138" fill="${PALETTE.textDim}" font-family="DM Mono, ui-monospace, monospace"
    font-size="20" letter-spacing="3">${esc(icon)} ${esc(category)}</text>

  <!-- Status badge (top-right) -->
  ${renderStatusBadge({ isResolved, isOnchain, W })}

  <!-- Question (left half, multi-line) -->
  ${questionLines.map((line, i) => `
    <text x="64" y="${236 + i * 64}" fill="${PALETTE.text}"
      font-family="DM Sans, system-ui, sans-serif" font-size="48" font-weight="600"
      letter-spacing="-0.5">${esc(line)}</text>
  `).join('')}

  ${finalScore && isResolved ? `
    <g transform="translate(64, ${236 + questionLines.length * 64 + 30})">
      <rect x="0" y="0" width="540" height="48" rx="10" ry="10"
        fill="${PALETTE.surface2}" stroke="${PALETTE.green}" stroke-width="1.5" stroke-opacity="0.4"/>
      <text x="20" y="32" fill="${PALETTE.green}" font-family="DM Mono, monospace"
        font-size="18" font-weight="700" letter-spacing="2">FINAL</text>
      <text x="100" y="32" fill="${PALETTE.text}" font-family="DM Sans, sans-serif"
        font-size="20" font-weight="600">${esc(finalScore.slice(0, 36))}</text>
    </g>
  ` : ''}

  <!-- Outcome bars (right half) -->
  ${visible.map((o, i) => {
    const y = rowsTop + i * (rowH + rowGap);
    const fillW = Math.max(20, (o.pct / 100) * barW);
    const labelTrunc = o.label.length > 18 ? o.label.slice(0, 17) + '…' : o.label;
    return `
      <g transform="translate(${barX}, ${y})">
        <!-- Track -->
        <rect x="0" y="0" width="${barW}" height="${rowH}" rx="14" ry="14"
          fill="${PALETTE.surface}" stroke="${o.isWinner ? PALETTE.green : PALETTE.border}"
          stroke-width="${o.isWinner ? 2 : 1}"/>
        <!-- Fill -->
        <rect x="0" y="0" width="${fillW}" height="${rowH}" rx="14" ry="14"
          fill="${o.color}" opacity="${o.isWinner ? 0.32 : 0.18}"/>
        <!-- Label -->
        <text x="22" y="${rowH / 2 + 8}" fill="${o.isWinner ? PALETTE.green : PALETTE.text}"
          font-family="DM Sans, sans-serif" font-size="22" font-weight="600">
          ${o.isWinner ? '🏆 ' : ''}${esc(labelTrunc)}
        </text>
        <!-- Pct (right-aligned) -->
        <text x="${barW - 22}" y="${rowH / 2 + 9}" text-anchor="end"
          fill="${o.color}" font-family="DM Mono, monospace"
          font-size="26" font-weight="700">${o.pct}¢</text>
      </g>
    `;
  }).join('')}
  ${moreCount > 0 ? `
    <text x="${barX}" y="${rowsTop + visible.length * (rowH + rowGap) + 20}"
      fill="${PALETTE.textMuted}" font-family="DM Mono, monospace" font-size="16">
      +${moreCount} más
    </text>
  ` : ''}

  <!-- Footer: vol + deadline + url -->
  <line x1="64" y1="540" x2="${W - 64}" y2="540" stroke="${PALETTE.border}" stroke-width="1"/>
  <text x="64" y="582" fill="${PALETTE.textDim}" font-family="DM Mono, monospace"
    font-size="20" letter-spacing="2">VOL ${formatVolume(tradeVolume)} MXNB</text>
  ${deadline ? `
    <text x="${W / 2}" y="582" text-anchor="middle" fill="${PALETTE.textDim}"
      font-family="DM Mono, monospace" font-size="20" letter-spacing="2">
      cierra ${esc(deadline)}
    </text>
  ` : ''}
  <text x="${W - 64}" y="582" text-anchor="end" fill="${PALETTE.accent}"
    font-family="DM Sans, sans-serif" font-size="20" font-weight="600">pronos.io</text>
</svg>`;
}

function renderStatusBadge({ isResolved, isOnchain, W }) {
  if (isResolved) {
    return `
      <g transform="translate(${W - 220}, 56)">
        <rect x="0" y="0" width="156" height="44" rx="22" ry="22"
          fill="rgba(34,197,94,0.14)" stroke="${PALETTE.green}" stroke-width="1.5" stroke-opacity="0.5"/>
        <text x="78" y="29" text-anchor="middle" fill="${PALETTE.green}"
          font-family="DM Mono, monospace" font-size="16" letter-spacing="2.5" font-weight="700">RESUELTO</text>
      </g>
    `;
  }
  if (isOnchain) {
    return `
      <g transform="translate(${W - 220}, 56)">
        <rect x="0" y="0" width="156" height="44" rx="22" ry="22"
          fill="rgba(59,130,246,0.14)" stroke="${PALETTE.blue}" stroke-width="1.5" stroke-opacity="0.5"/>
        <text x="78" y="29" text-anchor="middle" fill="${PALETTE.blue}"
          font-family="DM Mono, monospace" font-size="16" letter-spacing="2.5" font-weight="700">ON-CHAIN</text>
      </g>
    `;
  }
  return `
    <g transform="translate(${W - 220}, 56)">
      <rect x="0" y="0" width="156" height="44" rx="22" ry="22"
        fill="rgba(220,38,38,0.14)" stroke="${PALETTE.red}" stroke-width="1.5" stroke-opacity="0.5"/>
      <text x="78" y="29" text-anchor="middle" fill="${PALETTE.red}"
        font-family="DM Mono, monospace" font-size="16" letter-spacing="2.5" font-weight="700">EN VIVO</text>
    </g>
  `;
}
