import React, { useState } from 'react';
import { fetchPriceHistory } from '../lib/pointsApi.js';

const CARD_W = 1200;
const CARD_H = 675;

function formatMxnp(n) {
  const value = Number(n) || 0;
  return value.toLocaleString('es-MX', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function primaryOutcomeIndex(item) {
  const direct = Number(item?.outcomeIndex);
  if (Number.isInteger(direct) && direct >= 0) return direct;

  const buys = (item?.transactions || [])
    .filter(tx => tx?.side === 'buy' && Number.isInteger(Number(tx.outcomeIndex)))
    .map(tx => ({
      outcomeIndex: Number(tx.outcomeIndex),
      collateral: Number(tx.collateral || 0),
      shares: Number(tx.shares || 0),
    }))
    .sort((a, b) => (b.collateral - a.collateral) || (b.shares - a.shares));

  return buys[0]?.outcomeIndex ?? 0;
}

function probabilityFromPoint(point) {
  const raw = point?.p ?? point?.probability ?? point?.price ?? point?.value;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? n * 100 : n;
}

function latestProbability(series, item) {
  for (const point of [...(series || [])].reverse()) {
    const p = probabilityFromPoint(point);
    if (Number.isFinite(p)) return clamp(p, 0, 100);
  }
  const price = Number(item?.currentPrice);
  if (Number.isFinite(price)) return clamp(price <= 1 ? price * 100 : price, 0, 100);
  if (item?.outcomeStatus === 'won' || item?.status === 'resolved') return 100;
  return null;
}

function displayHandle(username) {
  const cleaned = String(username || '').trim().replace(/^@+/, '');
  return cleaned ? `@${cleaned}` : '@pronos';
}

function shortHandle(username) {
  const handle = displayHandle(username);
  return handle.length > 20 ? `${handle.slice(0, 19)}…` : handle;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let line = '';
  let lines = 0;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      lines += 1;
      line = word;
      if (lines >= maxLines - 1) break;
    } else {
      line = testLine;
    }
  }

  if (line && lines < maxLines) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }

  return y;
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

