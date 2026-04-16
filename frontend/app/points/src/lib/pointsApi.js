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
    err.detail = data?.detail || null;
    err.hint = data?.hint || null;
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

/**
 * Batch-fetch the last-N-days price history for one or more market ids.
 * Returns a map of `{ [marketId]: [{t, p}] }` — `p` is the probability
 * 0-100, `t` is a unix-seconds timestamp. Usable directly as the `data`
 * prop on the shared Sparkline component.
 */
export async function fetchPriceHistory(ids, { days = 30, outcome = 0 } = {}) {
  const list = Array.isArray(ids) ? ids : [ids];
  const cleaned = list.filter(n => Number.isInteger(n) || (typeof n === 'string' && n.length > 0));
  if (cleaned.length === 0) return {};
  const q = new URLSearchParams({
    ids: cleaned.join(','),
    days: String(days),
    outcome: String(outcome),
  });
  try {
    const { history = {} } = await getJson(`/api/points/markets/price-history?${q}`);
    return history;
  } catch {
    // Price history is a nice-to-have — don't break the UI if the snapshot
    // table is empty or the endpoint hiccups. The Sparkline will fall back
    // to its seeded mock curve.
    return {};
  }
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

// ─── Referrals ──────────────────────────────────────────────────────────────
export async function fetchReferralStats() {
  return getJson('/api/points/referrals/stats');
}

export async function claimPendingReferral(referrer) {
  return postJson('/api/points/referrals/claim-pending', { referrer });
}

// ─── Social tasks ───────────────────────────────────────────────────────────
export async function fetchSocialTaskCatalog() {
  return getJson('/api/points/social-tasks/catalog');
}

export async function submitSocialTask(taskKey, proofUrl) {
  return postJson('/api/points/social-tasks/submit', { taskKey, proofUrl });
}

// ─── Admin — social task queue ──────────────────────────────────────────────
export async function adminListSocialTasks(status = 'pending') {
  return getJson(`/api/points/admin/social-tasks?status=${encodeURIComponent(status)}`);
}

export async function adminReviewSocialTask(id, action, note) {
  return postJson('/api/points/admin/social-tasks', { id, action, note });
}

// ─── Cycles (2-week leaderboard windows) ────────────────────────────────────
export async function fetchCurrentCycle() {
  const { cycle } = await getJson('/api/points/cycles/current');
  return cycle;
}

export async function fetchCycleHistory(limit = 10) {
  const { cycles = [] } = await getJson(`/api/points/cycles/history?limit=${limit}`);
  return cycles;
}

export async function adminListCycles() {
  return getJson('/api/points/admin/cycles');
}

export async function adminRolloverCycle(nextCycleLabel) {
  return postJson('/api/points/admin/cycles', {
    action: 'rollover',
    nextCycleLabel: nextCycleLabel || null,
  });
}
