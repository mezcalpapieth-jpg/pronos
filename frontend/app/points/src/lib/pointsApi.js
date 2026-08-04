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

const PUBLIC_ERROR_COPY = {
  invalid_session: {
    es: 'Tu sesión expiró. Vuelve a iniciar sesión.',
    en: 'Your session expired. Please sign in again.',
  },
  not_authenticated: {
    es: 'Inicia sesión para continuar.',
    en: 'Sign in to continue.',
  },
  insufficient_balance: {
    es: 'Balance insuficiente.',
    en: 'Insufficient balance.',
  },
  insufficient_available_balance: {
    es: 'Balance disponible insuficiente. Tienes MXNP reservado en órdenes abiertas.',
    en: 'Insufficient available balance. Some MXNP is reserved in open orders.',
  },
  insufficient_available_shares: {
    es: 'Acciones disponibles insuficientes. Tienes acciones reservadas en órdenes abiertas.',
    en: 'Insufficient available shares. Some shares are reserved in open orders.',
  },
  invalid_limit_price: {
    es: 'Ingresa un precio límite válido entre 1c y 99c.',
    en: 'Enter a valid limit price between 1c and 99c.',
  },
  invalid_amount: {
    es: 'Ingresa un monto válido.',
    en: 'Enter a valid amount.',
  },
  order_not_open: {
    es: 'Esa orden ya no está abierta.',
    en: 'That order is no longer open.',
  },
  limit_order_failed: {
    es: 'No pudimos crear la orden límite. Intenta otra vez.',
    en: 'Could not create the limit order. Try again.',
  },
  cancel_limit_order_failed: {
    es: 'No pudimos cancelar la orden. Intenta otra vez.',
    en: 'Could not cancel the order. Try again.',
  },
  market_closed: {
    es: 'El mercado ya cerró o fue resuelto.',
    en: 'The market already closed or resolved.',
  },
  market_expired: {
    es: 'El mercado ya cerró. No se pueden crear órdenes nuevas.',
    en: 'The market already closed. New orders are unavailable.',
  },
  market_not_found: {
    es: 'No encontramos ese mercado.',
    en: 'We could not find that market.',
  },
  price_moved: {
    es: 'El precio se movió. Vuelve a cotizar.',
    en: 'The price moved. Please quote again.',
  },
  quote_failed: {
    es: 'No pudimos calcular el precio. Intenta otra vez.',
    en: 'Could not calculate the price. Try again.',
  },
  load_failed: {
    es: 'No pudimos cargar la información. Intenta otra vez.',
    en: 'Could not load the information. Try again.',
  },
  social_link_failed: {
    es: 'No pudimos conectar esa cuenta. Intenta otra vez.',
    en: 'Could not connect that account. Try again.',
  },
  default: {
    es: 'Algo salió mal. Intenta otra vez.',
    en: 'Something went wrong. Try again.',
  },
};

export function publicErrorMessage(error, lang = 'es', fallback = 'default') {
  const raw = typeof error === 'string'
    ? error
    : (error?.code || error?.message || fallback);
  const normalized = String(raw || fallback).toLowerCase();
  const key = Object.keys(PUBLIC_ERROR_COPY)
    .find(k => k !== 'default' && normalized.includes(k));
  const copy = PUBLIC_ERROR_COPY[key || fallback] || PUBLIC_ERROR_COPY.default;
  return copy[lang] || copy.es;
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

// ─── Private investor deck ─────────────────────────────────────────────────
export async function deckLogin({ email, code, language }) {
  return postJson('/api/deck/auth', { email, code, language });
}

export async function fetchDeckSession() {
  return getJson('/api/deck/session');
}

export async function deckLogout() {
  const res = await fetch('/api/deck/session', {
    method: 'DELETE',
    credentials: 'include',
  });
  return handle(res);
}

export async function trackDeckEvent({
  slideNumber,
  durationMs,
  eventType = 'slide_view',
  language = 'en',
  keepalive = false,
}) {
  const res = await fetch('/api/deck/events', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slideNumber, durationMs, eventType, language }),
    keepalive,
  });
  return handle(res);
}

export async function submitDeckQuestion({ question, slideNumber, language }) {
  return postJson('/api/deck/questions', { question, slideNumber, language });
}

