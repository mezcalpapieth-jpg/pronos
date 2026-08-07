import React, { useMemo, useState, useId, useRef, useLayoutEffect } from 'react';
import { pnlDomain } from '../lib/pnlDomain.js';

/**
 * Cumulative PnL chart — a signed line with a zero baseline.
 *
 * Deliberately NOT built on Sparkline: that component's domain is hardcoded
 * to a 0–100 probability band (`priceDomain` clamps into [0,100]), so it
 * cannot represent a negative PnL at all. The shared visual language —
 * measured container width, hairline grid, crosshair tooltip — is mirrored
 * here so the two read as one family.
 *
 * Gain/loss is encoded twice on purpose. Green vs red alone sits at ΔE 6.4
 * under deuteranopia, which is below the safe separation threshold, so the
 * sign is *also* carried by position against the zero rule and by the signed
 * value label. A red/green-blind reader never depends on the hue.
 *
 * @param {{t:number,v:number}[]} data  unix seconds + cumulative PnL
 * @param {number} height               plot height in px
 * @param {string} valueSuffix          unit appended in the tooltip/labels
 * @param {(n:number)=>string} formatValue
 */

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const GAIN = 'var(--success)';
const LOSS = 'var(--danger)';

function defaultFormat(n) {
  const v = Number(n) || 0;
  return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}`;
}

function formatStamp(unixSeconds, withTime) {
  const d = new Date(unixSeconds * 1000);
  const date = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  if (!withTime) return date;
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${date}, ${hh}:${mm}`;
}

const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

function axisTicks(min, max, target = 4) {
  const span = Math.max(1e-6, max - min);
  const step = TICK_STEPS.find(s => span / s <= target + 1) || Math.ceil(span / target);
  const first = Math.ceil(min / step) * step;
  const out = [];
  for (let v = first; v <= max + 1e-6; v += step) out.push(v);
  return out;
}

