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
  if (!res.ok) return null;
  const data = await res.json();
  return data.market ? normalizeProtocolMarket(data.market) : null;
}
