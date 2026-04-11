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
 * Fetch the entire approval list. Returns rows shaped:
 *   { slug, title_es, options_es, approved_at, approved_by }
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
 * Approve a polymarket market (admin only). Sends the original title + options
 * so the server can translate to Spanish via Anthropic before storing.
 */
export async function approvePolymarketMarket(privyId, { slug, title, options, autoTranslate = true }) {
  const res = await fetch(`${base}${API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privyId, slug, title, options, autoTranslate }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'No se pudo aprobar el mercado');
  }
  return (await res.json()).approved;
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
    if (approval.title_es) next.title = approval.title_es;
    if (Array.isArray(approval.options_es) && approval.options_es.length > 0) {
      // Merge translated labels into existing options (preserves pct).
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
