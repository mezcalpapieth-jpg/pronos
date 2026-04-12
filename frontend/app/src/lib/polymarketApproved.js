// ── Client for /api/polymarket-approved ───────────────────────────────────
// Live Polymarket markets only appear publicly once a slug is in this table.
// The endpoint also caches a Spanish translation of the title + option labels
// (generated at approval time via Anthropic) so the public site can render
// markets in Spanish without re-translating on the fly.

const API = '/api/polymarket-approved';

function isLocal() {
  return typeof window !== 'undefined' && window.location.hostname === 'localhost';
}
const base = isLocal() ? 'https://pronos.io' : '';

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
export async function fetchAllPolymarketDecisions() {
  try {
    const res = await fetch(`${base}${API}?status=all`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.approved || [];
  } catch (_) {
    return [];
  }
}

/**
 * Approve a polymarket market (admin only). Sends the original title + options
 * so the server can translate to Spanish via Anthropic before storing.
 */
export async function approvePolymarketMarket(privyId, { slug, title, options, autoTranslate = true }) {
  const res = await fetch(`${base}${API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privyId, slug, title, options, autoTranslate, status: 'approved' }),
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
export async function rejectPolymarketMarket(privyId, { slug }) {
  const res = await fetch(`${base}${API}`, {
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
 * Bulk-translate Polymarket markets to Spanish and store as 'pending' rows
 * in `polymarket_approved`. Used by the admin page on load so every fetched
 * market shows in both languages without waiting for an admin click.
 *
 * The server caps each call at 20 translations, so callers should drain by
 * looping until `remaining === 0`.
 */
export async function bulkTranslatePolymarket(privyId, markets) {
  try {
    const res = await fetch(`${base}/api/polymarket-translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privyId, markets }),
    });
    if (!res.ok) return { ok: false, rows: [], remaining: 0 };
    return await res.json();
  } catch (_) {
    return { ok: false, rows: [], remaining: 0 };
  }
}

/**
 * Revoke approval for a slug (admin only).
 */
export async function unapprovePolymarketMarket(privyId, slug) {
  const url = `${base}${API}?slug=${encodeURIComponent(slug)}&privyId=${encodeURIComponent(privyId)}`;
  const res = await fetch(url, { method: 'DELETE' });
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
export function applyApprovals(allMarkets, approvedRows) {
  const map = new Map();
  for (const row of approvedRows || []) {
    map.set(row.slug, row);
  }

  const out = [];
  for (const m of allMarkets || []) {
    const isPoly = m && m._source === 'polymarket';
    if (!isPoly) { out.push(m); continue; }
    const approval = map.get(m.id);
    if (!approval) continue; // not approved → drop from public list
    const next = { ...m };
    // Preserve both language variants so the EN/ES toggle can swap live.
    next.title_en = m.title;                           // original English from Gamma
    if (approval.title_es) {
      next.title_es = approval.title_es;
      next.title    = approval.title_es;               // default display = Spanish
    }
    // Snapshot English options before overwriting with Spanish labels.
    if (Array.isArray(next.options)) {
      next.options_en = next.options.map(opt => ({ ...opt }));
    }
    if (Array.isArray(approval.options_es) && approval.options_es.length > 0) {
      next.options_es = next.options.map((opt, i) => ({
        ...opt,
        label: approval.options_es[i]?.label || opt.label,
      }));
      // Default display = Spanish labels (backward compat).
      next.options = next.options.map((opt, i) => ({
        ...opt,
        label: approval.options_es[i]?.label || opt.label,
      }));
    }
    next._approvedAt = approval.approved_at;
    out.push(next);
  }
  return out;
}
