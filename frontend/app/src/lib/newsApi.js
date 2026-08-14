/**
 * Shared news API client used by both the points-app and the MVP.
 *
 * Self-contained fetch wrappers (so neither app has to bridge between
 * its own pointsApi/pointsAuth conventions): every function returns
 * the parsed JSON payload on success and throws an Error with a
 * .code property on failure.
 *
 * All endpoints live on /api/points/* — they're shared across both
 * apps, the news feature is just a frontend variant.
 */

async function getJson(url) {
  const res = await fetch(url, { method: 'GET', credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.code = data?.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

function decodeEntitiesPass(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number.parseInt(n, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10FFFF
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const code = Number.parseInt(h, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10FFFF
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…').replace(/&middot;/g, '·');
}

export function decodeNewsText(value) {
  if (!value) return '';
  return decodeEntitiesPass(decodeEntitiesPass(value));
}

function normalizeNewsItem(item) {
  if (!item || typeof item !== 'object') return item;
  return {
    ...item,
    title: decodeNewsText(item.title),
    summary: decodeNewsText(item.summary),
    sourceName: decodeNewsText(item.sourceName),
  };
}

function normalizeNewsContainer(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!Array.isArray(payload.items)) return payload;
  return {
    ...payload,
    items: payload.items.map(normalizeNewsItem),
  };
}

export function normalizeNewsPayload(payload) {
  const normalized = normalizeNewsContainer(payload);
  if (!normalized || typeof normalized !== 'object' || !normalized.data) return normalized;
  return {
    ...normalized,
    data: normalizeNewsContainer(normalized.data),
  };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.code = data?.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

// Public — anyone can hit /api/points/news (rate-limited per IP).
export async function fetchNews({ category = 'featured', limit = 60 } = {}) {
  const q = new URLSearchParams();
  if (category && category !== 'featured') q.set('category', category);
  if (limit) q.set('limit', String(limit));
  return normalizeNewsPayload(await getJson(`/api/points/news${q.toString() ? `?${q}` : ''}`));
}

// Public — map mode needs lightweight active markets from both surfaces.
// The endpoints are already public; failures are isolated so a protocol
// hiccup does not make the news globe blank.
export async function fetchPublicMapMarkets({ limit = 120 } = {}) {
  const [points, protocol] = await Promise.allSettled([
    getJson(`/api/points/markets?status=active&limit=${limit}&featured=all`),
    getJson(`/api/protocol/markets?status=active&limit=${limit}`),
  ]);
  const pointsMarkets = points.status === 'fulfilled' && Array.isArray(points.value?.markets)
    ? points.value.markets.map(m => ({ ...m, surface: m.surface || 'points' }))
    : [];
  const protocolMarkets = protocol.status === 'fulfilled' && Array.isArray(protocol.value?.markets)
    ? protocol.value.markets.map(m => ({ ...m, surface: m.surface || 'mvp' }))
    : [];
  return [...pointsMarkets, ...protocolMarkets].slice(0, limit);
}

// Admin — POST /api/points/admin/news-link
export async function adminLinkNews({ newsUrl, newsTitle, newsSource, marketId }) {
  return postJson('/api/points/admin/news-link', { newsUrl, newsTitle, newsSource, marketId });
}

// Admin — DELETE /api/points/admin/news-link?newsUrl=...
export async function adminUnlinkNews(newsUrl) {
  const q = new URLSearchParams({ newsUrl });
  const res = await fetch(`/api/points/admin/news-link?${q}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.code = data?.error;
    throw err;
  }
  return data;
}

// Admin — list active markets for the news↔market picker. Both apps
// hit the same shared admin endpoint; mode='all' returns both off-chain
// (mode='points') and on-chain (mode='onchain') markets so the picker
// can link a news item to either.
export async function adminListActiveMarkets() {
  return getJson('/api/points/admin/markets?status=active&mode=all');
}

// Admin — POST /api/points/admin/news-hide
// Hide a news item from the /c/noticias feed for everyone. Persists
// via canonical news_url so a re-enter of the same article (with
// fresh tracking params) stays hidden.
export async function adminHideNews({ newsUrl, newsTitle }) {
  return postJson('/api/points/admin/news-hide', { newsUrl, newsTitle });
}

// Admin — DELETE /api/points/admin/news-hide?newsUrl=...
// (currently unexposed in the UI; kept for future "undo hide" flow)
export async function adminUnhideNews(newsUrl) {
  const q = new URLSearchParams({ newsUrl });
  const res = await fetch(`/api/points/admin/news-hide?${q}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.code = data?.error;
    throw err;
  }
  return data;
}
