// ─── POLYMARKET GAMMA API ─────────────────────────────────────────────────────
import {
  filterRelevantPolymarketMarkets,
  getPolymarketImportReason,
} from './polymarketFilter.js';

// Proxy at /api/gamma uses ?path= to forward to Gamma API (avoids Vercel routing conflicts).
const GAMMA_BASE = '/api/gamma';

// ── Category mapping ──────────────────────────────────────────────────────────
function gmMapCategory(market) {
  const tags = (market.tags || []).map(t =>
    (t.label || t.slug || t.id || '').toLowerCase()
  );
  const q = (market.question || '').toLowerCase();
  const cat = (market.category || '').toLowerCase();
  const reason = getPolymarketImportReason(market);

  if (reason === 'latin-america') return 'mexico';
  if (reason === 'sports') return 'deportes';
  if (reason === 'finance' && !['crypto', 'defi', 'bitcoin', 'ethereum', 'web3', 'blockchain'].some(k => tags.includes(k) || cat.includes(k) || q.includes(k))) return 'finanzas';
  if (['crypto', 'defi', 'bitcoin', 'ethereum', 'web3', 'blockchain'].some(k => tags.includes(k) || cat.includes(k))) return 'crypto';
  if (['sports', 'soccer', 'football', 'nba', 'nfl', 'baseball', 'formula-1', 'f1', 'tennis', 'boxing', 'mma'].some(k => tags.includes(k) || cat.includes(k))) return 'deportes';
  if (['pop-culture', 'entertainment', 'music', 'celebrity', 'awards', 'grammy', 'oscars'].some(k => tags.includes(k) || cat.includes(k))) return 'musica';
  if (q.includes('mexico') || q.includes('méxico') || q.includes('cdmx') || q.includes('latam') || tags.some(t => t.includes('mexico') || t.includes('latam'))) return 'mexico';
  if (['politics', 'election', 'government', 'policy', 'president', 'congress'].some(k => tags.includes(k) || cat.includes(k))) return 'politica';
  return 'politica';
}

export const CATEGORY_META = {
  deportes: { label: 'DEPORTES',               icon: '⚽' },
  politica: { label: 'POLÍTICA INTERNACIONAL', icon: '🌎' },
  crypto:   { label: 'CRYPTO',                 icon: '₿'  },
  finanzas: { label: 'FINANZAS',               icon: '$'  },
  musica:   { label: 'MÚSICA & FARÁNDULA',     icon: '🎵' },
  mexico:   { label: 'MÉXICO & LATAM',         icon: '🇲🇽' },
};

// ── Volume formatter ──────────────────────────────────────────────────────────
function gmFmtVolume(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1000) + 'K';
  return Math.round(n).toString();
}

// ── Date formatter ────────────────────────────────────────────────────────────
function gmFmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-MX', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch (_) { return iso.slice(0, 10); }
}

// Gamma API quirk: `outcomes`, `outcomePrices`, and `clobTokenIds` all come
// back as JSON-encoded strings rather than real arrays (e.g.
// `'["0.0335","0.9665"]'`). Parse defensively so callers always see an array.
function gmParseArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim().startsWith('[')) {
    try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; }
    catch (_) { return []; }
  }
  return [];
}

