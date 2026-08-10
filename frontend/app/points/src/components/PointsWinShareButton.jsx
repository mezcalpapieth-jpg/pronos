import React, { useState } from 'react';
import { fetchPriceHistory } from '../lib/pointsApi.js';

const CARD_W = 1080;
const CARD_H = 1350;

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

function drawGraph(ctx, series) {
  const x = 94;
  const y = 660;
  const w = 892;
  const h = 280;
  const values = (series || [])
    .map(probabilityFromPoint)
    .filter(v => Number.isFinite(v))
    .map(v => clamp(v, 0, 100));

  roundedRect(ctx, x, y, w, h, 28);
  ctx.fillStyle = '#101010';
  ctx.fill();
  ctx.strokeStyle = '#282828';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  roundedRect(ctx, x, y, w, h, 28);
  ctx.clip();

  for (const p of [25, 50, 75]) {
    const gy = y + h - (p / 100) * h;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 32, gy);
    ctx.lineTo(x + w - 32, gy);
    ctx.stroke();
  }

  if (values.length >= 2) {
    const px = i => x + 50 + (i / (values.length - 1)) * (w - 100);
    const py = v => y + h - 34 - (v / 100) * (h - 68);

    ctx.beginPath();
    values.forEach((v, i) => {
      const gx = px(i);
      const gy = py(v);
      if (i === 0) ctx.moveTo(gx, gy);
      else ctx.lineTo(gx, gy);
    });
    ctx.lineTo(px(values.length - 1), y + h - 34);
    ctx.lineTo(px(0), y + h - 34);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, y, 0, y + h);
    fill.addColorStop(0, 'rgba(0,232,122,0.26)');
    fill.addColorStop(1, 'rgba(0,232,122,0.02)');
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    values.forEach((v, i) => {
      const gx = px(i);
      const gy = py(v);
      if (i === 0) ctx.moveTo(gx, gy);
      else ctx.lineTo(gx, gy);
    });
    ctx.strokeStyle = '#00e87a';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    const last = values[values.length - 1];
    const lx = px(values.length - 1);
    const ly = py(last);
    ctx.fillStyle = '#00e87a';
    ctx.beginPath();
    ctx.arc(lx, ly, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '700 34px Arial, sans-serif';
    ctx.fillStyle = '#00e87a';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(last)}%`, x + w - 38, ly - 18);
  } else {
    ctx.font = '700 30px Arial, sans-serif';
    ctx.fillStyle = '#777';
    ctx.textAlign = 'center';
    ctx.fillText('Sin historial suficiente', x + w / 2, y + h / 2 + 10);
  }

  ctx.restore();
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
  bg.addColorStop(0, '#050505');
  bg.addColorStop(0.55, '#0d0d0d');
  bg.addColorStop(1, '#1a0d07');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.fillStyle = '#ff5a14';
  ctx.font = '700 34px Arial, sans-serif';
  ctx.fillText('PRONOS', 92, 110);
  ctx.beginPath();
  ctx.arc(270, 98, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#888';
  ctx.font = '700 26px Arial, sans-serif';
  ctx.fillText('MERCADO GANADO', 92, 174);

  ctx.fillStyle = '#fff';
  ctx.font = '900 92px Arial Narrow, Arial, sans-serif';
  ctx.fillText(`+${formatMxnp(amount)} MXNP`, 92, 292);

  ctx.fillStyle = '#aaa';
  ctx.font = '700 38px Arial, sans-serif';
  ctx.fillText(username ? `@${username}` : 'Usuario Pronos', 92, 360);

  roundedRect(ctx, 92, 420, 896, 182, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.11)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#ff5a14';
  ctx.font = '700 26px Arial, sans-serif';
  ctx.fillText('ELEGISTE', 132, 478);

  ctx.fillStyle = '#fff';
  ctx.font = '800 40px Arial, sans-serif';
  ctx.fillText(String(outcomeLabel || 'Resultado ganador').slice(0, 30), 132, 536);

  ctx.fillStyle = '#bbb';
  ctx.font = '700 30px Arial, sans-serif';
  wrapText(ctx, item?.question || `Mercado #${displayMarketId || ''}`, 132, 1040, 820, 42, 4);

  drawGraph(ctx, series);

  ctx.fillStyle = '#ff5a14';
  ctx.font = '700 28px Arial, sans-serif';
  ctx.fillText('pronos.io', 92, 1262);
  ctx.fillStyle = '#777';
  ctx.font = '500 24px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Predice. Compite. Comparte.', 988, 1262);

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
          url: `${window.location.origin}/market?id=${encodeURIComponent(displayMarketId)}`,
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
