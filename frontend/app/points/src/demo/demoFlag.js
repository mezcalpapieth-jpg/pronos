/**
 * The demo session flag, on its own so app code can check it without
 * pulling in the demo backend chunk.
 *
 * Nothing here touches the fabricated data or the store — this module stays
 * tiny on purpose, because it gets imported by regular pages that ship to
 * every visitor.
 */
export const DEMO_SESSION_KEY = 'pronos-video-demo-active';

/**
 * Set alongside DEMO_SESSION_KEY by the presentation gate (/points-demo), and
 * never by the video gate (/points/video).
 *
 * The two demos share this whole machinery but not their data: the video demo
 * records against 22 invented markets, while the presentation demo runs on the
 * real board pulled from the backend. One flag decides which, and it also
 * namespaces the saved scenario so opening one demo can't hand the other its
 * board.
 */
export const LIVE_SEED_SESSION_KEY = 'pronos-demo-live-seed';

export function isVideoDemoActive() {
  try {
    return window.sessionStorage.getItem(DEMO_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function isLiveSeedDemo() {
  try {
    return window.sessionStorage.getItem(LIVE_SEED_SESSION_KEY) === '1';
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
