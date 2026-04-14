// ── Client for /api/polymarket-approved ───────────────────────────────────
// Live Polymarket markets only appear publicly once a slug is in this table.
// The endpoint also caches a Spanish translation of the title + option labels
// (pulled from Polymarket Spanish first, Anthropic fallback when configured)
// so the public site can render markets in Spanish without re-translating.

import { authFetch } from './apiAuth.js';

const API = '/api/polymarket-approved';

function isLocal() {
  return typeof window !== 'undefined' && window.location.hostname === 'localhost';
}
const base = isLocal() ? 'https://pronos.io' : '';

export function polymarketApprovalKey(market) {
  return market?.slug || market?._slug || market?.id || market?._polyId || null;
}

/**
 * Fetch only approved polymarket rows (default — used by the public site).
 * Rows shape: { slug, title_es, options_es, approved_at, approved_by, status }
 */
export async function fetchApprovedPolymarket() {
  try {
    const res = await fetch(`${base}${API}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.approved || [];
  } catch (_) {
    return [];
  }
}

/**
 * Fetch every decision row (approved + rejected) — used by the admin so it
 * can hide rejected markets from the queue without re-fetching them.
 */
export async function fetchAllPolymarketDecisions(privyId, getAccessToken) {
  try {
    const q = privyId ? `?status=all&privyId=${encodeURIComponent(privyId)}` : '?status=all';
    const res = await authFetch(getAccessToken, `${base}${API}${q}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.approved || [];
  } catch (_) {
    return [];
  }
}

/**
 * Approve a polymarket market (admin only). Sends the original title + options
 * so the server can cache Spanish text before storing.
 */
export async function approvePolymarketMarket(privyId, { slug, eventSlug, title, options, autoTranslate = true, getAccessToken }) {
  const res = await authFetch(getAccessToken, `${base}${API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privyId, slug, eventSlug, title, options, autoTranslate, status: 'approved' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'No se pudo aprobar el mercado');
  }
  return (await res.json()).approved;
}

/**
 * Persistently reject a polymarket market (admin only). The slug stays in the
 * decisions table with status='rejected' so future admin loads filter it out.
 */
export async function rejectPolymarketMarket(privyId, { slug, getAccessToken } = {}) {
  const res = await authFetch(getAccessToken, `${base}${API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privyId, slug, status: 'rejected', autoTranslate: false }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'No se pudo rechazar el mercado');
  }
  return (await res.json()).approved;
}

/**
 * Edit the cached Spanish translation for a polymarket market (admin only).
 */
export async function editPolymarketTranslation(privyId, { slug, title_es, getAccessToken }) {
  const res = await authFetch(getAccessToken, `${base}${API}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privyId, slug, title_es }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'No se pudo editar la traducción');
  }
  return (await res.json()).approved;
}

/**
 * Bulk-translate Polymarket markets to Spanish and store as 'pending' rows
 * in `polymarket_approved`. Used by the admin page on load so every fetched
 * market shows in both languages without waiting for an admin click.
 *
 * The server caps each call at 20 translations, so callers should drain by
 * looping until `remaining === 0`.
 */
export async function bulkTranslatePolymarket(privyId, markets, getAccessToken) {
  try {
    const res = await authFetch(getAccessToken, `${base}/api/polymarket-translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privyId, markets }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, rows: [], remaining: 0, error: err.error || 'No se pudo traducir' };
    }
    return await res.json();
  } catch (e) {
    return { ok: false, rows: [], remaining: 0, error: e.message };
  }
}

/**
 * Revoke approval for a slug (admin only).
 */
export async function unapprovePolymarketMarket(privyId, slug, getAccessToken) {
  const url = `${base}${API}?slug=${encodeURIComponent(slug)}&privyId=${encodeURIComponent(privyId)}`;
  const res = await authFetch(getAccessToken, url, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'No se pudo eliminar la aprobación');
  }
  return res.json();
}

/**
 * Apply a list of approval rows to live polymarket markets:
 *   - filter out markets whose slug isn't approved
 *   - swap in title_es / options_es when present
 *
 * Local hardcoded markets (anything without `_source === 'polymarket'`) pass
 * through unchanged so the curated catalog isn't gated by approval.
 */
export function applyPolymarketApproval(market, approval) {
  if (!market || !approval) return null;
  const next = { ...market };
  next.slug = next.slug || approval.slug || next.id;
  // Preserve both language variants so the EN/ES toggle can swap live.
  next.title_en = market.title_en || market.title;
  if (approval.title_es) {
    next.title_es = approval.title_es;
    next.title = approval.title_es; // default display = Spanish
  }
  // Snapshot English options before overwriting with Spanish labels.
  if (Array.isArray(next.options) && !Array.isArray(next.options_en)) {
    next.options_en = next.options.map(opt => ({ ...opt }));
  }
  // options_es may arrive as a JSON string from Neon (JSONB edge case).
  let optsEs = approval.options_es;
  if (typeof optsEs === 'string') { try { optsEs = JSON.parse(optsEs); } catch (_) { optsEs = null; } }
  if (Array.isArray(next.options) && Array.isArray(optsEs) && optsEs.length > 0) {
    next.options_es = next.options.map((opt, i) => ({
      ...opt,
      label: optsEs[i]?.label || opt.label,
    }));
    // Default display = Spanish labels (backward compat).
    next.options = next.options.map((opt, i) => ({
      ...opt,
      label: optsEs[i]?.label || opt.label,
    }));
  }
  next._approvedAt = approval.approved_at;
  return next;
}

export function applyApprovals(allMarkets, approvedRows) {
  const map = new Map();
  for (const row of approvedRows || []) {
    map.set(row.slug, row);
  }

  const out = [];
  for (const m of allMarkets || []) {
    const isPoly = m && m._source === 'polymarket';
    if (!isPoly) { out.push(m); continue; }
    const approval = map.get(polymarketApprovalKey(m));
    if (!approval) continue; // not approved → drop from public list
    const next = applyPolymarketApproval(m, approval);
    out.push(next);
  }
  return out;
}
