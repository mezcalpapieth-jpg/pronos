/**
 * The demo session flag, on its own so app code can check it without
 * pulling in the demo backend chunk.
 *
 * Nothing here touches the fabricated data or the store — this module stays
 * tiny on purpose, because it gets imported by regular pages that ship to
 * every visitor.
 */
export const DEMO_SESSION_KEY = 'pronos-video-demo-active';

export function isVideoDemoActive() {
  try {
    return window.sessionStorage.getItem(DEMO_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Poll interval for pages that refresh themselves, or null to leave the
 * production cadence alone. Fast enough that a probability visibly ticks
 * between frames without the page looking like it is seizing.
 */
export function videoDemoPollMs() {
  return isVideoDemoActive() ? 2000 : null;
}
