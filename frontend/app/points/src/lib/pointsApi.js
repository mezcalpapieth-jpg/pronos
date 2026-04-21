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
// `limit` caps the number of markets returned. Leave undefined on home
// (trending shows the soonest-closing 100); category / browse pages
// pass a larger value so nothing is hidden.
export async function fetchMarkets({ status = 'active', category, limit } = {}) {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (category) q.set('category', category);
  if (limit) q.set('limit', String(limit));
  const { markets = [] } = await getJson(`/api/points/markets?${q}`);
  return markets;
}

export async function fetchMarket(id) {
  // For parallel (amm_mode='parallel') markets the payload also carries
  // a `legs: [...]` array with one entry per outcome. Attach it onto the
  // returned market object so callers can reach it without a second call.
  const payload = await getJson(`/api/points/market?id=${encodeURIComponent(id)}`);
  const { market, legs } = payload;
  if (!market) return market;
  return Array.isArray(legs) ? { ...market, legs } : market;
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
    // Path kept flat (`/api/points/price-history`) to avoid Vercel's
    // filesystem-routing conflict where a `markets/` directory would
    // shadow the sibling `markets.js` file.
    const { history = {} } = await getJson(`/api/points/price-history?${q}`);
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

/**
 * Read-only check: has the authenticated user already claimed today?
 * Lets the UI render a greyed-out "Ya reclamaste hoy" state on mount
 * without needing to POST.
 */
export async function fetchDailyStatus() {
  return getJson('/api/points/daily-status');
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

// ─── Comments ───────────────────────────────────────────────────────────────
export async function fetchComments(marketId, { limit = 50 } = {}) {
  const { comments = [] } = await getJson(
    `/api/points/comments?marketId=${encodeURIComponent(marketId)}&limit=${limit}`,
  );
  return comments;
}

export async function postComment(marketId, body) {
  return postJson('/api/points/comments', { marketId, body });
}

export async function deleteComment(commentId) {
  return postJson('/api/points/comment-delete', { commentId });
}

// ─── Top holders ────────────────────────────────────────────────────────────
export async function fetchTopHolders(marketId, { limit = 10 } = {}) {
  return getJson(
    `/api/points/top-holders?marketId=${encodeURIComponent(marketId)}&limit=${limit}`,
  );
}

// ─── Admin — pending markets (agent-generated queue) ───────────────────────
export async function adminListPendingMarkets(status = 'pending') {
  return getJson(`/api/points/admin/pending-markets?status=${encodeURIComponent(status)}`);
}

export async function adminReviewPendingMarket(id, action, note) {
  return postJson('/api/points/admin/pending-markets', { id, action, note });
}

// Bulk-approve every pending row. Backend does per-row transactions so
// partial failure is tolerated; returns `{ checked, approvedCount, failedCount, failures }`.
export async function adminApproveAllPendingMarkets(note) {
  return postJson('/api/points/admin/pending-markets', { action: 'approve_all', note });
}

// One-shot: retrofit resolver_type + resolver_config on already-approved
// markets that were missing them. Idempotent; safe to re-run.
export async function adminBackfillResolvers({ dry = false } = {}) {
  const q = dry ? '?dry=1' : '';
  return postJson(`/api/points/admin/backfill-resolvers${q}`, {});
}

// Manually trigger the daily market-generation pipeline. Useful when
// testing on preview deploys (where Vercel crons don't auto-fire) or
// after editing entertainment-config.
export async function adminRunGenerators({ dry = false } = {}) {
  const q = dry ? '?dry=1' : '';
  return postJson(`/api/points/admin/run-generators${q}`, {});
}

// F1-specific retrofit. The generator only produces a spec for the
// NEXT race, so the general backfill misses any F1 market from an
// earlier round. This endpoint walks every active F1 parent with
// NULL outcome_images, re-resolves each driver's Wikipedia portrait
// via Jolpica → Wikipedia REST, and patches the column directly.
export async function adminBackfillF1Images({ dry = false } = {}) {
  const q = dry ? '?dry=1' : '';
  return postJson(`/api/points/admin/backfill-f1-images${q}`, {});
}

// Diagnostic: why aren't my markets resolving? Returns active
// markets grouped by "resolvable / waiting / missing resolver /
// manual" so the admin can see the state without digging into logs.
export async function adminResolveDiagnostic() {
  return getJson('/api/points/admin/resolve-diagnostic');
}

// Manually kick the auto-resolver. Vercel cron jobs run ONLY on
// production — preview deploys never fire the */15 tick, so this is
// how we resolve markets from a preview environment. Also useful on
// prod right after a Retrofit to see results without waiting 15 min.
export async function adminRunAutoResolve({ dry = false } = {}) {
  const q = dry ? '?dry=1' : '';
  return postJson(`/api/points/admin/run-auto-resolve${q}`, {});
}

// ─── Admin — edit market (question + end time + category) ──────────────────
export async function adminEditMarket({ marketId, question, endTime, category }) {
  return postJson('/api/points/admin/edit-market', { marketId, question, endTime, category });
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
