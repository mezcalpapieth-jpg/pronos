export const POINTS_REFRESH_EVENT = 'pronos:points-refresh';

export function emitPointsRefresh(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(POINTS_REFRESH_EVENT, { detail }));
}

export function onPointsRefresh(handler) {
  if (typeof window === 'undefined' || typeof handler !== 'function') {
    return () => {};
  }
  window.addEventListener(POINTS_REFRESH_EVENT, handler);
  return () => window.removeEventListener(POINTS_REFRESH_EVENT, handler);
}
