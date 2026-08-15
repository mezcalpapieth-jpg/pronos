import React, { useMemo, useState, useId, useRef, useLayoutEffect } from 'react';
import { priceDomain } from './Sparkline.jsx';

/**
 * Multi-outcome price chart: every outcome drawn on ONE shared axis,
 * the way Polymarket draws them. Stacking one small chart per outcome
 * (what this replaces) made comparison impossible — a 20% line and a
 * 95% line looked identical because each row had its own baseline.
 *
 * - One y domain and one time axis for all series
 * - Legend on top carries the current value per outcome; on hover it
 *   switches to the hovered value, so no giant multi-row tooltip
 * - Step-after segments: the price holds until the next trade, then jumps
 * - Real trade activity from every outcome merged into one volume band
 * - Series with no history yet render as a dim flat line at their
 *   current price instead of vanishing
 *
 * @param {{key?:string,label:string,color:string,data:{t:number,p:number}[],targetPct:number}[]} series
 * @param {{t:number,count?:number,volume?:number,buyVolume?:number,sellVolume?:number}[][]} activity
 *        One activity array per series; merged into a single band.
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

function formatAxisTick(unixSeconds, mode) {
  const d = new Date(unixSeconds * 1000);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  if (mode === 'clock') return `${hh}:${mm}`;
  if (mode === 'clockSec') return `${hh}:${mm}:${d.getSeconds().toString().padStart(2, '0')}`;
  const date = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return mode === 'datetime' ? `${date} ${hh}h` : date;
}

const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50];

function axisTicks(min, max, target = 4) {
  const span = Math.max(1e-6, max - min);
  const step = TICK_STEPS.find(s => span / s <= target + 1) || 50;
  const first = Math.ceil(min / step) * step;
  const out = [];
  for (let v = first; v <= max + 1e-6; v += step) out.push(Math.round(v));
  return out.length >= 2 ? out : [Math.round(min), Math.round(max)];
}

const clampPct = (v) => Math.max(0, Math.min(100, v));

// Last point at or before `time` — the price the market was actually
// showing then, since a series holds flat between trades.
function valueAt(points, time) {
  if (!points.length || time < points[0].t) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (points[mid].t <= time) lo = mid; else hi = mid - 1;
  }
  return points[lo].p;
}

export default function MultiSparkline({
  series = [],
  activity = [],
  height = 240,
  width = 320,
  strokeWidth = 1.5,
  showActivity = true,
  emptyLabel = 'Sin actividad todavía',
  emptySubLabel = 'El precio se moverá con el primer trade.',
  showEmptyState = true,
  legendNote = null,
  domainMin,
  domainMax,
  timeMin,
  timeMax,
  xMode = 'time',
  jumpShape = 'step',
  style = {},
}) {
  const uid = useId().replace(/:/g, '');
  const [hoveredTime, setHoveredTime] = useState(null);
  const plotRef = useRef(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);

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

  // Only timestamped snapshots can share an axis; anything without a
  // time has no place on it.
  const lines = useMemo(() => series.map((s, i) => {
    const raw = Array.isArray(s?.data) ? s.data : [];
    const sorted = raw
      .map((pt) => {
        if (!pt || typeof pt !== 'object') return null;
        const p = Number(pt.p);
        const t = Number(pt.t);
        if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return null;
        return { t, p: clampPct(p) };
      })
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);
    // Snapshots sharing a timestamp collapse to the last one — on a
    // step-after chart, earlier same-instant values render as a
    // zero-width spike instead of a hold, since they share an x
    // coordinate with the value that immediately supersedes them.
    const points = sorted.filter((pt, i) => i === sorted.length - 1 || sorted[i + 1].t !== pt.t);
    const hasTarget = Number.isFinite(Number(s?.targetPct));
    const target = hasTarget ? clampPct(Number(s.targetPct)) : 50;
    return {
      key: s?.key ?? `s${i}`,
      label: s?.label ?? '',
      color: s?.color || 'var(--yes)',
      points,
      target,
      hasHistory: points.length > 0,
      // The legend's resting number is the live price, not the last
      // snapshot — otherwise it would disagree with the outcome list
      // right next to it whenever a trade lands between snapshots.
      restingValue: hasTarget
        ? target
        : (points.length ? points[points.length - 1].p : target),
    };
  }), [series]);

  const hasRealHistory = lines.some(l => l.hasHistory);
  const useMovementAxis = xMode === 'movement';

  // An explicit window wins over the auto-fit, the same way domainMin/Max
  // do for the y axis. Fitting the axis to the data is wrong whenever the
  // series start at different times: a leg whose only snapshot is 12h old
  // drags the axis back that far, and the burst of trades from the last
  // two minutes collapses into a one-pixel needle at the right edge. The
  // detail page pins the range the user actually picked (4H/24H/…), so
  // "24H" spans 24 hours no matter how sparse the snapshots are.
  const timeBounds = useMemo(() => {
    if (useMovementAxis) return null;
    if (Number.isFinite(timeMin) && Number.isFinite(timeMax) && timeMax > timeMin) {
      return { min: timeMin, max: timeMax };
    }
    const times = lines.flatMap(l => l.points.map(p => p.t));
    if (times.length === 0) {
      const now = Math.floor(Date.now() / 1000);
      return { min: now - 3600, max: now };
    }
    const min = Math.min(...times);
    const max = Math.max(...times);
    return max > min ? { min, max } : { min: min - 60, max };
  }, [lines, useMovementAxis, timeMin, timeMax]);

  const padX = 3;
  const padY = 4;
  const chartWidth = measuredWidth > 0 ? measuredWidth : Math.max(20, width);
  const yAxisGutter = Math.min(38, Math.max(30, chartWidth * 0.06));
  const xAxisHeight = useMovementAxis ? 0 : 18;
  const plotRight = Math.max(20, chartWidth - yAxisGutter);
  const plotBottom = Math.max(16, height - xAxisHeight);
  const w = Math.max(20, plotRight - padX * 2);
  const h = Math.max(10, plotBottom - padY * 2);

  // One domain across every line — that is the whole point of putting
  // them on the same axis. Series without history still count, so a
  // flat 7% line doesn't fall outside the window.
  //
  // An explicit domain wins over the auto-fit. The detail page pins 0–100
  // so a 3-point move reads as the small move it is, instead of the
  // auto-fit zooming in until it fills the card and looks dramatic.
  const domain = useMemo(() => {
    if (Number.isFinite(domainMin) && Number.isFinite(domainMax) && domainMax > domainMin) {
      return { min: domainMin, max: domainMax };
    }
    const values = lines.flatMap(l => (l.hasHistory ? l.points.map(p => p.p) : [l.target]));
    return values.length >= 2 ? priceDomain(values) : { min: 0, max: 100 };
  }, [lines, domainMin, domainMax]);

  const yForValue = (v) => {
    const range = Math.max(1e-6, domain.max - domain.min);
    const clamped = Math.max(domain.min, Math.min(domain.max, v));
    return padY + h - ((clamped - domain.min) / range) * h;
  };

  const xForTime = (t) => {
    if (!timeBounds) return padX + w;
    const span = Math.max(1, timeBounds.max - timeBounds.min);
    const clamped = Math.max(timeBounds.min, Math.min(timeBounds.max, Number(t)));
    return padX + ((clamped - timeBounds.min) / span) * w;
  };

  const timeForX = (x) => {
    if (!timeBounds) return 0;
    const span = timeBounds.max - timeBounds.min;
    const ratio = Math.max(0, Math.min(1, (x - padX) / Math.max(1, w)));
    return timeBounds.min + ratio * span;
  };

  const xForMovementIndex = (index, count) => {
    const denom = Math.max(1, count - 1);
    return padX + (Math.max(0, index) / denom) * w;
  };

  const yTicks = useMemo(() => axisTicks(domain.min, domain.max), [domain]);
  const visibleYTicks = yTicks.filter(tick => yForValue(tick) < plotBottom - padY - 6);

  const xTicks = useMemo(() => {
    if (useMovementAxis || !timeBounds) return [];
    const span = timeBounds.max - timeBounds.min;
    const count = chartWidth < 420 ? 3 : 5;
    const times = [];
    for (let i = 0; i < count; i++) times.push(timeBounds.min + (span * i) / (count - 1));
    const build = (mode) => times.map(t => ({ t, labelText: formatAxisTick(t, mode) }));
    const modes = span <= 48 * 3600 ? ['clock', 'clockSec'] : ['date', 'datetime'];
    for (const mode of modes) {
      const built = build(mode);
      if (!built.some((tick, i) => i > 0 && tick.labelText === built[i - 1].labelText)) return built;
    }
    return build(modes[modes.length - 1]);
  }, [timeBounds, chartWidth, useMovementAxis]);

  // Step-after, then held flat to the right edge: the last trade's price
  // is still the price now, so every line ends in the same column.
  const linePath = (coords) => {
    if (coords.length < 2) return '';
    let d = `M${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)}`;
    for (let i = 1; i < coords.length; i++) {
      if (jumpShape === 'soft-step') {
        const rampX = coords[i - 1].x + (coords[i].x - coords[i - 1].x) * 0.72;
        d += ` L${rampX.toFixed(2)},${coords[i - 1].y.toFixed(2)}`;
      } else if (!useMovementAxis) {
        d += ` L${coords[i].x.toFixed(2)},${coords[i - 1].y.toFixed(2)}`;
      }
      d += ` L${coords[i].x.toFixed(2)},${coords[i].y.toFixed(2)}`;
    }
    return d;
  };

  const pathFor = (line) => {
    if (useMovementAxis) {
      const source = line.hasHistory ? line.points : [{ p: line.target }, { p: line.target }];
      const pts = source.length >= 2 ? source : [source[0], source[0]];
      const coords = pts.map((pt, i) => ({
        x: xForMovementIndex(i, pts.length),
        y: yForValue(pt.p),
      }));
      return { d: linePath(coords), end: coords[coords.length - 1] };
    }

    const pts = line.hasHistory
      ? line.points
      : [{ t: timeBounds.min, p: line.target }, { t: timeBounds.max, p: line.target }];
    const coords = pts.map(pt => ({ x: xForTime(pt.t), y: yForValue(pt.p) }));
    const last = coords[coords.length - 1];
    const edgeX = padX + w;
    if (last.x < edgeX - 0.5) coords.push({ x: edgeX, y: last.y });
    if (coords.length < 2) return { d: '', end: last };
    return { d: linePath(coords), end: coords[coords.length - 1] };
  };

  const drawn = lines.map(line => ({ line, ...pathFor(line) }));

  // Every outcome's trades belong to the same market, so one merged
  // volume band reads better than four overlapping ones.
  const activityPoints = useMemo(() => {
    const buckets = new Map();
    const lists = Array.isArray(activity) ? activity : [];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const pt of list) {
        const t = Number(pt?.t);
        if (!Number.isFinite(t) || t <= 0) continue;
        const prev = buckets.get(t) || { t, count: 0, volume: 0, buyVolume: 0, sellVolume: 0 };
        prev.count += Math.max(0, Number(pt?.count) || 0);
        prev.volume += Math.max(0, Number(pt?.volume) || 0);
        prev.buyVolume += Math.max(0, Number(pt?.buyVolume) || 0);
        prev.sellVolume += Math.max(0, Number(pt?.sellVolume) || 0);
        buckets.set(t, prev);
      }
    }
    return [...buckets.values()].sort((a, b) => a.t - b.t);
  }, [activity]);

  const hasActivity = activityPoints.length > 0;
  const maxActivity = Math.max(1, ...activityPoints.map(pt => (pt.volume > 0 ? pt.volume : pt.count)));
  const activityBandHeight = showActivity && hasActivity
    ? Math.max(12, Math.min(28, plotBottom * 0.2))
    : 0;
  const activityBarWidth = Math.max(
    1.5,
    Math.min(7, w / Math.max(12, activityPoints.length * 1.35)),
  );

  // Hover snaps to a real snapshot time so the readout is a price that
  // actually printed, not an interpolation.
  const snapTimes = useMemo(() => {
    const set = new Set(lines.flatMap(l => l.points.map(p => p.t)));
    if (set.size === 0) return [];
    return [...set].sort((a, b) => a - b);
  }, [lines]);

  function handleMouseMove(e) {
    if (useMovementAxis) return;
    if (snapTimes.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * chartWidth;
    const t = timeForX(relX);
    let best = snapTimes[0];
    let bestDistance = Infinity;
    for (const candidate of snapTimes) {
      const distance = Math.abs(candidate - t);
      if (distance < bestDistance) { bestDistance = distance; best = candidate; }
    }
    setHoveredTime(best);
  }

  const hoverX = hoveredTime != null ? xForTime(hoveredTime) : null;
  const hoverReadouts = hoveredTime != null
    ? drawn.map(({ line }) => (line.hasHistory ? valueAt(line.points, hoveredTime) : line.target))
    : null;
  const tooltipLeftPct = hoverX != null
    ? Math.max(14, Math.min(86, (hoverX / chartWidth) * 100))
    : 0;

  // Hover pills sit at each line's exact y, so two lines within a few
  // points of each other (or tied outright) fully overlap and silently
  // hide one label. Spread them apart top-to-bottom, keeping value order,
  // while the dot on the line itself stays put at the true reading.
  const HOVER_LABEL_MIN_GAP = 20;
  const hoverLabelY = useMemo(() => {
    if (!hoverReadouts) return null;
    const entries = hoverReadouts
      .map((v, i) => (v == null ? null : { i, y: yForValue(v) }))
      .filter(Boolean)
      .sort((a, b) => a.y - b.y);
    for (let k = 1; k < entries.length; k++) {
      const minY = entries[k - 1].y + HOVER_LABEL_MIN_GAP;
      if (entries[k].y < minY) entries[k].y = minY;
    }
    const out = {};
    for (const e of entries) out[e.i] = e.y;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredTime]);

  return (
    <div style={{ width: '100%', ...style }}>
      {/* Legend — the only place each line is named, since on a shared
          axis a left-hand row label would point at nothing. */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 16px',
        marginBottom: 12,
      }}>
        {drawn.map(({ line }, i) => {
          const shown = hoverReadouts && hoverReadouts[i] != null
            ? hoverReadouts[i]
            : line.restingValue;
          return (
            <span
              key={line.key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-secondary)',
                minWidth: 0,
              }}
            >
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: line.color,
                flexShrink: 0,
              }} />
              <span style={{
                maxWidth: 140,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {line.label}
              </span>
              <strong style={{
                color: line.color,
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 700,
              }}>
                {Math.round(shown)}%
              </strong>
            </span>
          );
        })}
        {legendNote}
      </div>

      <div
        ref={plotRef}
        style={{ position: 'relative', width: '100%', height }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredTime(null)}
      >
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${chartWidth} ${height}`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          {visibleYTicks.map((tick) => (
            <line
              key={`grid-${uid}-${tick}`}
              x1={padX}
              y1={yForValue(tick)}
              x2={plotRight}
              y2={yForValue(tick)}
              stroke="var(--text-muted)"
              strokeWidth={1}
              strokeDasharray="2,4"
              opacity={0.35}
            />
          ))}

          {showActivity && hasActivity && (
            <g opacity="0.9">
              {activityPoints.map((pt, i) => {
                const metric = pt.volume > 0 ? pt.volume : pt.count;
                const barHeight = Math.max(2, (metric / maxActivity) * activityBandHeight);
                const x = (useMovementAxis
                  ? xForMovementIndex(i, activityPoints.length)
                  : xForTime(pt.t)) - activityBarWidth / 2;
                const sellHeavy = pt.sellVolume > pt.buyVolume;
                return (
                  <rect
                    key={`${pt.t}-${i}`}
                    x={Math.max(0, Math.min(plotRight - activityBarWidth, x))}
                    y={plotBottom - padY - barHeight}
                    width={activityBarWidth}
                    height={barHeight}
                    rx={0.8}
                    fill={sellHeavy ? 'var(--danger, #ff3b3b)' : 'var(--text-muted)'}
                    opacity={0.22}
                  />
                );
              })}
            </g>
          )}

          {drawn.map(({ line, d }) => (
            <path
              key={`line-${line.key}`}
              d={d}
              fill="none"
              stroke={line.color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity={line.hasHistory ? 1 : 0.35}
            />
          ))}

          {hoverX != null && (
            <line
              x1={hoverX} y1={0}
              x2={hoverX} y2={plotBottom}
              stroke="var(--text-muted)"
              strokeWidth={0.7}
              strokeDasharray="3,3"
              opacity={0.5}
            />
          )}

          {hoverX != null && drawn.map(({ line }, i) => {
            const v = hoverReadouts?.[i];
            if (v == null) return null;
            return (
              <circle
                key={`hover-${line.key}`}
                cx={hoverX}
                cy={yForValue(v)}
                r={3.5}
                fill={line.color}
                stroke="#fff"
                strokeWidth={1.5}
              />
            );
          })}
        </svg>

        {/* End dots as HTML so they stay perfectly circular */}
        {hoveredTime === null && drawn.map(({ line, end }) => (
          <div
            key={`end-${line.key}`}
            style={{
              position: 'absolute',
              left: `${(end.x / chartWidth) * 100}%`,
              top: `${(end.y / height) * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: line.color,
              pointerEvents: 'none',
              zIndex: 2,
            }}
          />
        ))}

        {/* Per-line hover pills — name + value pinned to each line at the
            hovered instant, the way Polymarket tags every series instead
            of only naming them in the legend above the chart. */}
        {hoverX != null && drawn.map(({ line }, i) => {
          const v = hoverReadouts?.[i];
          if (v == null) return null;
          const labelY = hoverLabelY?.[i] ?? yForValue(v);
          return (
            <div
              key={`hover-label-${line.key}`}
              style={{
                position: 'absolute',
                left: `${(hoverX / chartWidth) * 100}%`,
                top: `${(labelY / height) * 100}%`,
                transform: 'translate(9px, -50%)',
                display: 'flex',
                alignItems: 'stretch',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderLeft: `3px solid ${line.color}`,
                borderRadius: 4,
                padding: '2px 8px 2px 6px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                fontVariantNumeric: 'tabular-nums',
                zIndex: 11,
              }}
            >
              {line.label} {Math.round(v)}%
            </div>
          );
        })}

        {visibleYTicks.map((tick) => (
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

        {xTicks.map((tick, i) => (
          <span
            key={`xlabel-${tick.t}-${i}`}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${(xForTime(tick.t) / chartWidth) * 100}%`,
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

        {hoveredTime != null && (
          <div
            style={{
              position: 'absolute',
              left: `${tooltipLeftPct}%`,
              top: -6,
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
            {formatTimestamp(hoveredTime)}
          </div>
        )}
      </div>
    </div>
  );
}
