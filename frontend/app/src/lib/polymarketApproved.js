/**
 * @deprecated DO NOT USE — Polymarket integration removed.
 *
 * Stub. See lib/gamma.js for the full deprecation notice and
 * lib/protocol.js for the architecture banner.
 */

export function polymarketApprovalKey(_market) { return null; }
export async function fetchApprovedPolymarket() { return []; }
export async function fetchAllPolymarketDecisions() { return []; }
export async function approvePolymarketMarket() { return { ok: false, deprecated: true }; }
export async function rejectPolymarketMarket() { return { ok: false, deprecated: true }; }
export async function editPolymarketTranslation() { return { ok: false, deprecated: true }; }
export async function bulkTranslatePolymarket() { return { ok: false, deprecated: true }; }
export async function unapprovePolymarketMarket() { return { ok: false, deprecated: true }; }
export function applyPolymarketApproval(market, _approval) { return market; }
export function applyApprovals(allMarkets, _approvedRows) { return allMarkets; }
