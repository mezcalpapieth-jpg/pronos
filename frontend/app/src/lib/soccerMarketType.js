const LEAGUE_LABELS = {
  'club-friendlies': 'AMISTOSO',
  international: 'INTERNACIONAL',
};

function normalizeType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  if (v.includes('amistoso') || v.includes('friendly')) return 'AMISTOSO';
  if (v.includes('internacional') || v.includes('international')) return 'INTERNACIONAL';
  if (v.includes('torneo') || v.includes('tournament') || v.includes('cup')) return 'TORNEO';
  return null;
}

export function soccerMatchTypeLabel(market = {}) {
  const explicit = normalizeType(
    market.matchTypeLabel
      || market.sourceData?.matchTypeLabel
      || market.source_data?.matchTypeLabel
      || market.resolverConfig?.matchTypeLabel
      || market.resolver_config?.matchTypeLabel
  );
  if (market.tournamentFeatured === true) return 'TORNEO';
  if (explicit && explicit !== 'TORNEO') return explicit;

  const league = String(market.league || '').trim().toLowerCase();
  if (LEAGUE_LABELS[league]) return LEAGUE_LABELS[league];
  return null;
}

export const _internal = {
  LEAGUE_LABELS,
  normalizeType,
};
