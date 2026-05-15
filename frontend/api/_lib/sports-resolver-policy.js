export const NEXT_OPPONENT_RECHECK_INTERVAL_HOURS = 12;

export function normalizeResolverLabel(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/["'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolverLabelsOverlap(a, b) {
  const left = normalizeResolverLabel(a);
  const right = normalizeResolverLabel(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  return left.includes(right) || right.includes(left);
}

export function findParallelWinnerIndex(legs, result) {
  if (!Array.isArray(legs) || legs.length === 0) return -1;
  const idNeedle = String(result?.winnerDriverId || '').trim();
  const nameNeedle = normalizeResolverLabel(result?.winnerDriverLabel);

  let idx = legs.findIndex(l =>
    l?.driverId && String(l.driverId).trim() === idNeedle,
  );
  if (idx >= 0) return idx;

  idx = legs.findIndex(l =>
    normalizeResolverLabel(l?.label) === nameNeedle,
  );
  if (idx >= 0) return idx;

  idx = legs.findIndex(l =>
    resolverLabelsOverlap(l?.label, result?.winnerDriverLabel),
  );
  if (idx >= 0) return idx;

  return legs.findIndex(l =>
    !l?.driverId && normalizeResolverLabel(l?.label) === 'otro',
  );
}

export function isNextOpponentCheckDue({
  resolverType,
  resolverConfig,
  endTime,
  now = new Date(),
} = {}) {
  const cfg = resolverConfig && typeof resolverConfig === 'object' ? resolverConfig : {};
  if (resolverType !== 'sports_api' || cfg.source !== 'next-opponent') return false;

  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return false;

  const endMs = endTime ? new Date(endTime).getTime() : NaN;
  if (Number.isFinite(endMs) && endMs <= nowMs) return false;

  const lastMs = cfg.nextOpponentLastCheckedAt
    ? new Date(cfg.nextOpponentLastCheckedAt).getTime()
    : NaN;
  if (!Number.isFinite(lastMs)) return true;

  return lastMs <= nowMs - NEXT_OPPONENT_RECHECK_INTERVAL_HOURS * 3600_000;
}
