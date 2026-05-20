import { findTeamByName } from './teamProfiles.js';

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isDrawOutcome(label) {
  const key = normalized(label);
  return key === 'empate' || key === 'draw' || key === 'tie';
}

export function marketOnlyState(market) {
  if (market?.status === 'resolved') return 'resolved';
  if (market?.status === 'canceled' || market?.status === 'cancelled') return 'cancelado';
  if (market?.status === 'disputed') return 'disputa';
  const endMs = market?.endTime ? new Date(market.endTime).getTime() : 0;
  if (market?.status === 'active' && endMs > 0 && endMs < Date.now()) return 'por-resolver';
  if (market?.status === 'active') return 'open';
  return market?.status || 'pending';
}

function outcomePair(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return { homeIndex: null, awayIndex: null };
  }

  if (outcomes.length >= 3 && isDrawOutcome(outcomes[1])) {
    return { homeIndex: 0, awayIndex: 2 };
  }

  if (outcomes.length >= 2) {
    return { homeIndex: 0, awayIndex: 1 };
  }

  return { homeIndex: 0, awayIndex: null };
}

export function marketOnlyRowForTeam(team, market) {
  const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
  const outcomeImages = Array.isArray(market?.outcomeImages) ? market.outcomeImages : [];
  const { homeIndex, awayIndex } = outcomePair(outcomes);
  const startsAt = market?.startTime || market?.endTime || market?.createdAt || null;

  return {
    id: `market:${market?.id}`,
    source: market?.source || null,
    sourceEventId: market?.sourceEventId || null,
    startsAt,
    homeName: homeIndex != null ? (outcomes[homeIndex] || team?.name || null) : (team?.name || null),
    awayName: awayIndex != null ? (outcomes[awayIndex] || null) : null,
    homeLogo: homeIndex != null ? (outcomeImages[homeIndex] || null) : null,
    awayLogo: awayIndex != null ? (outcomeImages[awayIndex] || null) : null,
    market,
    state: marketOnlyState(market),
  };
}

export function logoForTeamInRows(team, rows = []) {
  if (!team) return null;
  for (const row of rows || []) {
    const sport = row?.sport || row?.market?.sport || row?.market?.league || team.sport;
    const home = findTeamByName(sport, row?.homeName);
    if (home?.slug === team.slug && row?.homeLogo) return row.homeLogo;
    const away = findTeamByName(sport, row?.awayName);
    if (away?.slug === team.slug && row?.awayLogo) return row.awayLogo;
  }
  return null;
}
