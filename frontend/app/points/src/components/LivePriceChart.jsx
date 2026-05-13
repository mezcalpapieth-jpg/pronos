/**
 * LivePriceChart — pure-SVG live price line for the crypto 5-min markets.
 *
 * No charting library dependency — the renderer is small enough to keep
 * inline instead of pulling in lightweight-charts (~80kb gzipped) or
 * recharts. This is intentionally minimal:
 *
 *   - One line for the price history (color flips green/red around the
 *     threshold)
 *   - One dotted horizontal rule at the threshold
 *   - A pulsing dot at the rightmost (current) price
 *   - Pointer/touch tracker with the nearest price + timestamp
 *   - Y axis auto-scales to [min*0.999, max*1.001] so small movements
 *     read as visually meaningful
 *
 * Props:
 *   history    - [{ t, price }] in chronological order (from useCryptoTicker)
 *   threshold  - number | null   (null = pre-market, just show the line, no
 *                                 threshold rule, no green/red coloring)
 *   width      - SVG width in px (default 100% of container — see usage)
 *   height     - SVG height in px (default 200)
 *   windowMs   - sliding window length in ms (default 5 min) — anything
 *                older than (now - windowMs) is clipped from the X axis
 *
 * Renders nothing (returns null) until there's at least 1 point to draw,
 * so the parent can keep a stable layout while the WebSocket is opening.
 */

import React, { useMemo, useState } from 'react';
import {
  computeChartWindow,
  densifyPoints,
  filterVisiblePoints,
  nearestPointByX,
} from '../lib/cryptoChartMath.js';

const PADDING = { top: 12, right: 14, bottom: 18, left: 8 };

