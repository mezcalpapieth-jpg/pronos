/**
 * @deprecated DO NOT USE — Polymarket integration removed.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  THIS FILE IS A STUB.
 *
 *  Pronos no longer integrates Polymarket / Gamma. We run our own
 *  contracts on Arbitrum (see lib/protocol.js for the architecture).
 *  All exports below return empty data so the legacy MVP MarketsGrid
 *  keeps compiling while it's migrated to fetch from the points-app
 *  /api/points/markets endpoint instead.
 *
 *  When MarketsGrid is rewritten or removed, delete this file along
 *  with lib/polymarketApproved.js, lib/polymarketFilter.js, and the
 *  api/gamma.js + api/polymarket-* server endpoints.
 *
 *  Don't restore Polymarket logic. If you need a market, create one
 *  through the admin panel — Pronos has its own AMM.
 * ════════════════════════════════════════════════════════════════════════
 */

export const CATEGORY_META = {
  deportes: { label: 'DEPORTES',               icon: '' },
  politica: { label: 'POLÍTICA INTERNACIONAL', icon: '' },
  crypto:   { label: 'CRYPTO',                 icon: '' },
  finanzas: { label: 'FINANZAS',               icon: '' },
  musica:   { label: 'MÚSICA & FARÁNDULA',     icon: '' },
  mexico:   { label: 'MÉXICO & LATAM',         icon: '' },
};

export function gmNormalize(_pm) {
  return null;
}

export async function gmFetchMarkets() {
  return [];
}

export async function gmFetchClosedMarkets() {
  return [];
}

export async function gmFetchBySlug() {
  return null;
}

export async function gmFetchMarketsBySlugs() {
  return [];
}
