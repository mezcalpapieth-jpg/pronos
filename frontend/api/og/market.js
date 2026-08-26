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
  bg:        '#050505',
  bg2:       '#210b03',
  ticket:    '#fff7ec',
  ticket2:   '#f4eadb',
  ink:       '#0a0a0a',
  inkDim:    '#6b6258',
  line:      '#d9cab8',
  text:      '#F8F1E8',
  textDim:   '#D7C8BA',
  textMuted: '#8f8479',
  accent:    '#FF5500',
  accent2:   '#ff8a3d',
  green:     '#00E87A',
  red:       '#ef4444',
  gold:      '#f2c94c',
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

function formatMoney(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '0';
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toLocaleString('es-MX', {
    minimumFractionDigits: v % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatDeadline(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanParam(value, max = 80) {
  const raw = String(firstQueryValue(value) || '').trim();
  if (!raw) return '';
  return raw.replace(/[<>{}]/g, '').slice(0, max);
}

function cleanAccount(value) {
  const raw = cleanParam(value, 32).replace(/^@+/, '');
  return raw ? `@${raw}` : '@pronos_io';
}

function formatMoneyParam(value, { plus = false } = {}) {
  const raw = cleanParam(value, 32);
  if (!raw) return '';
  const numeric = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(numeric)) return raw;
  return `${plus && numeric > 0 ? '+' : ''}${formatMoney(numeric)} MXNP`;
}

function topOutcomeIndex(prices, winnerIdx) {
  if (Number.isInteger(winnerIdx) && winnerIdx >= 0) return winnerIdx;
  let bestIdx = 0;
  let best = -Infinity;
  prices.forEach((p, i) => {
    const v = Number(p || 0);
    if (v > best) {
      best = v;
      bestIdx = i;
    }
  });
  return bestIdx;
}

function svgTextFit(text, maxWidth, maxFont, minFont, ratio = 0.6) {
  const len = Array.from(String(text || '')).length || 1;
  const fitted = Math.floor(maxWidth / (len * ratio));
  const fontSize = Math.max(minFont, Math.min(maxFont, fitted));
  const textLengthAttr = fitted < minFont
    ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`
    : '';
  return { fontSize, textLengthAttr };
}

export default async function handler(req, res) {
  try {
    const id = Number.parseInt(req.query.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid_id' });
    }

    const rows = await sql`
      SELECT m.*,
        (SELECT COALESCE(SUM(ABS(collateral)), 0) FROM points_trades t WHERE t.market_id = m.id) AS trade_volume
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

    const questionLines = wrapText(r.question || '', 32, 3);
    const account = cleanAccount(req.query.account || req.query.username || req.query.user);
    const cashout = formatMoneyParam(req.query.cashout || req.query.cashOut || req.query.amount, { plus: true });
    const cost = formatMoneyParam(req.query.cost);
    const odds = cleanParam(req.query.odds, 20);
    const outcome = cleanParam(req.query.outcome || req.query.side, 48);

    const svg = renderSvg({
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
      account,
      cashout,
      cost,
      odds,
      outcome,
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
  category, questionLines, outcomes, prices,
  finalScore, isResolved, winnerIdx, isOnchain,
  tradeVolume, deadline,
  account, cashout, cost, odds, outcome,
}) {
  const W = 1200, H = 630;
  const pickedIdx = topOutcomeIndex(prices, winnerIdx);
  const pickedLabel = outcome || outcomes[pickedIdx] || 'Sí';
  const pickedPct = Math.round((prices[pickedIdx] || 0) * 100);
  const statusText = isResolved ? 'RESUELTO' : isOnchain ? 'ON-CHAIN' : 'EN VIVO';
  const resultTitle = isResolved || cashout
    ? pickedLabel
    : `${pickedLabel} en Pronos`;
  const rightMetricLabel = cashout ? 'Cobro' : 'Probabilidad';
  const rightMetricValue = cashout || `${pickedPct}%`;
  const costLabel = cost || `${formatVolume(tradeVolume)} MXNP`;
  const oddsLabel = odds || `${pickedPct}%`;
  const shortResult = resultTitle.length > 25 ? `${resultTitle.slice(0, 24)}…` : resultTitle;
  const resultFit = svgTextFit(shortResult, 284, 34, 26, 0.58);
  const metricFit = svgTextFit(rightMetricValue, 284, 58, 34, 0.62);
  const accountLabel = account.length > 20 ? `${account.slice(0, 19)}…` : account;
  const accountPillW = Math.max(184, Math.min(340, 74 + accountLabel.length * 13));
  const accountPillX = Math.round((W - accountPillW) / 2);
  const visible = outcomes.slice(0, 3).map((label, i) => ({
    label,
    pct: Math.round((prices[i] || 0) * 100),
    color: OUTCOME_COLORS[i % OUTCOME_COLORS.length],
    isWinner: isResolved && winnerIdx === i,
  }));
  const moreCount = Math.max(0, outcomes.length - visible.length);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.bg2}"/>
      <stop offset="52%" stop-color="${PALETTE.bg}"/>
      <stop offset="100%" stop-color="#120602"/>
    </linearGradient>
    <linearGradient id="ticket-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.ticket}"/>
      <stop offset="100%" stop-color="${PALETTE.ticket2}"/>
    </linearGradient>
    <linearGradient id="avatar-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.green}"/>
      <stop offset="100%" stop-color="${PALETTE.accent}"/>
    </linearGradient>
    <pattern id="dot-grid" width="28" height="28" patternUnits="userSpaceOnUse">
      <rect x="3" y="3" width="6" height="6" rx="1.5" fill="${PALETTE.accent}" opacity="0.18"/>
    </pattern>
    <filter id="ticket-shadow" x="-8%" y="-12%" width="116%" height="130%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity="0.36"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg-grad)"/>
  <rect width="${W}" height="${H}" fill="url(#dot-grid)" opacity="0.55"/>
  <path d="M0 0H1200V82C1030 106 870 78 718 68C484 52 280 96 0 76Z" fill="${PALETTE.accent}" opacity="0.24"/>
  <path d="M1200 630H0V555C190 522 420 548 598 565C836 588 1014 555 1200 516Z" fill="${PALETTE.accent}" opacity="0.2"/>

  <g transform="translate(${accountPillX}, 38)">
    <rect x="0" y="0" width="${accountPillW}" height="48" rx="24" fill="rgba(0,0,0,0.58)" stroke="rgba(255,255,255,0.16)"/>
    <circle cx="30" cy="24" r="16" fill="url(#avatar-grad)"/>
    <circle cx="30" cy="24" r="7" fill="rgba(255,255,255,0.18)"/>
    <text x="58" y="31" fill="${PALETTE.text}" font-family="DM Sans, Inter, Arial, sans-serif" font-size="22" font-weight="800">${esc(accountLabel)}</text>
  </g>

  <g filter="url(#ticket-shadow)">
    <rect x="148" y="118" width="904" height="330" rx="22" fill="url(#ticket-grad)"/>
    <line x1="690" y1="118" x2="690" y2="448" stroke="${PALETTE.line}" stroke-width="2" stroke-dasharray="3 10"/>
    <circle cx="690" cy="118" r="14" fill="${PALETTE.bg}"/>
    <circle cx="690" cy="448" r="14" fill="${PALETTE.bg}"/>

    <rect x="184" y="152" width="76" height="76" rx="16" fill="#e8e1d8"/>
    <text x="222" y="206" text-anchor="middle" fill="${PALETTE.ink}" font-family="DM Sans, Inter, Arial, sans-serif" font-size="54" font-weight="900">P</text>
    <circle cx="244" cy="174" r="7" fill="${PALETTE.accent}"/>
    <text x="318" y="184" fill="${PALETTE.inkDim}" opacity="0.22" font-family="DM Sans, Inter, Arial, sans-serif" font-size="28" font-weight="900">PRONOS</text>
    <text x="184" y="268" fill="${PALETTE.inkDim}" font-family="DM Mono, ui-monospace, monospace" font-size="18" font-weight="800" letter-spacing="3">${esc(category)} · ${statusText}</text>
    ${questionLines.map((line, i) => `
      <text x="184" y="${326 + i * 48}" fill="${PALETTE.ink}"
        font-family="DM Sans, Inter, Arial, sans-serif" font-size="43" font-weight="900">${esc(line)}</text>
    `).join('')}
    ${finalScore && isResolved ? `
      <text x="184" y="420" fill="${PALETTE.inkDim}" font-family="DM Mono, ui-monospace, monospace"
        font-size="17" font-weight="800" letter-spacing="2">FINAL · ${esc(String(finalScore).slice(0, 34))}</text>
    ` : ''}

    <text x="728" y="178" fill="${cashout || isResolved ? '#079c59' : PALETTE.accent}" font-family="DM Sans, Inter, Arial, sans-serif" font-size="${resultFit.fontSize}" font-weight="900"${resultFit.textLengthAttr}>${esc(shortResult)}</text>
    <text x="728" y="220" fill="${PALETTE.inkDim}" font-family="DM Sans, Inter, Arial, sans-serif" font-size="19" font-weight="700">${cashout ? 'Costo' : 'Vol.'}</text>
    <text x="1012" y="220" text-anchor="end" fill="${PALETTE.ink}" font-family="DM Mono, ui-monospace, monospace" font-size="19" font-weight="900">${esc(costLabel)}</text>
    <text x="728" y="258" fill="${PALETTE.inkDim}" font-family="DM Sans, Inter, Arial, sans-serif" font-size="19" font-weight="700">Prob.</text>
    <text x="1012" y="258" text-anchor="end" fill="${PALETTE.ink}" font-family="DM Mono, ui-monospace, monospace" font-size="19" font-weight="900">${esc(oddsLabel)}</text>
    <line x1="728" y1="288" x2="1012" y2="288" stroke="${PALETTE.line}" stroke-width="2" stroke-dasharray="4 8"/>
    <text x="728" y="328" fill="${PALETTE.ink}" font-family="DM Sans, Inter, Arial, sans-serif" font-size="21" font-weight="800">${rightMetricLabel}</text>
    <text x="728" y="392" fill="${PALETTE.green}" font-family="DM Sans, Inter, Arial, sans-serif" font-size="${metricFit.fontSize}" font-weight="900"${metricFit.textLengthAttr}>${esc(rightMetricValue)}</text>
  </g>

  <text x="${W / 2}" y="576" text-anchor="middle" fill="${PALETTE.text}" font-family="DM Sans, Inter, Arial, sans-serif" font-size="42" font-weight="900">Pronos</text>
  <circle cx="688" cy="560" r="7" fill="${PALETTE.accent}"/>

  <g transform="translate(156, 476)">
    ${visible.map((o, i) => {
      const x = i * 186;
      const label = o.label.length > 14 ? `${o.label.slice(0, 13)}…` : o.label;
      return `
        <circle cx="${x}" cy="0" r="7" fill="${o.color}"/>
        <text x="${x + 18}" y="7" fill="${PALETTE.textDim}" font-family="DM Mono, ui-monospace, monospace" font-size="15" font-weight="800">${esc(label)} ${o.pct}%</text>
      `;
    }).join('')}
    ${moreCount > 0 ? `
      <text x="${visible.length * 186}" y="7" fill="${PALETTE.textMuted}" font-family="DM Mono, ui-monospace, monospace" font-size="15" font-weight="800">+${moreCount} más</text>
    ` : ''}
  </g>

  ${deadline ? `
    <text x="${W - 150}" y="583" text-anchor="end" fill="${PALETTE.textMuted}"
      font-family="DM Mono, ui-monospace, monospace" font-size="18" font-weight="800">
      cierra ${esc(deadline)}
    </text>
  ` : ''}
</svg>`;
}
