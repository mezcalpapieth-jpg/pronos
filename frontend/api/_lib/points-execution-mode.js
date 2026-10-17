// Points ledger operations must never settle a protocol execution locally.
// Legacy rows with no mode retain their existing Points behavior.
export function pointsExecutionLock(market) {
  const mode = market?.mode ?? 'points';
  if (mode === 'points') return null;
  return {
    status: 409,
    error: mode === 'onchain' ? 'onchain_market_requires_protocol' : 'unsupported_market_mode',
    detail: 'This market requires its own execution backend; the Points balance cannot be used here.',
  };
}

export function assertPointsExecution(market) {
  const lock = pointsExecutionLock(market);
  if (lock) throw Object.assign(new Error(lock.error), { status: lock.status, detail: lock.detail });
}