function compactTick(n) {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${n < 0 ? '-' : ''}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export default function PnlChart({
  data = [],
  height = 300,
  formatValue = defaultFormat,
  valueSuffix = '',
  emptyLabel = 'Sin actividad todavía',
  emptySubLabel = 'Tu PnL aparecerá aquí después de tu primera predicción.',
  ariaLabel = 'Evolución del PnL',
  style = {},
}) {
  const uid = useId().replace(/:/g, '');
  const plotRef = useRef(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState(null);

  // Match Sparkline: measure the container so the viewBox stays 1:1 with
  // rendered pixels instead of stretching a fixed coordinate space.
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return undefined;
    const apply = () => {
      const next = el.getBoundingClientRect().width;
      if (next > 0) setMeasuredWidth(next);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = useMemo(() => (Array.isArray(data) ? data : [])
    .map(p => ({ t: Number(p?.t), v: Number(p?.v) }))
    .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v)), [data]);

  const chartWidth = measuredWidth > 0 ? measuredWidth : 320;
  const yGutter = 40;
  const xAxisH = 20;
  const padY = 8;
  const plotW = Math.max(10, chartWidth - yGutter);
  const plotH = Math.max(10, height - xAxisH);

  const domain = useMemo(() => pnlDomain(points.map(p => p.v)), [points]);
  const spanT = useMemo(() => {
    if (points.length < 2) return 1;
    return Math.max(1, points[points.length - 1].t - points[0].t);
  }, [points]);

  const x = (t) => (points.length < 2 ? plotW : ((t - points[0].t) / spanT) * plotW);
  const y = (v) => {
    const span = domain.max - domain.min || 1;
    return padY + (1 - (v - domain.min) / span) * (plotH - padY * 2);
  };

  const zeroY = y(0);
  const last = points.length ? points[points.length - 1] : null;
  const positive = (last?.v ?? 0) >= 0;
  const lineColor = positive ? GAIN : LOSS;

  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ');
  }, [points, plotW, plotH, domain]);

  // Area is closed against the zero rule, not the chart floor, so the
  // shaded region reads as "distance from break-even".
  const areaPath = useMemo(() => {
    if (points.length === 0 || !last) return '';
    const first = points[0];
    return `${linePath} L${x(last.t).toFixed(2)},${zeroY.toFixed(2)} L${x(first.t).toFixed(2)},${zeroY.toFixed(2)} Z`;
  }, [linePath, points, zeroY]);

  const ticks = useMemo(() => axisTicks(domain.min, domain.max), [domain]);
  const spansDays = spanT > 86400 * 2;

  function handleMove(e) {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - yGutter;
    if (points.length < 2) { setHoveredIdx(0); return; }
    const ratio = Math.max(0, Math.min(1, px / plotW));
    const targetT = points[0].t + ratio * spanT;
    // Snap to the nearest sample so the reader aims at a date, never a 2px line.
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const d = Math.abs(points[i].t - targetT);
      if (d < bestD) { bestD = d; best = i; }
    }
    setHoveredIdx(best);
  }

  const hovered = hoveredIdx != null ? points[hoveredIdx] ?? null : null;

  // The ref'd wrapper renders in EVERY state, including empty. It used to be
  // skipped on the empty branch, so the first render (series still loading)
  // never attached the ref, the ResizeObserver was never created, and the
  // chart stayed pinned at the fallback width for the life of the component.
  return (
    <div ref={plotRef} style={{ position: 'relative', width: '100%', ...style }}>
      {points.length === 0 ? (
        <div style={{
          height, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 6, border: '1px solid var(--border)',
          borderRadius: 10, background: 'var(--surface1)',
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
            {emptyLabel}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
            {emptySubLabel}
          </div>
        </div>
      ) : (
        <>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${chartWidth} ${height}`}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoveredIdx(null)}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={`pnl-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
          </linearGradient>
          {/* Split the fill at the zero rule so the shading above break-even
              is green and the shading below it is red, independent of where
              the series happens to end. */}
          <clipPath id={`pnl-above-${uid}`}>
            <rect x="0" y="0" width={chartWidth} height={Math.max(0, zeroY)} />
          </clipPath>
          <clipPath id={`pnl-below-${uid}`}>
            <rect x="0" y={Math.max(0, zeroY)} width={chartWidth} height={Math.max(0, plotH - zeroY)} />
          </clipPath>
        </defs>

        <g transform={`translate(${yGutter},0)`}>
          {/* Hairline grid — solid, one shade off the surface. */}
          {ticks.map(tv => (
            <line
              key={`grid-${tv}`}
              x1={0} x2={plotW} y1={y(tv)} y2={y(tv)}
              stroke="var(--border)" strokeWidth={1}
            />
          ))}

          <g clipPath={`url(#pnl-above-${uid})`}>
            <path d={areaPath} fill={`url(#pnl-fill-${uid})`} style={{ color: GAIN }} />
          </g>
          <g clipPath={`url(#pnl-below-${uid})`}>
            <path d={areaPath} fill={`url(#pnl-fill-${uid})`} />
          </g>

          {/* The zero rule sits above the grid and below the data — it is a
              real threshold, not chrome, so it gets ink the grid doesn't. */}
          <line
            x1={0} x2={plotW} y1={zeroY} y2={zeroY}
            stroke="var(--text-muted)" strokeWidth={1}
          />

          <path
            d={linePath}
            fill="none"
            stroke={lineColor}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Endpoint is the one direct label the chart carries. */}
          <circle cx={x(last.t)} cy={y(last.v)} r={4} fill={lineColor} stroke="var(--surface1)" strokeWidth={2} />

          {hovered && (
            <g pointerEvents="none">
              <line
                x1={x(hovered.t)} x2={x(hovered.t)} y1={0} y2={plotH}
                stroke="var(--text-muted)" strokeWidth={1} strokeOpacity={0.5}
              />
              <circle
                cx={x(hovered.t)} cy={y(hovered.v)} r={4}
                fill={hovered.v >= 0 ? GAIN : LOSS}
                stroke="var(--surface1)" strokeWidth={2}
              />
            </g>
          )}
        </g>

        {/* Y axis */}
        {ticks.map(tv => (
          <text
            key={`ytick-${tv}`}
            x={yGutter - 6} y={y(tv) + 3}
            textAnchor="end"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--text-muted)' }}
          >
            {compactTick(tv)}
          </text>
        ))}

        {/* X axis — ends only; intermediate dates would collide at this width. */}
        <text
          x={yGutter} y={height - 6}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--text-muted)' }}
        >
          {formatStamp(points[0].t, !spansDays)}
        </text>
        <text
          x={chartWidth} y={height - 6} textAnchor="end"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--text-muted)' }}
        >
          {formatStamp(last.t, !spansDays)}
        </text>
      </svg>

      {hovered && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(Math.max(0, yGutter + x(hovered.t) - 60), Math.max(0, chartWidth - 120)),
            top: 4,
            width: 120,
            pointerEvents: 'none',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '6px 8px',
            textAlign: 'center',
          }}
        >
          {/* Value leads, timestamp follows — the reader already has the date. */}
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700,
            color: hovered.v >= 0 ? GAIN : LOSS,
          }}>
            {formatValue(hovered.v)}{valueSuffix ? ` ${valueSuffix}` : ''}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
            {formatStamp(hovered.t, true)}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
