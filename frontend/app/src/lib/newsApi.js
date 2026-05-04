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
  return getJson(`/api/points/news${q.toString() ? `?${q}` : ''}`);
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
