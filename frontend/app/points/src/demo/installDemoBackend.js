/**
 * Swaps window.fetch for the in-browser demo backend.
 *
 * This is the choke point that lets the whole points app run on fabricated
 * data without editing a single component: the pages mix pointsApi.js calls
 * with direct fetch() calls, and patching fetch catches both.
 *
 * Only /api/points/* is intercepted. Anything else — assets, fonts, the
 * access-gate endpoint itself — goes to the real network untouched.
 *
 * Installation is guarded twice over: the server must have set the signed
 * access cookie, and this tab must carry the session flag. Both are checked
 * by the caller before this module is even imported (it lives in a lazy
 * chunk), so a normal visitor never downloads or runs any of it.
 */
import { routeDemoRequest } from './demoBackend.js';
import { initDemoStore } from './demoStore.js';

const DEMO_SESSION_KEY = 'pronos-video-demo-active';

// Latency is deliberate, not incidental. Instant responses make skeleton
// loaders flash in a way that reads as broken on camera, and the buy
// confirmation needs long enough for its "confirmando" state to be visible.
const GET_LATENCY_MS = 50;
const POST_LATENCY_MS = 260;

let installed = false;
let originalFetch = null;

export function isDemoActive() {
  try {
    return window.sessionStorage.getItem(DEMO_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function markDemoActive() {
  try {
    window.sessionStorage.setItem(DEMO_SESSION_KEY, '1');
  } catch { /* private mode — the demo still runs for this page load */ }
}

export function clearDemoActive() {
  try {
    window.sessionStorage.removeItem(DEMO_SESSION_KEY);
  } catch { /* nothing to clear */ }
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input?.url || '';
}

function requestMethod(input, init) {
  return String(init?.method || input?.method || 'GET').toUpperCase();
}

async function requestBody(input, init) {
  const raw = init?.body ?? (typeof input === 'object' && input?.body ? await input.clone().text() : null);
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

export function installDemoBackend() {
  if (installed) return;
  installed = true;
  initDemoStore();

  originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = requestUrl(input);
    let path;
    try {
      path = new URL(url, window.location.origin).pathname;
    } catch {
      return originalFetch(input, init);
    }

    if (!path.startsWith('/api/points/')) {
      return originalFetch(input, init);
    }

    const method = requestMethod(input, init);
    const body = await requestBody(input, init);

    let result;
    try {
      result = routeDemoRequest(url, method, body);
    } catch (err) {
      // A thrown handler must not surface as a network failure mid-take.
      console.warn('[demo] handler error', path, err);
      result = { status: 200, body: {} };
    }

    await new Promise(resolve => {
      window.setTimeout(resolve, method === 'GET' ? GET_LATENCY_MS : POST_LATENCY_MS);
    });

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

export function uninstallDemoBackend() {
  if (!installed || !originalFetch) return;
  window.fetch = originalFetch;
  installed = false;
}
