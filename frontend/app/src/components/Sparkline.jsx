import React, { useMemo } from 'react';

/**
 * SVG sparkline chart for market probability history.
 * Generates mock price data seeded from targetPct if none provided.
 *
 * @param {number[]} data - Array of probability values (0-100)
 * @param {number} targetPct - Target percentage the line should end near (0-100)
 * @param {string} seed - Deterministic seed string (e.g. market id + option label)
 * @param {number} width - SVG width
 * @param {number} height - SVG height
 * @param {string} color - Line color (CSS var or hex)
 * @param {boolean} fill - Show gradient fill under line
 * @param {number} strokeWidth - Line thickness
 */
export default function Sparkline({
  data,
  targetPct,
  seed = '',
  width = 200,
  height = 50,
  color = 'var(--yes)',
  fill = true,
  strokeWidth = 1.5,
  style = {},
}) {
  // Simple seeded PRNG so each market+option gets a stable chart
  const seededRandom = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return () => {
      h = (h * 1664525 + 1013904223) | 0;
      return ((h >>> 0) / 4294967296);
    };
  };

  const points = useMemo(() => {
    if (data && data.length > 1) return data;

    const rng = seed ? seededRandom(seed) : Math.random.bind(Math);
    const target = typeof targetPct === 'number' ? Math.max(2, Math.min(98, targetPct)) : 50;
    const len = 30;

    // Start somewhere plausible, drift toward target
    const start = Math.max(5, Math.min(95, target + (rng() - 0.5) * 30));
    const pts = [start];
    for (let i = 1; i < len; i++) {
      const progress = i / (len - 1);
      // Pull toward target more strongly as we approach the end
      const pull = (target - pts[i - 1]) * 0.08 * (1 + progress * 2);
      const noise = (rng() - 0.5) * 5;
      const next = Math.max(2, Math.min(98, pts[i - 1] + pull + noise));
      pts.push(next);
    }
    // Ensure last point is very close to target
    pts[len - 1] = target + (rng() - 0.5) * 2;
    return pts;
  }, [data, targetPct, seed]);

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
