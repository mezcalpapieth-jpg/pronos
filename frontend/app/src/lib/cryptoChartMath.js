export function computeChartWindow({ history, xStart, xEnd, windowMs = 5 * 60_000 } = {}) {
  if (Number.isFinite(xStart) && Number.isFinite(xEnd) && xEnd > xStart) {
    return { xMin: xStart, xMax: xEnd };
  }

  const span = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 5 * 60_000;
  const latest = Array.isArray(history) && history.length > 0
    ? Number(history[history.length - 1]?.t)
    : span;
  const xMax = Number.isFinite(latest) ? latest : span;

  return { xMin: xMax - span, xMax };
}

export function normalizePricePoints(points) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const sorted = [];
  for (const point of points) {
    const t = Number(point?.t);
    const price = Number(point?.price);
    if (!Number.isFinite(t) || !Number.isFinite(price)) continue;
    sorted.push({
      t,
      price,
      interpolated: point?.interpolated === true,
    });
  }

  sorted.sort((a, b) => a.t - b.t);

  const deduped = [];
  for (const point of sorted) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.t === point.t) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }

  return deduped;
}

export function filterVisiblePoints(points, { xMin, xMax } = {}) {
  const normalized = normalizePricePoints(points);
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin) {
    return normalized;
  }
  return normalized.filter(point => point.t >= xMin && point.t <= xMax);
}

export function densifyPoints(points, { intervalMs = 1_000, maxInsertedPerGap = 600 } = {}) {
  const normalized = normalizePricePoints(points);
  if (normalized.length <= 1) {
    return normalized.map(point => ({ ...point, interpolated: false }));
  }

  const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 1_000;
  const maxInserted = Number.isFinite(maxInsertedPerGap) && maxInsertedPerGap >= 0
    ? Math.floor(maxInsertedPerGap)
    : 600;
  const dense = [{ ...normalized[0], interpolated: false }];

  for (let i = 1; i < normalized.length; i++) {
    const previous = normalized[i - 1];
    const next = normalized[i];
    const gap = next.t - previous.t;
    const insertCount = Math.min(Math.floor(gap / interval) - 1, maxInserted);

    for (let step = 1; step <= insertCount; step++) {
      const t = previous.t + step * interval;
      if (t >= next.t) break;
      const ratio = (t - previous.t) / gap;
      dense.push({
        t,
        price: previous.price + (next.price - previous.price) * ratio,
        interpolated: true,
      });
    }

    dense.push({ ...next, interpolated: false });
  }

  return dense;
}

export function projectTimeToX(t, { xMin, xMax, width, padding = {} } = {}) {
  const left = Number(padding.left) || 0;
  const right = Number(padding.right) || 0;
  const frameWidth = Number(width);
  const innerW = frameWidth - left - right;
  if (
    !Number.isFinite(t)
    || !Number.isFinite(xMin)
    || !Number.isFinite(xMax)
    || !Number.isFinite(frameWidth)
    || xMax <= xMin
    || innerW <= 0
  ) {
    return left;
  }
  return left + ((t - xMin) / (xMax - xMin)) * innerW;
}

export function nearestPointByX(points, targetX, frame) {
  const normalized = normalizePricePoints(points);
  if (normalized.length === 0 || !Number.isFinite(targetX)) return null;

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of normalized) {
    const x = projectTimeToX(point.t, frame);
    const distance = Math.abs(x - targetX);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { point, x };
    }
  }

  return best;
}
