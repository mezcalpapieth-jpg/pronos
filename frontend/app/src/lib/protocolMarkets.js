import { authFetch } from './apiAuth.js';

function formatDeadline(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function categoryLabel(category) {
  return String(category || 'general').toUpperCase();
}

export function normalizeProtocolMarket(row) {
  const yesPct = Math.round(Number(row.options?.[0]?.pct ?? 50));
  return {
    ...row,
    id: `protocol-${row.id}`,
    protocolDbId: row.id,
    source: 'protocol',
    _source: 'protocol',
    title: row.question,
    category: row.category || 'general',
    categoryLabel: categoryLabel(row.category),
    icon: 'P',
    deadline: formatDeadline(row.endTime),
    options: [
      { label: 'Sí', pct: yesPct },
      { label: 'No', pct: Math.max(0, 100 - yesPct) },
    ],
    volume: row.totalVolume || row.volume || '0',
    poolAddress: row.poolAddress,
    protocolMarketId: row.marketId,
  };
}

export function protocolRouteIdToDbId(id) {
  const match = String(id || '').match(/^protocol-(\d+)$/);
  return match ? match[1] : null;
}

export async function fetchProtocolMarkets({ status = 'active' } = {}) {
  const q = new URLSearchParams({ status });
  const res = await fetch(`/api/markets?${q.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.markets || []).map(normalizeProtocolMarket);
}

export async function fetchProtocolMarket(routeId) {
  const dbId = protocolRouteIdToDbId(routeId);
  if (!dbId) return null;
  const res = await fetch(`/api/market?id=${encodeURIComponent(dbId)}`);
  if (res.ok) {
    const data = await res.json();
    if (data.market) return normalizeProtocolMarket(data.market);
  }

  // If the detail endpoint lags or is misconfigured, fall back to the list
  // endpoint so a card that appears in the grid can still open.
  const markets = await fetchProtocolMarkets({ status: 'active' }).catch(() => []);
  return markets.find(m => String(m.protocolDbId) === String(dbId)) || null;
}

export async function removeProtocolMarket({ privyId, id, getAccessToken }) {
  const q = new URLSearchParams({ id: String(id), privyId });
  const res = await authFetch(getAccessToken, `/api/market?${q.toString()}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'No se pudo remover el mercado del protocolo');
  }
  return res.json();
}
