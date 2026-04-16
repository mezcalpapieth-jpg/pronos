/**
 * Points-app REST client.
 *
 * Every call is credentials: 'include' so the signed session cookie
 * goes along with requests. Errors are surfaced as Error instances
 * with an `.code` property matching the backend's short error codes.
 */

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.code = data?.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function getJson(url) {
  const res = await fetch(url, { method: 'GET', credentials: 'include' });
  return handle(res);
}

export async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return handle(res);
}

// ─── Markets ────────────────────────────────────────────────────────────────
export async function fetchMarkets({ status = 'active', category } = {}) {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (category) q.set('category', category);
  const { markets = [] } = await getJson(`/api/points/markets?${q}`);
  return markets;
}

export async function fetchMarket(id) {
  const { market } = await getJson(`/api/points/market?id=${encodeURIComponent(id)}`);
  return market;
}

// ─── Trading ────────────────────────────────────────────────────────────────
export async function quoteBuy({ marketId, outcomeIndex, collateral }) {
  return postJson('/api/points/quote-buy', { marketId, outcomeIndex, collateral });
}

export async function executeBuy({ marketId, outcomeIndex, collateral }) {
  return postJson('/api/points/buy', { marketId, outcomeIndex, collateral });
}

export async function quoteSell({ marketId, outcomeIndex, shares }) {
  return postJson('/api/points/quote-sell', { marketId, outcomeIndex, shares });
}

export async function executeSell({ marketId, outcomeIndex, shares }) {
  return postJson('/api/points/sell', { marketId, outcomeIndex, shares });
}

export async function redeemWinnings({ marketId, outcomeIndex }) {
  return postJson('/api/points/redeem', { marketId, outcomeIndex });
}

// ─── Portfolio ──────────────────────────────────────────────────────────────
export async function fetchPositions() {
  return getJson('/api/points/positions');
}

export async function fetchHistory() {
  return getJson('/api/points/history');
}

export async function fetchLeaderboard() {
  return getJson('/api/points/leaderboard');
}

// ─── Daily claim ────────────────────────────────────────────────────────────
export async function claimDaily() {
  return postJson('/api/points/claim-daily', {});
}