function formatTrackerPrice(price) {
  return '$' + Number(price).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTrackerTime(t) {
  return new Date(t).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function LivePriceChart({
  history,
  threshold,
  width = 800,
  height = 220,
  windowMs = 5 * 60_000,
  // Optional fixed-window anchors. When BOTH are set, the X axis runs
  // from xStart on the left to xEnd on the right regardless of how far
  // through the window we are — gives the crypto-5min markets a stable
  // chart that shows open-on-left, close-on-right for the full life of
  // the bout, instead of a sliding window that resets when the user
  // re-enters the page mid-window.
  xStart,
  xEnd,
}) {
  const [trackerX, setTrackerX] = useState(null);
  const frame = useMemo(
    () => computeChartWindow({ history, xStart, xEnd, windowMs }),
    [history, xStart, xEnd, windowMs]
  );
  const visible = useMemo(
    () => filterVisiblePoints(history, frame),
    [history, frame]
  );
  const chartPoints = useMemo(
    () => densifyPoints(visible, { intervalMs: 1_000 }),
    [visible]
  );

  if (!Array.isArray(history) || history.length === 0) {
    // Skeleton rectangle keeps layout stable while WS connects.
    return (
      <div style={{
        width: '100%', height, borderRadius: 12,
        background: 'var(--surface2)', border: '1px solid var(--border)',
      }} />
    );
  }

  if (chartPoints.length === 0) return null;

  const { xMin, xMax } = frame;

  // Y range: include the threshold (if set) so the rule is always
  // on-screen, plus a small padding so the line never touches edges.
  let yMin = chartPoints[0].price;
  let yMax = chartPoints[0].price;
  for (const p of chartPoints) {
    if (p.price < yMin) yMin = p.price;
    if (p.price > yMax) yMax = p.price;
  }
  if (threshold != null) {
    if (threshold < yMin) yMin = threshold;
    if (threshold > yMax) yMax = threshold;
  }
  // Add padding so a flat-line market still has visible vertical room.
  if (yMin === yMax) {
    yMin = yMin * 0.9995;
    yMax = yMax * 1.0005;
  } else {
    const pad = (yMax - yMin) * 0.15;
    yMin -= pad;
    yMax += pad;
  }

  const innerW = width  - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top  - PADDING.bottom;

  function xAt(t) {
    return PADDING.left + ((t - xMin) / (xMax - xMin)) * innerW;
  }
  function yAt(price) {
    return PADDING.top + (1 - (price - yMin) / (yMax - yMin)) * innerH;
  }

  // SVG path: M first, L the rest. chartPoints includes one-second
  // interpolated points between sparse server ticks so the line advances
  // like a live market chart without inventing new settlement data.
  let d = '';
  for (let i = 0; i < chartPoints.length; i++) {
    const x = xAt(chartPoints[i].t).toFixed(2);
    const y = yAt(chartPoints[i].price).toFixed(2);
    d += (i === 0 ? `M${x},${y}` : ` L${x},${y}`);
  }

  const lastPoint = chartPoints[chartPoints.length - 1];
  const lastPrice = lastPoint.price;
  const lastX = xAt(lastPoint.t);
  const lastY = yAt(lastPrice);
  const hasThreshold = typeof threshold === 'number' && Number.isFinite(threshold);
  const above = hasThreshold && lastPrice > threshold;
  const below = hasThreshold && lastPrice < threshold;
  // Color logic: green if currently above threshold, red if below, neutral
  // gray pre-threshold (the pending "next market" state).
  const lineColor = !hasThreshold ? '#888888'
    : above ? 'var(--yes, #00C96B)'
    : below ? 'var(--red, #FF4545)'
    : 'var(--text-secondary)';
  const fillColor = !hasThreshold ? 'rgba(136,136,136,0.08)'
    : above ? 'rgba(0,201,107,0.10)'
    : 'rgba(255,69,69,0.10)';

  // Build a closed area path for the subtle fill under the line. Same
  // points as the line, then drop down to baseline and close.
  const baseY = yAt(yMin);
  let areaD = d;
  if (chartPoints.length >= 2) {
    areaD += ` L${xAt(chartPoints[chartPoints.length - 1].t).toFixed(2)},${baseY.toFixed(2)}`;
    areaD += ` L${xAt(chartPoints[0].t).toFixed(2)},${baseY.toFixed(2)} Z`;
  }

  // Threshold rule line + label.
  const thresholdY = hasThreshold ? yAt(threshold) : null;
  const thresholdLabel = hasThreshold
    ? '$' + Number(threshold).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : '';
  const tracker = trackerX == null
    ? null
    : nearestPointByX(chartPoints, trackerX, {
        xMin,
        xMax,
        width,
        padding: PADDING,
      });
  const trackerPoint = tracker?.point || null;
  const trackerY = trackerPoint ? yAt(trackerPoint.price) : null;
  const trackerLabel = trackerPoint ? formatTrackerPrice(trackerPoint.price) : '';
  const trackerTime = trackerPoint ? formatTrackerTime(trackerPoint.t) : '';
  const trackerLabelWidth = Math.max(70, trackerLabel.length * 7.2 + 16);
  const trackerLabelX = tracker
    ? Math.min(Math.max(tracker.x + 8, PADDING.left), width - PADDING.right - trackerLabelWidth)
    : 0;
  const trackerLabelY = trackerY == null
    ? 0
    : Math.min(Math.max(trackerY - 32, PADDING.top + 2), height - PADDING.bottom - 44);

  function handlePointerMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pointerX = ((event.clientX - rect.left) / rect.width) * width;
    setTrackerX(pointerX);
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{
        width: '100%',
        height,
        display: 'block',
        cursor: 'crosshair',
        touchAction: 'none',
      }}
      role="img"
      aria-label="Gráfica de precio en vivo"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setTrackerX(null)}
      onPointerCancel={() => setTrackerX(null)}
    >
      {/* subtle area fill */}
      {chartPoints.length >= 2 && (
        <path d={areaD} fill={fillColor} stroke="none" />
      )}

      {/* threshold rule */}
      {hasThreshold && thresholdY != null && (
        <>
          <line
            x1={PADDING.left}
            x2={width - PADDING.right}
            y1={thresholdY}
            y2={thresholdY}
            stroke="var(--text-muted)"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.6"
          />
          <text
            x={width - PADDING.right - 4}
            y={thresholdY - 4}
            textAnchor="end"
            fontFamily="var(--font-mono, monospace)"
            fontSize="10"
            fill="var(--text-muted)"
          >
            {thresholdLabel}
          </text>
        </>
      )}

      {/* price line */}
      <path d={d} fill="none" stroke={lineColor} strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" />

      {/* pointer tracker */}
      {trackerPoint && trackerY != null && (
        <g pointerEvents="none">
          <line
            x1={tracker.x}
            x2={tracker.x}
            y1={PADDING.top}
            y2={height - PADDING.bottom}
            stroke="var(--text-muted)"
            strokeWidth="1"
            opacity="0.42"
          />
          <circle
            cx={tracker.x}
            cy={trackerY}
            r="4"
            fill="var(--surface0, #050505)"
            stroke={lineColor}
            strokeWidth="2"
          />
          <rect
            x={trackerLabelX}
            y={trackerLabelY}
            width={trackerLabelWidth}
            height="34"
            rx="6"
            fill="var(--surface0, #050505)"
            stroke="var(--border)"
            opacity="0.96"
          />
          <text
            x={trackerLabelX + 8}
            y={trackerLabelY + 14}
            fontFamily="var(--font-mono, monospace)"
            fontSize="11"
            fill="var(--text-primary)"
          >
            {trackerLabel}
          </text>
          <text
            x={trackerLabelX + 8}
            y={trackerLabelY + 28}
            fontFamily="var(--font-mono, monospace)"
            fontSize="9"
            fill="var(--text-muted)"
          >
            {trackerTime}
          </text>
        </g>
      )}

      {/* pulsing dot at current price */}
      <circle cx={lastX} cy={lastY} r="3.5" fill={lineColor}>
        <animate attributeName="r" values="3.5;5.5;3.5" dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.45;1" dur="1.4s" repeatCount="indefinite" />
      </circle>
      <circle cx={lastX} cy={lastY} r="2" fill={lineColor} />
    </svg>
  );
}