export async function adminDeckDashboard() {
  return getJson('/api/deck/admin/dashboard');
}

export async function adminCreateDeckInvite({ label, emailHint, code }) {
  return postJson('/api/deck/admin/invites', {
    action: 'create',
    label,
    emailHint,
    code,
  });
}

export async function adminRevokeDeckInvite(id) {
  return postJson('/api/deck/admin/invites', {
    action: 'revoke',
    id,
  });
}

export async function adminResetDeckInviteCode({ id, code } = {}) {
  return postJson('/api/deck/admin/invites', {
    action: 'reset_code',
    id,
    code,
  });
}

// ─── Publicity attribution ────────────────────────────────────────────────
// Source cookies are set by the bio links. When an account is present later
// in the points app, this records one first-touch conversion.
export async function trackPublicityLanding(source) {
  return postJson('/api/points/publicity/landing', { source });
}

export async function trackPublicityConversion() {
  return postJson('/api/points/publicity/conversion', {});
}

// ─── Markets ────────────────────────────────────────────────────────────────
// Aggregate counters for the home hero. Ships only integers so we
// can show the true total active-market count without fetching
// every row.
export async function fetchStats() {
  return getJson('/api/points/stats');
}

// Mark a losing resolved position as acknowledged so it drops off
// the Active tab. Trades stay in Historial regardless.
export async function dismissPosition({ marketId, outcomeIndex }) {
  return postJson('/api/points/dismiss-position', { marketId, outcomeIndex });
}

// ─── Turnkey delegated signing (M2) ──────────────────────────────────
// First on-chain trade prompts a one-time consent: the user
// authorizes Pronos to sign their trades within defined scope
// (200k MXNB/day, 180d, whitelisted contracts). After that, zero
// popups per trade. Status tells the UI which state to render;
// revoke clears the policy.
export async function fetchDelegationStatus() {
  return getJson('/api/points/turnkey/delegation-status');
}
export async function authorizeDelegation() {
  return postJson('/api/points/turnkey/authorize-delegation', {});
}
export async function revokeDelegation() {
  return postJson('/api/points/turnkey/revoke-delegation', {});
}

// ─── Social links (verified via OAuth) ───────────────────────────────
// Separate surface from the admin-review social_tasks. These are
// provider accounts (X, IG, TikTok) the user has linked via OAuth,
// so their handle is cryptographically verified.
export async function fetchSocialLinks() {
  return getJson('/api/points/social-links');
}

export async function unlinkSocial(provider) {
  return postJson('/api/points/unlink-social', { provider });
}

// Kick-off URL for the OAuth redirect. Returns a path the browser
// should `window.location.href` to — server issues a 302 to the
// provider's consent screen.
export function socialLinkStartUrl(provider, returnTo = '/earn') {
  const q = new URLSearchParams({ returnTo }).toString();
  return `/api/social/${provider}/start?${q}`;
}

