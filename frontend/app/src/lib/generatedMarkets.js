// ── Client for /api/generated-markets ──────────────────────────
import { authFetch } from './apiAuth.js';

const API = '/api/generated-markets';

function isLocal() {
  return typeof window !== 'undefined' && window.location.hostname === 'localhost';
}
const base = isLocal() ? 'https://pronos.io' : '';

/**
 * Fetch generated markets by status.
 * Default returns only approved markets (public).
 * Pass 'pending' with privyId to retrieve pending (admin only).
 */
export async function fetchGeneratedMarkets(status = 'approved', privyId, getAccessToken) {
  const q = new URLSearchParams({ status });
  if (privyId) q.set('privyId', privyId);
  const res = await authFetch(getAccessToken, `${base}${API}?${q.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.markets || []).map(normalize);
}

/**
 * Approve, reject, or mark a generated market as live (admin only).
 */
export async function updateGeneratedMarket({ privyId, id, action, patch, getAccessToken }) {
  const res = await authFetch(getAccessToken, `${base}${API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privyId, id, action, patch }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error al actualizar el mercado');
  }
  return res.json();
}

/**
 * Create a brand-new market (admin only). Auto-approved so it appears
 * on the public grid immediately.
 */
export async function createGeneratedMarket({ privyId, title, category, icon, deadline, options, getAccessToken }) {
  const res = await authFetch(getAccessToken, `${base}${API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privyId, action: 'create', title, category, icon, deadline, options }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error al crear el mercado');
  }
  return res.json();
}

/**
 * Normalize a DB row into the shape used by MarketCard / MarketsGrid / MarketDetail.
 * Mimics the static MARKETS array format so it can be mixed freely.
 */
export function normalize(row) {
  return {
    id: row.slug,
    title: row.title,
    category: row.category || 'general',
    categoryLabel: row.category_label || 'GENERAL',
    icon: row.icon || '📰',
    deadline: row.deadline || '',
    options: Array.isArray(row.options) ? row.options : JSON.parse(row.options || '[]'),
    volume: row.volume || '0',
    _source: 'ai',
    _region: row.region,
    _reasoning: row.reasoning,
    _generatedAt: row.generated_at,
    _status: row.status,
    _dbId: row.id,
  };
}
