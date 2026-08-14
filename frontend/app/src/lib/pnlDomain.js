/**
 * Y-axis domain for a signed PnL series.
 *
 * Lives in its own .js module rather than inside PnlChart.jsx so it can be
 * unit-tested — node --test cannot import .jsx, which is why the rest of the
 * component is only reachable by source assertions.
 *
 * The domain ALWAYS contains zero: the baseline is the entire reference for
 * reading this chart, so a series that never crosses zero still has to show
 * it rather than floating in a zoomed band that hides whether the user is up
 * or down.
 */
export function pnlDomain(values) {
  const finite = (values || []).filter(v => Number.isFinite(v));
  if (finite.length === 0) return { min: -1, max: 1 };
  const lo = Math.min(0, ...finite);
  const hi = Math.max(0, ...finite);
  if (lo === hi) return { min: lo - 1, max: hi + 1 };
  const pad = (hi - lo) * 0.12;
  return {
    min: lo - (lo < 0 ? pad : 0),
    max: hi + (hi > 0 ? pad : 0),
  };
}