// `limit` caps the number of markets returned. Leave undefined on home
// (trending shows the soonest-closing 100); category / browse pages
// pass a larger value so nothing is hidden.
//
// `featured: 'all'` bypasses the server-side Trending filter (which
// defaults to only returning featured markets when no category is
// set). Category and status pages need every market, not just the
// curated ones.
export async function fetchMarkets({ status = 'active', category, limit, featured } = {}) {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (category) q.set('category', category);
  if (limit) q.set('limit', String(limit));
  if (featured) q.set('featured', featured);
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
export async function fetchPriceHistory(ids, { days = 30, outcome = 0, limit = 200 } = {}) {
  const list = Array.isArray(ids) ? ids : [ids];
  const cleaned = list.filter(n => Number.isInteger(n) || (typeof n === 'string' && n.length > 0));
  if (cleaned.length === 0) return {};
  const q = new URLSearchParams({
    ids: cleaned.join(','),
    days: String(days),
    outcome: String(outcome),
    limit: String(limit),
  });
  try {
    // Path kept flat (`/api/points/price-history`) to avoid Vercel's
    // filesystem-routing conflict where a `markets/` directory would
    // shadow the sibling `markets.js` file.
    const { history = {} } = await getJson(`/api/points/price-history?${q}`);
    return history;
  } catch {
    // Price history is a nice-to-have — don't break the UI if the snapshot
    // table is empty or the endpoint hiccups. The Sparkline will render a
    // truthful empty/flat state instead of inventing movement.
    return {};
  }
}

// ─── Trading ────────────────────────────────────────────────────────────────
export async function quoteBuy({ marketId, outcomeIndex, collateral }) {
  return postJson('/api/points/quote-buy', { marketId, outcomeIndex, collateral });
}

// `minSharesOut` / `maxAvgPrice` are slippage guards — the server
// holds a row lock on the market during the trade, so if the AMM
// moved past these bounds between the user's quote and now, it
// rejects with `price_moved` (HTTP 409) so the UI can re-quote.
export async function executeBuy({ marketId, outcomeIndex, collateral, minSharesOut, maxAvgPrice }) {
  return postJson('/api/points/buy', {
    marketId, outcomeIndex, collateral, minSharesOut, maxAvgPrice,
  });
}

export async function quoteSell({ marketId, outcomeIndex, shares }) {
  return postJson('/api/points/quote-sell', { marketId, outcomeIndex, shares });
}

export async function fetchOrderBook({ marketId, outcomeIndex = 0, levels = 8 }) {
  const q = new URLSearchParams({
    marketId: String(marketId),
    outcomeIndex: String(outcomeIndex),
    levels: String(levels),
  });
  return getJson(`/api/points/orderbook?${q}`);
}

export async function fetchMyLimitOrders({ marketId }) {
  const q = new URLSearchParams({ marketId: String(marketId) });
  return getJson(`/api/points/limit-orders?${q}`);
}

export async function placeLimitOrder({ marketId, outcomeIndex, side, limitPrice, amount, expiresAt }) {
  return postJson('/api/points/limit-orders', {
    marketId,
    outcomeIndex,
    side,
    limitPrice,
    amount,
    expiresAt: expiresAt || null,
  });
}

export async function cancelLimitOrder(orderId) {
  return postJson('/api/points/cancel-limit-order', { orderId });
}

// `minCollateralOut` is the sell-side slippage guard — the lowest
// MXNP payout the user will accept. Server bails with `price_moved`
// if the locked quote undershoots.
export async function executeSell({ marketId, outcomeIndex, shares, minCollateralOut }) {
  return postJson('/api/points/sell', {
    marketId, outcomeIndex, shares, minCollateralOut,
  });
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

export async function fetchMakerRewards() {
  return getJson('/api/points/maker-rewards');
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

// ─── Support tickets ───────────────────────────────────────────────────────
export async function fetchSupportTickets() {
  return getJson('/api/points/support-tickets');
}

export async function createSupportTicket({ type, subject, message }) {
  return postJson('/api/points/support-tickets', { type, subject, message });
}

// ─── Admin — social task queue ──────────────────────────────────────────────
export async function adminListSocialTasks(status = 'pending') {
  return getJson(`/api/points/admin/social-tasks?status=${encodeURIComponent(status)}`);
}

export async function adminReviewSocialTask(id, action, note) {
  return postJson('/api/points/admin/social-tasks', { id, action, note });
}

// ─── Admin — support tickets ────────────────────────────────────────────────
export async function adminListSupportTickets(status = 'open') {
  return getJson(`/api/points/admin/support-tickets?status=${encodeURIComponent(status)}`);
}

export async function adminReplySupportTicket({ id, message }) {
  return postJson('/api/points/admin/support-tickets', { id, action: 'reply', message });
}

export async function adminSetSupportTicketStatus({ id, status }) {
  return postJson('/api/points/admin/support-tickets', {
    id,
    action: status === 'closed' ? 'close' : 'reopen',
  });
}

// ─── Admin — resolution candidates ─────────────────────────────────────────
export async function adminListResolutionCandidates() {
  return getJson('/api/points/admin/resolution-candidates?status=pending');
}

export async function adminReviewResolutionCandidate({ candidateId, action, outcomeIndex, note } = {}) {
  return postJson('/api/points/admin/resolution-candidates', {
    candidateId,
    action,
    outcomeIndex,
    note,
  });
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

export async function adminListTaskCounts() {
  const [pendingResult, marketsResult, resolutionResult, socialResult, supportResult] = await Promise.allSettled([
    adminListPendingMarkets('pending'),
    getJson('/api/points/admin/markets?status=pending'),
    adminListResolutionCandidates(),
    adminListSocialTasks('pending'),
    adminListSupportTickets('open'),
  ]);

  const pendingData = pendingResult.status === 'fulfilled' ? pendingResult.value : null;
  const marketsData = marketsResult.status === 'fulfilled' ? marketsResult.value : null;
  const resolutionData = resolutionResult.status === 'fulfilled' ? resolutionResult.value : null;
  const socialData = socialResult.status === 'fulfilled' ? socialResult.value : null;
  const supportData = supportResult.status === 'fulfilled' ? supportResult.value : null;
  const resolutionCount = Number.isFinite(Number(resolutionData?.count))
    ? Number(resolutionData.count)
    : null;
  const counts = {
    pending: Array.isArray(pendingData?.pending) ? pendingData.pending.length : 0,
    markets: resolutionCount != null
      ? resolutionCount
      : (Array.isArray(marketsData?.markets) ? marketsData.markets.length : 0),
    social: Array.isArray(socialData?.tasks) ? socialData.tasks.length : 0,
    support: Array.isArray(supportData?.tickets) ? supportData.tickets.length : 0,
  };

  return {
    ...counts,
    total: counts.pending + counts.markets + counts.social + counts.support,
  };
}

export async function adminReviewPendingMarket(id, action, note) {
  return postJson('/api/points/admin/pending-markets', { id, action, note });
}

export async function adminRefreshPendingPricing(id) {
  return postJson('/api/points/admin/pending-markets', { id, action: 'refresh_pricing' });
}

export async function adminRefreshAllPendingPricing() {
  return postJson('/api/points/admin/pending-markets', { action: 'refresh_pricing_all' });
}

export async function adminEditPendingMarket(id, patch, note) {
  return postJson('/api/points/admin/pending-markets', { id, action: 'edit', patch, note });
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

// Toggle a market's `featured` flag. Featured markets appear in the
// home Trending grid; non-featured ones only show under /c/<category>.
export async function adminToggleFeatured({ marketId, pendingId, featured }) {
  return postJson('/api/points/admin/toggle-featured', { marketId, pendingId, featured });
}

// Repair/progress World Cup markets from ESPN. Dry-run first so the
// admin can see how many rows will be patched/resolved/created before
// applying the DB write.
export async function adminProgressWorldCup({ dry = false } = {}) {
  const q = dry ? '?dry=1' : '';
  return postJson(`/api/points/admin/progress-world-cup${q}`, {});
}

// ─── Admin — edit market (question + start/end time + category) ────────────
export async function adminEditMarket({ marketId, question, startTime, endTime, category }) {
  return postJson('/api/points/admin/edit-market', {
    marketId,
    question,
    startTime,
    endTime,
    category,
  });
}

export async function adminCancelMarket({ marketId, reason } = {}) {
  return postJson('/api/points/admin/cancel-market', {
    marketId,
    reason,
  });
}

// ─── Cycles (2-week leaderboard windows) ────────────────────────────────────
export async function fetchCurrentCycle() {
  const data = await getJson('/api/points/cycles/current');
  return data?.cycle || null;
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

export async function adminPauseCycles() {
  return postJson('/api/points/admin/cycles', {
    action: 'pause',
  });
}

// ─── News (Mexican RSS aggregator) ──────────────────────────────────────────
export async function fetchNews({ category = 'featured', limit = 60 } = {}) {
  const q = new URLSearchParams();
  if (category && category !== 'featured') q.set('category', category);
  if (limit) q.set('limit', String(limit));
  return getJson(`/api/points/news${q.toString() ? `?${q}` : ''}`);
}

// Admin-only: link / unlink a news headline to an existing market.
export async function adminLinkNews({ newsUrl, newsTitle, newsSource, marketId }) {
  return postJson('/api/points/admin/news-link', { newsUrl, newsTitle, newsSource, marketId });
}
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

// Admin-only: list active markets (for the news → market picker).
export async function adminListActiveMarkets() {
  return getJson('/api/points/admin/markets?status=active&mode=all');
}
