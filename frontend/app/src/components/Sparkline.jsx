import React, { useMemo, useState, useId } from 'react';

/**
 * SVG sparkline chart for market probability history.
 * - Shows only real history; no synthetic random walk.
 * - If history is missing, renders a flat line at the current price.
 * - Optional right-side percentage label
 * - Hover anywhere on the chart to see timestamp + value tooltip
 * - Straight segments so every vertex represents an actual snapshot
 * - Optional activity bars show real trade volume/count under the line
 * - Supports both `number[]` (mock) and `{t, p}[]` (real CLOB history)
 *
 * @param {number[]|{t:number,p:number}[]} data - Probability values (0-100)
 * @param {number} targetPct - Target percentage the line should end near (0-100)
 * @param {string} seed - Legacy prop kept for caller compatibility; no longer used.
 * @param {number} width - SVG width
 * @param {number} height - SVG height
 * @param {string} color - Line color (CSS var or hex)
 * @param {boolean} fill - Show gradient fill under line
 * @param {number} strokeWidth - Line thickness
 * @param {{t:number,count?:number,volume?:number,buyVolume?:number,sellVolume?:number}[]} activity
 * @param {boolean} showValue - Render the percentage label to the right of the chart
 * @param {number} valueWidth - Width reserved for the right-side label (default 44)
 * @param {string} label - Optional left-side label (e.g. option name)
 * @param {number} labelWidth - Width reserved for the left-side label
 * @param {boolean} showActivityMarkers - Render activity dots on the line
 */

function formatTimestamp(unixSeconds) {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const day = d.getDate();
  const mon = months[d.getMonth()];
  const hour = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${day} ${mon}, ${hour}:${min}`;
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
  activity = [],
  showActivity = true,
  showActivityMarkers = true,
  style = {},
}) {
  const uid = useId().replace(/:/g, '');
  const [hoveredIdx, setHoveredIdx] = useState(null);

  void seed;

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

  const chartWidth = Math.max(20, width - labelWidth - (showValue ? valueWidth : 0));
  const padX = 3;
  const padY = 4;
  const w = chartWidth - padX * 2;
  const h = height - padY * 2;
  const shouldShowYAxis = typeof showYAxis === 'boolean' ? showYAxis : height >= 100;

  const timeBounds = useMemo(() => {
    if (!hasTimestamps) return null;
    const priceTimes = points
      .map(pt => Number(pt?.t))
      .filter(t => Number.isFinite(t) && t > 0);
    const activityTimes = (Array.isArray(activity) ? activity : [])
      .map(pt => Number(pt?.t))
      .filter(t => Number.isFinite(t) && t > 0);
    const times = [...priceTimes, ...activityTimes];
    if (times.length < 2) return null;
    const min = Math.min(...times);
    const max = Math.max(...times);
    return max > min ? { min, max } : null;
  }, [activity, hasTimestamps, points]);

  const xForTime = (t, fallbackIdx = 0) => {
    const time = Number(t);
    if (timeBounds && Number.isFinite(time)) {
      const clamped = Math.max(timeBounds.min, Math.min(timeBounds.max, time));
      return padX + ((clamped - timeBounds.min) / (timeBounds.max - timeBounds.min)) * w;
    }
    const denom = Math.max(1, values.length - 1);
    return padX + (fallbackIdx / denom) * w;
  };

  const coords = values.map((v, i) => {
    const pt = points[i];
    return {
      x: xForTime(typeof pt === 'object' && pt !== null ? pt.t : null, i),
      y: padY + h - (v / 100) * h,
      v,
      t: typeof pt === 'object' && pt !== null ? pt.t : null,
    };
  });

  const yForX = (x) => {
    if (coords.length === 0) return height / 2;
    if (x <= coords[0].x) return coords[0].y;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const next = coords[i];
      const minX = Math.min(prev.x, next.x);
      const maxX = Math.max(prev.x, next.x);
      if (x >= minX && x <= maxX) {
        const span = next.x - prev.x;
        const ratio = span === 0 ? 0 : (x - prev.x) / span;
        return prev.y + (next.y - prev.y) * ratio;
      }
    }
    return coords[coords.length - 1].y;
  };

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
    ? Math.max(12, Math.min(24, height * 0.2))
    : 0;
  const activityBarWidth = Math.max(
    1.5,
    Math.min(7, w / Math.max(12, activityPoints.length * 1.35)),
  );
  const activityMarkers = showActivityMarkers && hasActivity
    ? activityPoints.map((pt, i) => {
        const metric = pt.volume > 0 ? pt.volume : pt.count;
        const x = xForTime(pt.t, i);
        const sellHeavy = pt.sellVolume > pt.buyVolume;
        return {
          ...pt,
          x,
          y: yForX(x),
          metric,
          sellHeavy,
          r: Math.max(2.3, Math.min(5.4, 2.3 + (metric / maxActivity) * 3.1)),
        };
      })
    : [];

  const linePath = (pts) => {
    if (pts.length < 2) return '';
    let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)}`;
    }
    return d;
  };

  const pathD = linePath(coords);
  const lastPt = coords[coords.length - 1];
  const fillD = `${pathD} L${lastPt.x.toFixed(2)},${height} L${coords[0].x.toFixed(2)},${height} Z`;
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
        style={{ position: 'relative', flex: 1, minWidth: 0, height }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIdx(null)}
      >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${chartWidth} ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.12" />
            <stop offset="72%" stopColor={color} stopOpacity="0.04" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {showActivity && hasActivity && (
          <g opacity="0.9">
            {activityPoints.map((pt, i) => {
              const metric = pt.volume > 0 ? pt.volume : pt.count;
              const barHeight = Math.max(2, (metric / maxActivity) * activityBandHeight);
              const x = xForTime(pt.t, i) - activityBarWidth / 2;
              const sellHeavy = pt.sellVolume > pt.buyVolume;
              return (
                <rect
                  key={`${pt.t}-${i}`}
                  x={Math.max(0, Math.min(chartWidth - activityBarWidth, x))}
                  y={height - padY - barHeight}
                  width={activityBarWidth}
                  height={barHeight}
                  rx={activityBarWidth / 2}
                  fill={sellHeavy ? '#ff3b3b' : color}
                  opacity={sellHeavy ? 0.36 : 0.28}
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

        {activityMarkers.length > 0 && (
          <g>
            {activityMarkers.map((pt, i) => (
              <circle
                key={`${pt.t}-marker-${i}`}
                cx={pt.x}
                cy={pt.y}
                r={pt.r}
                fill={pt.sellHeavy ? '#ff3b3b' : color}
                stroke="var(--surface1)"
                strokeWidth={1.2}
                opacity={0.82}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        )}

        {/* Hovered crosshair + dot */}
        {hPt && (
          <>
            <line
              x1={hPt.x} y1={0}
              x2={hPt.x} y2={height}
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

      {shouldShowYAxis && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            height,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: 'var(--text-muted)',
            opacity: 0.65,
            pointerEvents: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {[100, 75, 50, 25, 0].map(v => <span key={v}>{v}%</span>)}
        </div>
      )}

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
