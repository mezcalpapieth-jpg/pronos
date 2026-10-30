const STORAGE_KEY = 'pronos_device_id';
const VALID_ID = /^[a-f0-9-]{32,64}$/i;
let memoryId = null;
// A random browser identifier survives account switches and IP/VPN changes.
// It is advisory evidence, never an ownership verdict or a trading restriction.
export function riskDeviceHeaders(browser = globalThis) {
  if (!browser.document) return {};
  let stored;
  try { stored = browser.localStorage?.getItem(STORAGE_KEY); } catch { /* private mode */ }
  if (!VALID_ID.test(stored || '')) {
    try {
      const cookie = String(browser.document.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${STORAGE_KEY}=`));
      stored = cookie?.slice(STORAGE_KEY.length + 1);
    } catch { /* cookies may be blocked too */ }
  }
  if (!VALID_ID.test(stored || '')) stored = memoryId;
  if (!VALID_ID.test(stored || '')) {
    if (browser.crypto?.randomUUID) stored = browser.crypto.randomUUID();
    else if (browser.crypto?.getRandomValues) stored = [...browser.crypto.getRandomValues(new Uint8Array(24))].map(n => n.toString(16).padStart(2, '0')).join('');
    else return {};
  }
  memoryId = stored;
  try { browser.localStorage?.setItem(STORAGE_KEY, stored); } catch { /* cookie/memory fallback */ }
  try {
    browser.document.cookie = `${STORAGE_KEY}=${stored}; Path=/; Max-Age=31536000; SameSite=Lax${browser.location?.protocol === 'https:' ? '; Secure' : ''}`;
  } catch { /* risk capture must never prevent a request */ }
  return { 'X-Pronos-Device-Id': stored };
}