async function makeWinCard({ item, username, amount, outcomeLabel }) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');

  const displayMarketId = item?.parentMarketId || item?.marketId;
  const historyMarketId = item?.marketId;
  const outcomeIndex = primaryOutcomeIndex(item);
  let series = [];
  if (historyMarketId) {
    const history = await fetchPriceHistory([historyMarketId], { days: 30, outcome: outcomeIndex, limit: 160 });
    series = history?.[String(historyMarketId)] || history?.[Number(historyMarketId)] || [];
  }

  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, '#241006');
  bg.addColorStop(0.48, '#050505');
  bg.addColorStop(1, '#160601');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.fillStyle = 'rgba(255,85,0,0.16)';
  for (let y = 22; y < CARD_H; y += 28) {
    for (let x = 18; x < CARD_W; x += 28) {
      ctx.fillRect(x, y, 6, 6);
    }
  }

  ctx.fillStyle = 'rgba(255,85,0,0.18)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(CARD_W, 0);
  ctx.lineTo(CARD_W, 72);
  ctx.bezierCurveTo(940, 112, 744, 56, 520, 68);
  ctx.bezierCurveTo(282, 82, 140, 100, 0, 68);
  ctx.closePath();
  ctx.fill();

  const handle = shortHandle(username);
  const pillW = Math.max(210, Math.min(360, 76 + handle.length * 17));
  const pillX = (CARD_W - pillW) / 2;
  roundedRect(ctx, pillX, 28, pillW, 54, 27);
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const avatar = ctx.createLinearGradient(pillX + 17, 38, pillX + 53, 74);
  avatar.addColorStop(0, '#00e87a');
  avatar.addColorStop(1, '#ff5500');
  ctx.fillStyle = avatar;
  ctx.beginPath();
  ctx.arc(pillX + 34, 55, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.arc(pillX + 27, 49, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff7ec';
  ctx.font = '800 24px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(handle, pillX + 66, 64);

  const ticket = { x: 100, y: 118, w: 1000, h: 330 };
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.42)';
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 18;
  roundedRect(ctx, ticket.x, ticket.y, ticket.w, ticket.h, 22);
  const ticketFill = ctx.createLinearGradient(ticket.x, ticket.y, ticket.x + ticket.w, ticket.y + ticket.h);
  ticketFill.addColorStop(0, '#fff8ed');
  ticketFill.addColorStop(1, '#f3e6d5');
  ctx.fillStyle = ticketFill;
  ctx.fill();
  ctx.restore();

  const cutX = ticket.x + 610;
  ctx.save();
  ctx.setLineDash([4, 10]);
  ctx.strokeStyle = '#d7c7b5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cutX, ticket.y);
  ctx.lineTo(cutX, ticket.y + ticket.h);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#050505';
  ctx.beginPath();
  ctx.arc(cutX, ticket.y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cutX, ticket.y + ticket.h, 14, 0, Math.PI * 2);
  ctx.fill();

  roundedRect(ctx, 134, 152, 76, 76, 16);
  ctx.fillStyle = '#e8e1d8';
  ctx.fill();
  ctx.fillStyle = 'rgba(255,85,0,0.24)';
  ctx.beginPath();
  ctx.moveTo(154, 190);
  ctx.lineTo(192, 170);
  ctx.lineTo(192, 211);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(10,10,10,0.14)';
  ctx.font = '900 28px Arial, sans-serif';
  ctx.fillText('PRONOS', 270, 185);
  ctx.fillStyle = '#6b6258';
  ctx.font = '800 18px Arial, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('MERCADO GANADO', 134, 270);

  ctx.fillStyle = '#080808';
  ctx.font = '900 42px Arial, sans-serif';
  wrapText(ctx, item?.question || `Mercado #${displayMarketId || ''}`, 134, 326, 505, 48, 3);

  const pct = latestProbability(series, item);
  const oddsText = pct == null ? '—' : `${Math.round(pct)}%`;
  const cost = Number(item?.costBasis ?? item?.totalInvested ?? 0);
  const resultLabel = String(outcomeLabel || item?.outcomeLabel || 'Resultado ganador').slice(0, 28);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#079c59';
  ctx.font = '900 36px Arial, sans-serif';
  ctx.fillText(`Won on ${resultLabel}`, cutX + 42, 184);
  ctx.fillStyle = '#6b6258';
  ctx.font = '700 20px Arial, sans-serif';
  ctx.fillText('Cost', cutX + 42, 224);
  ctx.fillText('Odds', cutX + 42, 262);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#080808';
  ctx.font = '900 20px Arial, sans-serif';
  ctx.fillText(`${formatMxnp(cost)} MXNP`, ticket.x + ticket.w - 42, 224);
  ctx.fillText(oddsText, ticket.x + ticket.w - 42, 262);
  ctx.save();
  ctx.setLineDash([4, 9]);
  ctx.strokeStyle = '#d7c7b5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cutX + 42, 292);
  ctx.lineTo(ticket.x + ticket.w - 42, 292);
  ctx.stroke();
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#080808';
  ctx.font = '800 22px Arial, sans-serif';
  ctx.fillText('Cash Out', cutX + 42, 332);
  ctx.fillStyle = '#00b862';
  const cashText = `+${formatMxnp(amount)} MXNP`;
  ctx.font = cashText.length > 14 ? '900 46px Arial, sans-serif' : '900 58px Arial, sans-serif';
  ctx.fillText(cashText, cutX + 42, 396);

  ctx.fillStyle = '#ff5500';
  ctx.beginPath();
  ctx.moveTo(486, 555);
  ctx.lineTo(536, 531);
  ctx.lineTo(536, 592);
  ctx.lineTo(486, 568);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#050505';
  ctx.beginPath();
  ctx.moveTo(498, 562);
  ctx.lineTo(524, 550);
  ctx.lineTo(524, 573);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff7ec';
  ctx.font = '900 44px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Pronos', 558, 576);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('card_render_failed'));
    }, 'image/png', 0.95);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function marketShareUrl({ displayMarketId, username, amount, outcomeLabel, item }) {
  if (typeof window === 'undefined') return `/api/share/market?id=${encodeURIComponent(displayMarketId)}`;
  const params = new URLSearchParams({
    id: String(displayMarketId),
    app: 'points',
    account: displayHandle(username),
    cashout: String(Number(amount) || 0),
    outcome: String(outcomeLabel || item?.outcomeLabel || 'Resultado ganador').slice(0, 80),
  });
  const cost = Number(item?.costBasis ?? item?.totalInvested ?? 0);
  if (Number.isFinite(cost) && cost > 0) params.set('cost', String(cost));
  const pct = latestProbability([], item);
  if (pct != null) params.set('odds', `${Math.round(pct)}%`);
  return `${window.location.origin}/api/share/market?${params.toString()}`;
}

export default function PointsWinShareButton({ item, username, amount, outcomeLabel, compact = false }) {
  const [state, setState] = useState({ loading: false, message: null, error: null });
  const displayMarketId = item?.parentMarketId || item?.marketId;
  if (!item || !displayMarketId) return null;

  async function handleShare() {
    setState({ loading: true, message: null, error: null });
    try {
      const safeMarketId = String(displayMarketId).replace(/[^a-z0-9-]/gi, '');
      const blob = await makeWinCard({ item, username, amount, outcomeLabel });
      const filename = `pronos-victoria-${safeMarketId}.png`;
      const file = new File([blob], filename, { type: 'image/png' });
      const text = `Gané ${formatMxnp(amount)} MXNP en Pronos`;
      const shareUrl = marketShareUrl({ displayMarketId, username, amount, outcomeLabel, item });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: 'Mi victoria en Pronos',
          text,
          files: [file],
        });
        setState({ loading: false, message: 'Listo para compartir', error: null });
        return;
      }
      if (navigator.share) {
        await navigator.share({
          title: 'Mi victoria en Pronos',
          text,
          url: shareUrl,
        });
        downloadBlob(blob, filename);
        setState({ loading: false, message: 'Imagen descargada', error: null });
        return;
      }
      downloadBlob(blob, filename);
      setState({ loading: false, message: 'Imagen descargada', error: null });
    } catch (e) {
      if (e?.name === 'AbortError') {
        setState({ loading: false, message: null, error: null });
      } else {
        setState({ loading: false, message: null, error: 'No se pudo compartir' });
      }
    }
  }

  const label = state.loading
    ? 'Generando...'
    : state.error || state.message || (compact ? 'Compartir' : 'Compartir victoria');

  return (
    <button
      type="button"
      className="points-win-share-button"
      onClick={handleShare}
      disabled={state.loading}
      title="Crear una imagen para compartir esta victoria"
    >
      {label}
    </button>
  );
}
