import React, { useMemo, useState, useId, useRef, useLayoutEffect } from 'react';

/**
 * SVG sparkline chart for market probability history.
 * - Shows only real history; no synthetic random walk.
 * - If history is missing, renders a flat line at the current price.
 * - Optional right-side percentage label
 * - Hover anywhere on the chart to see timestamp + value tooltip
 * - Step segments: price holds flat between trades, then jumps
 * - Y axis fits the data instead of always spanning 0-100
 * - Optional bottom time axis (hours for intraday ranges, dates beyond that)
 * - Optional activity bars show real trade volume/count under the line
 * - Supports both `number[]` (mock) and `{t, p}[]` (real CLOB history)
 *
 * @param {number[]|{t:number,p:number}[]} data - Probability values (0-100)
 * @param {number} targetPct - Target percentage the line should end near (0-100)
 * @param {string} seed - Legacy prop kept for caller compatibility; no longer used.
 * @param {number} width - Fallback SVG width used before the container is measured
 * @param {number} height - SVG height
 * @param {string} color - Line color (CSS var or hex)
 * @param {boolean} fill - Show gradient fill under line
 * @param {number} strokeWidth - Line thickness
 * @param {{t:number,count?:number,volume?:number,buyVolume?:number,sellVolume?:number}[]} activity
 * @param {boolean} showValue - Render the percentage label to the right of the chart
 * @param {number} valueWidth - Width reserved for the right-side label (default 44)
 * @param {string} label - Optional left-side label (e.g. option name)
 * @param {number} labelWidth - Width reserved for the left-side label
 */

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatTimestamp(unixSeconds) {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
  const day = d.getDate();
  const mon = MONTHS_SHORT[d.getMonth()];
  const hour = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${day} ${mon}, ${hour}:${min}`;
}

// Intraday ranges read as clock time; multi-day ranges read as dates.
// `datetime` is the fallback for windows only a few days wide, where
// plain dates would repeat across neighbouring ticks.
function formatAxisTick(unixSeconds, mode) {
  const d = new Date(unixSeconds * 1000);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  if (mode === 'clock') return `${hh}:${mm}`;
  if (mode === 'clockSec') return `${hh}:${mm}:${d.getSeconds().toString().padStart(2, '0')}`;
  const date = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return mode === 'datetime' ? `${date} ${hh}h` : date;
}

// Rounded gridline steps for a 0-100 probability axis.
const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50];

function axisTicks(min, max, target = 4) {
  const span = Math.max(1e-6, max - min);
  const step = TICK_STEPS.find(s => span / s <= target + 1) || 50;
  const first = Math.ceil(min / step) * step;
  const out = [];
  for (let v = first; v <= max + 1e-6; v += step) out.push(Math.round(v));
  return out.length >= 2 ? out : [Math.round(min), Math.round(max)];
}

// Never zoom in so far that ordinary noise reads as a crash.
const MIN_DOMAIN_SPAN = 12;

export function priceDomain(values) {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 100 };
  const span = hi - lo;
  if (span < MIN_DOMAIN_SPAN) {
    const mid = (lo + hi) / 2;
    lo = mid - MIN_DOMAIN_SPAN / 2;
    hi = mid + MIN_DOMAIN_SPAN / 2;
  } else {
    const pad = span * 0.12;
    lo -= pad;
    hi += pad;
  }
  // Slide the window back inside [0,100] rather than collapsing it.
  const windowSpan = Math.min(100, hi - lo);
  if (lo < 0) { lo = 0; hi = windowSpan; }
  if (hi > 100) { hi = 100; lo = 100 - windowSpan; }
  return { min: Math.max(0, lo), max: Math.min(100, hi) };
}

export default function Sparkline({
  data,
  targetPct,
  seed = '',
  width = 280,
  height = 50,
  color = 'var(--yes)',
  fill = true,
  strokeWidth = 1.8,
  showValue = false,
  valueWidth = 44,
  label,
  labelWidth = 0,
  emptyLabel = 'Sin actividad todavía',
  emptySubLabel = 'El precio se moverá con el primer trade.',
  showEmptyState = true,
  showYAxis,
  showXAxis,
  domainMin,
  domainMax,
  fitDomain = false,
  xMode = 'time',
  jumpShape = 'step',
  activity = [],
  showActivity = true,
  style = {},
}) {
  const uid = useId().replace(/:/g, '');
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const plotRef = useRef(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);

  void seed;

  // The SVG used to be drawn in a fixed 280-unit coordinate space and
  // stretched to fit, which distorted every horizontal measurement (bar
  // widths, dash patterns, corner radii). Measuring the container keeps
  // the viewBox 1:1 with rendered pixels instead.
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

  const target = typeof targetPct === 'number' && Number.isFinite(targetPct)
    ? Math.max(0, Math.min(100, targetPct))
    : 50;

  const rawPoints = useMemo(() => {
    const source = Array.isArray(data) ? data : [];
    return source
      .map((pt) => {
        if (typeof pt === 'object' && pt !== null && 'p' in pt) {
          const p = Number(pt.p);
          if (!Number.isFinite(p)) return null;
          return {
            ...pt,
            p: Math.max(0, Math.min(100, p)),
          };
        }
        const p = Number(pt);
        return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : null;
      })
      .filter(Boolean);
  }, [data]);

  const hasRealHistory = rawPoints.length > 0;

  const points = useMemo(() => {
    if (rawPoints.length >= 2) return rawPoints;
    if (rawPoints.length === 1) {
      const only = rawPoints[0];
      if (typeof only === 'object' && only !== null) {
        const t = Number(only.t) || Math.floor(Date.now() / 1000);
        return [
          { ...only, t: t - 60 },
          only,
        ];
      }
      return [only, only];
    }
    const now = Math.floor(Date.now() / 1000);
    return [
      { t: now - 60, p: target },
      { t: now, p: target },
    ];
  }, [rawPoints, target]);

  const values = useMemo(() =>
    points.map(pt => (typeof pt === 'object' && pt !== null && 'p' in pt) ? pt.p : pt),
  [points]);

  const hasTimestamps = useMemo(() =>
    points.length > 0 && typeof points[0] === 'object' && points[0] !== null && 't' in points[0],
  [points]);

  const padX = 3;
  const padY = 4;
  const useMovementAxis = xMode === 'movement';
  const shouldShowYAxis = typeof showYAxis === 'boolean' ? showYAxis : height >= 100;
  const shouldShowXAxis = useMovementAxis
    ? false
    : (typeof showXAxis === 'boolean' ? showXAxis : height >= 100);
  const chartWidth = measuredWidth > 0
    ? measuredWidth
    : Math.max(20, width - labelWidth - (showValue ? valueWidth : 0));
  const yAxisGutter = shouldShowYAxis ? Math.min(34, Math.max(28, chartWidth * 0.06)) : 0;
  const xAxisHeight = shouldShowXAxis ? 18 : 0;
  const plotRight = Math.max(20, chartWidth - yAxisGutter);
  const plotBottom = Math.max(16, height - xAxisHeight);
  const w = Math.max(20, plotRight - padX * 2);
  const h = Math.max(10, plotBottom - padY * 2);

  // Domain rules, in order:
  //   1. An explicit domain always wins — stacked outcome rows pass a
  //      shared one so their heights stay comparable; a per-row fit
  //      would make 30% look as tall as 96%.
  //   2. Otherwise fit to the data only when the Y axis is actually
  //      drawn. Without labels there is nothing to tell the reader the
  //      scale moved, so a bare sparkline stays on the full 0-100 and
  //      keeps reading like every other bare sparkline in the app.
  const domain = useMemo(() => {
    if (Number.isFinite(domainMin) && Number.isFinite(domainMax) && domainMax > domainMin) {
      return { min: domainMin, max: domainMax };
    }
    return shouldShowYAxis || fitDomain ? priceDomain(values) : { min: 0, max: 100 };
  }, [values, domainMin, domainMax, shouldShowYAxis, fitDomain]);
  const yTicks = useMemo(
    () => (shouldShowYAxis ? axisTicks(domain.min, domain.max) : []),
    [shouldShowYAxis, domain],
  );

  const yForValue = (v) => {
    const range = Math.max(1e-6, domain.max - domain.min);
    const clamped = Math.max(domain.min, Math.min(domain.max, v));
    return padY + h - ((clamped - domain.min) / range) * h;
  };

  // A tick sitting on the baseline would collide with the time axis.
  const visibleYTicks = yTicks.filter(tick => yForValue(tick) < plotBottom - padY - 6);

  const timeBounds = useMemo(() => {
    if (useMovementAxis) return null;
    if (!hasTimestamps) return null;
    const priceTimes = points
      .map(pt => Number(pt?.t))
      .filter(t => Number.isFinite(t) && t > 0);
    if (priceTimes.length < 2) return null;
    const min = Math.min(...priceTimes);
    const max = Math.max(...priceTimes);
    return max > min ? { min, max } : null;
  }, [hasTimestamps, points, useMovementAxis]);

  const xForMovementIndex = (index, count) => {
    const denom = Math.max(1, count - 1);
    return padX + (Math.max(0, index) / denom) * w;
  };

  const xForTime = (t, fallbackIdx = 0, fallbackCount = values.length) => {
    const time = Number(t);
    if (timeBounds && Number.isFinite(time)) {
      const clamped = Math.max(timeBounds.min, Math.min(timeBounds.max, time));
      return padX + ((clamped - timeBounds.min) / (timeBounds.max - timeBounds.min)) * w;
    }
    return xForMovementIndex(fallbackIdx, fallbackCount);
  };

  // Evenly spaced time labels across the visible window. Under ~2 days
  // the useful unit is the clock; past that it's the date.
  const xTicks = useMemo(() => {
    if (!shouldShowXAxis || !timeBounds) return [];
    const span = timeBounds.max - timeBounds.min;
    const count = chartWidth < 420 ? 3 : 5;
    const times = [];
    for (let i = 0; i < count; i++) {
      times.push(timeBounds.min + (span * i) / (count - 1));
    }
    const build = (mode) => times.map(t => ({ t, labelText: formatAxisTick(t, mode) }));
    // Narrow windows collide at the chosen precision — a few days wide
    // repeats the calendar day, a few minutes wide repeats the minute.
    // Step up precision until no two neighbouring labels match.
    const modes = span <= 48 * 3600 ? ['clock', 'clockSec'] : ['date', 'datetime'];
    for (const mode of modes) {
      const built = build(mode);
      if (!built.some((tick, i) => i > 0 && tick.labelText === built[i - 1].labelText)) {
        return built;
      }
    }
    return build(modes[modes.length - 1]);
  }, [shouldShowXAxis, timeBounds, chartWidth]);

  const coords = values.map((v, i) => {
    const pt = points[i];
    return {
      x: xForTime(typeof pt === 'object' && pt !== null ? pt.t : null, i, values.length),
      y: yForValue(v),
      v,
      t: typeof pt === 'object' && pt !== null ? pt.t : null,
    };
  });

  const activityPoints = useMemo(() => {
    const source = Array.isArray(activity) ? activity : [];
    return source
      .map((pt) => {
        const t = Number(pt?.t);
        const count = Number(pt?.count || 0);
        const volume = Number(pt?.volume || 0);
        const buyVolume = Number(pt?.buyVolume || 0);
        const sellVolume = Number(pt?.sellVolume || 0);
        if (!Number.isFinite(t) || t <= 0) return null;
        if (!Number.isFinite(count) && !Number.isFinite(volume)) return null;
        return {
          t,
          count: Number.isFinite(count) ? Math.max(0, count) : 0,
          volume: Number.isFinite(volume) ? Math.max(0, volume) : 0,
          buyVolume: Number.isFinite(buyVolume) ? Math.max(0, buyVolume) : 0,
          sellVolume: Number.isFinite(sellVolume) ? Math.max(0, sellVolume) : 0,
        };
      })
      .filter(Boolean);
  }, [activity]);
  const hasActivity = activityPoints.length > 0;
  const maxActivity = Math.max(
    1,
    ...activityPoints.map(pt => (pt.volume > 0 ? pt.volume : pt.count)),
  );
  const activityBandHeight = showActivity && hasActivity
    ? Math.max(12, Math.min(24, plotBottom * 0.2))
    : 0;
  const activityBarWidth = Math.max(
    1.5,
    Math.min(7, w / Math.max(12, activityPoints.length * 1.35)),
  );

  // Step-after: the price holds where it was until the next trade, then
  // jumps. Diagonals would draw continuous drift that never happened
  // between two sparse snapshots.
  const linePath = (pts) => {
    if (pts.length < 2) return '';
    let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      if (jumpShape === 'soft-step') {
        const rampX = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * 0.72;
        d += ` L${rampX.toFixed(2)},${pts[i - 1].y.toFixed(2)}`;
      } else if (!useMovementAxis) {
        d += ` L${pts[i].x.toFixed(2)},${pts[i - 1].y.toFixed(2)}`;
      }
      d += ` L${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)}`;
    }
    return d;
  };

  const pathD = linePath(coords);
  const lastPt = coords[coords.length - 1];
  const fillD = `${pathD} L${lastPt.x.toFixed(2)},${plotBottom.toFixed(2)} L${coords[0].x.toFixed(2)},${plotBottom.toFixed(2)} Z`;
  const lastVal = Math.round(values[values.length - 1]);

  const gradientId = `sg-${uid}`;

  // Hover tracking — map mouse X to nearest data index
  function handleMouseMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * chartWidth;
    let bestIdx = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const distance = Math.abs(coords[i].x - relX);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIdx = i;
      }
    }
    setHoveredIdx(Math.max(0, Math.min(values.length - 1, bestIdx)));
  }

  const hPt = hoveredIdx !== null ? coords[hoveredIdx] : null;
  const hVal = hoveredIdx !== null ? Math.round(values[hoveredIdx]) : null;
  const hTime = hoveredIdx !== null && hasRealHistory && hasTimestamps
    ? formatTimestamp(points[hoveredIdx].t)
    : null;

  // Tooltip horizontal clamping (% of chart width)
  const tooltipLeftPct = hPt ? Math.max(12, Math.min(88, (hPt.x / chartWidth) * 100)) : 0;

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        ...style,
      }}
    >
      {label && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color,
            width: labelWidth,
            textAlign: 'right',
            flexShrink: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </span>
      )}

      <div
        ref={plotRef}
        style={{ position: 'relative', flex: 1, minWidth: 0, height }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIdx(null)}
      >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${chartWidth} ${height}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.12" />
            <stop offset="72%" stopColor={color} stopOpacity="0.04" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizontal rules so a value can be read off the line */}
        {shouldShowYAxis && visibleYTicks.map((tick) => (
          <line
            key={`grid-${tick}`}
            x1={padX}
            y1={yForValue(tick)}
            x2={plotRight}
            y2={yForValue(tick)}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray="2,4"
            opacity={0.5}
          />
        ))}

        {showActivity && hasActivity && (
          <g opacity="0.9">
            {activityPoints.map((pt, i) => {
              const metric = pt.volume > 0 ? pt.volume : pt.count;
              const barHeight = Math.max(2, (metric / maxActivity) * activityBandHeight);
              const x = xForTime(pt.t, i, activityPoints.length) - activityBarWidth / 2;
              const sellHeavy = pt.sellVolume > pt.buyVolume;
              return (
                <rect
                  key={`${pt.t}-${i}`}
                  x={Math.max(0, Math.min(plotRight - activityBarWidth, x))}
                  y={plotBottom - padY - barHeight}
                  width={activityBarWidth}
                  height={barHeight}
                  rx={0.8}
                  fill={sellHeavy ? '#ff3b3b' : color}
                  opacity={sellHeavy ? 0.22 : 0.2}
                />
              );
            })}
          </g>
        )}

        {fill && hasRealHistory && <path d={fillD} fill={`url(#${gradientId})`} />}

        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          opacity={hasRealHistory ? 1 : 0.45}
        />

        {/* Hovered crosshair + dot */}
        {hPt && (
          <>
            <line
              x1={hPt.x} y1={0}
              x2={hPt.x} y2={plotBottom}
              stroke={color}
              strokeWidth={0.7}
              strokeDasharray="3,3"
              opacity={0.45}
            />
            <circle
              cx={hPt.x} cy={hPt.y} r={3.5}
              fill={color}
              stroke="#fff"
              strokeWidth={1.5}
            />
          </>
        )}
      </svg>

      {/* End dot — HTML overlay so it stays perfectly circular */}
      {hoveredIdx === null && (
        <div
          style={{
            position: 'absolute',
            left: `${(lastPt.x / chartWidth) * 100}%`,
            top: `${(lastPt.y / height) * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: color,
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      )}

      {shouldShowYAxis && visibleYTicks.map((tick) => (
        <span
          key={`ylabel-${tick}`}
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 0,
            top: yForValue(tick),
            transform: 'translateY(-50%)',
            width: yAxisGutter,
            textAlign: 'right',
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: 'var(--text-muted)',
            opacity: 0.65,
            pointerEvents: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {tick}%
        </span>
      ))}

      {shouldShowXAxis && xTicks.map((tick, i) => (
        <span
          key={`xlabel-${tick.t}-${i}`}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${(xForTime(tick.t, i) / chartWidth) * 100}%`,
            bottom: 0,
            transform: i === 0
              ? 'none'
              : (i === xTicks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)'),
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-muted)',
            opacity: 0.6,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {tick.labelText}
        </span>
      ))}

      {showEmptyState && !hasRealHistory && !hasActivity && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            pointerEvents: 'none',
            textAlign: 'center',
          }}
        >
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-secondary)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            {emptyLabel}
          </span>
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'var(--text-muted)',
          }}>
            {emptySubLabel}
          </span>
        </div>
      )}

      {/* Hover tooltip */}
      {hPt && (
        <div
          style={{
            position: 'absolute',
            left: `${tooltipLeftPct}%`,
            top: `calc(${(hPt.y / height) * 100}% - 34px)`,
            transform: 'translateX(-50%)',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            fontVariantNumeric: 'tabular-nums',
            zIndex: 10,
          }}
        >
          {hTime ? `${hTime} · ` : ''}{hVal}%
        </div>
      )}
      </div>

      {showValue && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 600,
            color,
            width: valueWidth,
            textAlign: 'right',
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {hoveredIdx !== null ? `${hVal}%` : `${lastVal}%`}
        </span>
      )}

    </div>
  );
}
