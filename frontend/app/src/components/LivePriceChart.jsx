/**
 * LivePriceChart — pure-SVG live price line for 5-minute crypto markets.
 *
 * Shared by Points today and ready for MVP on-chain crypto markets once
 * the protocol-side market data exists.
 */

import React, { useMemo, useState } from 'react';
import {
  computeChartWindow,
  densifyPoints,
  filterVisiblePoints,
  nearestPointByX,
} from '../lib/cryptoChartMath.js';

const PADDING = { top: 12, right: 78, bottom: 18, left: 8 };

function formatTrackerPrice(price) {
  return '$' + Number(price).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatAxisPrice(price) {
  const value = Number(price);
  if (!Number.isFinite(value)) return '$—';
  return '$' + value.toLocaleString('en-US', {
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
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
  xStart,
  xEnd,
  highlightStart,
  highlightEnd,
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
    return (
      <div style={{
        width: '100%', height, borderRadius: 12,
        background: 'var(--surface2)', border: '1px solid var(--border)',
      }} />
    );
  }

  if (chartPoints.length === 0) return null;

  const { xMin, xMax } = frame;

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
  if (yMin === yMax) {
    yMin = yMin * 0.9995;
    yMax = yMax * 1.0005;
  } else {
    const pad = (yMax - yMin) * 0.15;
    yMin -= pad;
    yMax += pad;
  }

  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  function xAt(t) {
    return PADDING.left + ((t - xMin) / (xMax - xMin)) * innerW;
  }
  function yAt(price) {
    return PADDING.top + (1 - (price - yMin) / (yMax - yMin)) * innerH;
  }
  const plotRight = width - PADDING.right;

  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const ratio = i / 4;
    const price = yMax - (yMax - yMin) * ratio;
    return { price, y: yAt(price) };
  });

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
  const lineColor = !hasThreshold ? '#888888'
    : above ? 'var(--yes, #00C96B)'
    : below ? 'var(--red, #FF4545)'
    : 'var(--text-secondary)';
  const fillColor = !hasThreshold ? 'rgba(136,136,136,0.08)'
    : above ? 'rgba(0,201,107,0.10)'
    : 'rgba(255,69,69,0.10)';

  const baseY = yAt(yMin);
  let areaD = d;
  if (chartPoints.length >= 2) {
    areaD += ` L${xAt(chartPoints[chartPoints.length - 1].t).toFixed(2)},${baseY.toFixed(2)}`;
    areaD += ` L${xAt(chartPoints[0].t).toFixed(2)},${baseY.toFixed(2)} Z`;
  }

  const thresholdY = hasThreshold ? yAt(threshold) : null;
  const thresholdLabel = hasThreshold
    ? '$' + Number(threshold).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : '';
  const currentLabel = formatAxisPrice(lastPrice);
  const currentLabelWidth = Math.max(52, currentLabel.length * 6.6 + 14);
  const currentLabelX = width - currentLabelWidth - 4;
  const currentLabelY = Math.min(
    Math.max(lastY - 11, PADDING.top),
    height - PADDING.bottom - 16,
  );
  const hasHighlight = Number.isFinite(highlightStart)
    && Number.isFinite(highlightEnd)
    && highlightEnd > highlightStart
    && highlightEnd >= xMin
    && highlightStart <= xMax;
  const highlightX1 = hasHighlight ? Math.max(PADDING.left, xAt(Math.max(highlightStart, xMin))) : 0;
  const highlightX2 = hasHighlight ? Math.min(plotRight, xAt(Math.min(highlightEnd, xMax))) : 0;
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
      <g pointerEvents="none">
        {yTicks.map((tick, i) => (
          <g key={`${tick.price}-${i}`}>
            <line
              x1={PADDING.left}
              x2={plotRight}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--border)"
              strokeWidth="1"
              opacity={i === 0 || i === yTicks.length - 1 ? 0.22 : 0.16}
            />
            <text
              x={plotRight + 8}
              y={Math.min(Math.max(tick.y + 3, PADDING.top + 9), height - PADDING.bottom)}
              fontFamily="var(--font-mono, monospace)"
              fontSize="9"
              fill="var(--text-muted)"
            >
              {formatAxisPrice(tick.price)}
            </text>
          </g>
        ))}
      </g>

      {hasHighlight && highlightX2 > highlightX1 && (
        <rect
          x={highlightX1}
          y={PADDING.top}
          width={highlightX2 - highlightX1}
          height={innerH}
          fill={lineColor}
          opacity="0.055"
          pointerEvents="none"
        />
      )}

      {chartPoints.length >= 2 && (
        <path d={areaD} fill={fillColor} stroke="none" />
      )}

      {hasThreshold && thresholdY != null && (
        <>
          <line
            x1={PADDING.left}
            x2={plotRight}
            y1={thresholdY}
            y2={thresholdY}
            stroke="var(--text-muted)"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.6"
          />
          <text
            x={plotRight - 4}
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

      <line
        x1={PADDING.left}
        x2={plotRight}
        y1={lastY}
        y2={lastY}
        stroke={lineColor}
        strokeWidth="1"
        strokeDasharray="2 5"
        opacity="0.48"
        pointerEvents="none"
      />
      <rect
        x={currentLabelX}
        y={currentLabelY}
        width={currentLabelWidth}
        height="16"
        rx="5"
        fill="var(--surface0, #050505)"
        stroke={lineColor}
        opacity="0.96"
        pointerEvents="none"
      />
      <text
        x={currentLabelX + currentLabelWidth / 2}
        y={currentLabelY + 11}
        textAnchor="middle"
        fontFamily="var(--font-mono, monospace)"
        fontSize="9"
        fill={lineColor}
        pointerEvents="none"
      >
        {currentLabel}
      </text>

      <path d={d} fill="none" stroke={lineColor} strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" />

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

      <circle cx={lastX} cy={lastY} r="3.5" fill={lineColor}>
        <animate attributeName="r" values="3.5;5.5;3.5" dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.45;1" dur="1.4s" repeatCount="indefinite" />
      </circle>
      <circle cx={lastX} cy={lastY} r="2" fill={lineColor} />
    </svg>
  );
}
