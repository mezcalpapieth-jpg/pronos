import { translate } from '../../../src/lib/i18n.js';

// Use the same accent-insensitive matching in every public market search.
export function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function values(list) {
  return Array.isArray(list) ? list : [];
}

function teamNames(team) {
  if (typeof team === 'string') return [team];
  return [team?.name, team?.shortName, team?.displayName, team?.abbreviation];
}

export function matchesMarketSearch(market, query) {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  if (!market) return false;

  const { liveScoreConfig, resolverConfig, seriesMeta } = market;
  const categories = [market.category, ...values(market.categoryTags)].filter(Boolean);
  const categoryLabels = categories.flatMap(category => {
    const slug = String(category).toLowerCase();
    const key = `points.cat.${slug === 'world-cup' ? 'worldCup' : slug}`;
    return ['es', 'en'].map(lang => translate(key, lang)).filter(label => label !== key);
  });
  const teams = [
    seriesMeta?.homeTeam, seriesMeta?.awayTeam, ...values(seriesMeta?.teams),
    resolverConfig?.homeTeam, resolverConfig?.awayTeam,
    liveScoreConfig?.homeName, liveScoreConfig?.awayName,
  ];

  return [
    market.question, market.title, market.title_es, market.title_en,
    ...values(market.outcomes), ...values(market.outcomes_es), ...values(market.outcomes_en),
    ...categories, ...categoryLabels, ...teams.flatMap(teamNames),
  ].some(value => typeof value === 'string' && normalizeSearchText(value).includes(needle));
}