// ── Normalize a raw Polymarket market → Pronos market object ──────────────────
export function gmNormalize(pm) {
  const outcomes     = gmParseArray(pm.outcomes);
  const safeOutcomes = outcomes.length > 0 ? outcomes : ['Sí', 'No'];
  const prices       = gmParseArray(pm.outcomePrices).map(Number);
  const clobTokenIds = gmParseArray(pm.clobTokenIds);
  const category     = gmMapCategory(pm);
  const meta         = CATEGORY_META[category] || CATEGORY_META.politica;
  const vol          = Number(pm.volume || pm.volumeNum || 0);
  const slug         = pm.slug || pm.id;
  const rawTags      = (pm.tags || [])
    .map(t => t?.label || t?.slug || t?.name || t?.id || '')
    .filter(Boolean);

  const market = {
    id:            slug,
    slug,
    category,
    categoryLabel: meta.label,
    icon:          meta.icon,
    trending:      vol > 50000,
    title:         pm.question,
    deadline:      gmFmtDate(pm.endDate),
    volume:        gmFmtVolume(vol),
    options:       safeOutcomes.map((label, i) => ({
      label,
      pct: Math.round((prices[i] || (1 / safeOutcomes.length)) * 100),
    })),

    // Polymarket-specific fields
    _polyId:          pm.id,
    _conditionId:     pm.conditionId || null,
    _clobTokenIds:    clobTokenIds,
    _acceptingOrders: pm.acceptingOrders !== false,
    _isNegRisk:       !!pm.negRisk,
    _image:           pm.image || null,
    _source:          'polymarket',
    _endDate:         pm.endDate || null, // raw ISO so client can auto-expire
    _categoryRaw:     pm.category || null,
    _description:     pm.description || null,
    _tags:            rawTags,
  };
  market._importReason = getPolymarketImportReason(market);
  return market;
}

function gmFetchLimit(limit, relevantOnly) {
  if (!relevantOnly) return limit;
  return Math.min(Math.max(limit * 4, 100), 250);
}

function gmApplyImportFilter(markets, { limit, relevantOnly }) {
  const filtered = relevantOnly ? filterRelevantPolymarketMarkets(markets) : markets;
  return filtered.slice(0, limit);
}

// ── Fetch active markets ──────────────────────────────────────────────────────
export async function gmFetchMarkets({ limit = 60, relevantOnly = true } = {}) {
  const upstreamLimit = gmFetchLimit(limit, relevantOnly);
  const url = `${GAMMA_BASE}?path=/markets&active=true&closed=false&archived=false&limit=${upstreamLimit}&order=volume&ascending=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gamma API ${res.status}`);
  const data = await res.json();
  const arr  = Array.isArray(data) ? data : (data.markets || []);
  return gmApplyImportFilter(arr.map(gmNormalize), { limit, relevantOnly });
}

// ── Fetch recently closed markets ─────────────────────────────────────────────
// Used by the admin to surface markets that have already been resolved on
// Polymarket so they can be mirrored into market_resolutions instead of
// silently disappearing from the live `closed=false` feed.
export async function gmFetchClosedMarkets({ limit = 100, relevantOnly = true } = {}) {
  const upstreamLimit = gmFetchLimit(limit, relevantOnly);
  const url = `${GAMMA_BASE}?path=/markets&closed=true&archived=false&limit=${upstreamLimit}&order=endDate&ascending=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gamma API ${res.status}`);
  const data = await res.json();
  const arr  = Array.isArray(data) ? data : (data.markets || []);
  const markets = arr.map(pm => ({ ...gmNormalize(pm), _closed: true }));
  return gmApplyImportFilter(markets, { limit, relevantOnly });
}

// ── Fetch single market by slug ───────────────────────────────────────────────
export async function gmFetchBySlug(slug, { relevantOnly = true } = {}) {
  const url = `${GAMMA_BASE}?path=/markets&slug=${encodeURIComponent(slug)}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gamma API ${res.status}`);
  const data = await res.json();
  const arr  = Array.isArray(data) ? data : (data.markets || []);
  if (arr.length === 0) return null;
  const market = gmNormalize(arr[0]);
  return !relevantOnly || filterRelevantPolymarketMarkets([market]).length > 0 ? market : null;
}

export async function gmFetchMarketsBySlugs(slugs, { relevantOnly = true, concurrency = 8 } = {}) {
  const unique = Array.from(new Set((slugs || []).filter(Boolean)));
  const markets = [];
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(slug => gmFetchBySlug(slug, { relevantOnly }).catch(() => null))
    );
    for (const market of results) {
      if (market) markets.push(market);
    }
  }
  return markets;
}
