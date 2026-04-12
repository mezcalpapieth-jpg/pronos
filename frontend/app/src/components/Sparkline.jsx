import React, { useMemo, useState, useId } from 'react';

/**
 * SVG sparkline chart for market probability history.
 * - Seeded mock data drifting toward targetPct
 * - Optional right-side percentage label
 * - Hover anywhere on the chart to see timestamp + value tooltip
 * - Smooth curve with gradient fill and glowing end dot
 * - Supports both `number[]` (mock) and `{t, p}[]` (real CLOB history)
 *
 * @param {number[]|{t:number,p:number}[]} data - Probability values (0-100)
 * @param {number} targetPct - Target percentage the line should end near (0-100)
 * @param {string} seed - Deterministic seed string (e.g. market id + option label)
 * @param {number} width - SVG width
 * @param {number} height - SVG height
 * @param {string} color - Line color (CSS var or hex)
 * @param {boolean} fill - Show gradient fill under line
 * @param {number} strokeWidth - Line thickness
 * @param {boolean} showValue - Render the percentage label to the right of the chart
 * @param {number} valueWidth - Width reserved for the right-side label (default 44)
 * @param {string} label - Optional left-side label (e.g. option name)
 * @param {number} labelWidth - Width reserved for the left-side label
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
  style = {},
}) {
  const uid = useId().replace(/:/g, '');
  const [hoveredIdx, setHoveredIdx] = useState(null);

  // Seeded PRNG — stable chart per market + option
  const points = useMemo(() => {
    const seededRandom = (s) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h * 16777619) >>> 0;
      }
      return () => {
        h = (h * 1664525 + 1013904223) >>> 0;
        return (h >>> 0) / 4294967296;
      };
    };

    if (data && data.length > 1) return data;
    const rng = seed ? seededRandom(seed) : Math.random.bind(Math);
    const target = typeof targetPct === 'number' ? Math.max(2, Math.min(98, targetPct)) : 50;
    const len = 32;
    const start = Math.max(5, Math.min(95, target + (rng() - 0.5) * 30));
    const pts = [start];
    for (let i = 1; i < len; i++) {
      const progress = i / (len - 1);
      const pull = (target - pts[i - 1]) * 0.08 * (1 + progress * 2);
      const noise = (rng() - 0.5) * 5;
      const next = Math.max(2, Math.min(98, pts[i - 1] + pull + noise));
      pts.push(next);
    }
    pts[len - 1] = target + (rng() - 0.5) * 1.5;
    return pts;
  }, [data, targetPct, seed]);

  // Normalize: extract numeric values and detect timestamps
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

  // Normalize to visual range — give some breathing room
  const min = Math.min(...values);
  const max = Math.max(...values);
  const visMin = Math.max(0, min - 3);
  const visMax = Math.min(100, max + 3);
  const range = visMax - visMin || 1;

  const coords = values.map((v, i) => ({
    x: padX + (i / (values.length - 1)) * w,
    y: padY + h - ((v - visMin) / range) * h,
    v,
  }));

  // Smooth curve using cubic Bezier (Catmull-Rom -> cubic)
  const smoothPath = (pts) => {
    if (pts.length < 2) return '';
    let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const t = 0.2;
      const c1x = p1.x + (p2.x - p0.x) * t;
      const c1y = p1.y + (p2.y - p0.y) * t;
      const c2x = p2.x - (p3.x - p1.x) * t;
      const c2y = p2.y - (p3.y - p1.y) * t;
      d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
    }
    return d;
  };

  const pathD = smoothPath(coords);
  const lastPt = coords[coords.length - 1];
  const fillD = `${pathD} L${lastPt.x.toFixed(2)},${height} L${coords[0].x.toFixed(2)},${height} Z`;
  const lastVal = Math.round(values[values.length - 1]);

  const gradientId = `sg-${uid}`;
  const glowId = `gl-${uid}`;

  // Hover tracking — map mouse X to nearest data index
  function handleMouseMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(relX * (values.length - 1));
    setHoveredIdx(Math.max(0, Math.min(values.length - 1, idx)));
  }

  const hPt = hoveredIdx !== null ? coords[hoveredIdx] : null;
  const hVal = hoveredIdx !== null ? Math.round(values[hoveredIdx]) : null;
  const hTime = hoveredIdx !== null && hasTimestamps ? formatTimestamp(points[hoveredIdx].t) : null;

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
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="60%" stopColor={color} stopOpacity="0.08" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {fill && <path d={fillD} fill={`url(#${gradientId})`} />}

        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          filter={`url(#${glowId})`}
        />

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
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: color,
            boxShadow: `0 0 12px ${color}, 0 0 4px ${color}`,
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 3,
              borderRadius: '50%',
              background: '#fff',
            }}
          />
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
            border: `1px solid ${color}`,
            borderRadius: 6,
            padding: '4px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            color,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: `0 4px 14px rgba(0,0,0,0.35), 0 0 16px ${color}40`,
            zIndex: 10,
          }}
        >
          {hTime ? `${hTime} · ` : ''}{hVal}%
          <div
            style={{
              position: 'absolute',
              bottom: -4,
              left: '50%',
              transform: 'translateX(-50%) rotate(45deg)',
              width: 6,
              height: 6,
              background: 'var(--surface2)',
              borderRight: `1px solid ${color}`,
              borderBottom: `1px solid ${color}`,
            }}
          />
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
            textShadow: `0 0 8px ${color}40`,
          }}
        >
          {hoveredIdx !== null ? `${hVal}%` : `${lastVal}%`}
        </span>
      )}

    </div>
  );
}
