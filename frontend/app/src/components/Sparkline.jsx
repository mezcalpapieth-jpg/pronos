import React, { useMemo } from 'react';

/**
 * SVG sparkline chart for market probability history.
 * Generates mock price data if none provided.
 *
 * @param {number[]} data - Array of probability values (0-100)
 * @param {number} width - SVG width
 * @param {number} height - SVG height
 * @param {string} color - Line color (CSS var or hex)
 * @param {boolean} fill - Show gradient fill under line
 * @param {number} strokeWidth - Line thickness
 */
export default function Sparkline({
  data,
  width = 200,
  height = 50,
  color = 'var(--yes)',
  fill = true,
  strokeWidth = 1.5,
  style = {},
}) {
  // Generate mock data if not provided, seeded by data length or random
  const points = useMemo(() => {
    if (data && data.length > 1) return data;
    // Generate realistic-looking price movement
    const len = 30;
    const start = 40 + Math.random() * 30;
    const pts = [start];
    for (let i = 1; i < len; i++) {
      const drift = (Math.random() - 0.48) * 6;
      const next = Math.max(2, Math.min(98, pts[i - 1] + drift));
      pts.push(next);
    }
    return pts;
  }, [data]);

  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const coords = points.map((v, i) => ({
    x: padding + (i / (points.length - 1)) * w,
    y: padding + h - ((v - min) / range) * h,
  }));

  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  const fillD = pathD + ` L${coords[coords.length - 1].x.toFixed(1)},${height} L${coords[0].x.toFixed(1)},${height} Z`;

  const gradientId = `spark-grad-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', ...style }}>
      {fill && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.2" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={fillD} fill={`url(#${gradientId})`} />
        </>
      )}
      <path d={pathD} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      {/* End dot */}
      <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r={2.5} fill={color} />
    </svg>
  );
}
