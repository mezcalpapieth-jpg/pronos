import {
  buildGranjaVipWeeklyMarketSpec,
  readGranjaVipOfficialSnapshot,
} from '../granja-vip-official.js';
import { attachSuggestedPricing } from '../market-pricing.js';
import { isRealityShowInSeason } from './reality-show-seasons.js';

function uniformProbabilities(count) {
  if (!Number.isInteger(count) || count < 2) return [];
  return Array.from({ length: count }, () => 1 / count);
}

export async function generateGranjaVipMarkets({
  now = new Date(),
  fetchImpl = fetch,
  reportFeedError,
  reportSkip = () => {},
} = {}) {
  if (process.env.GRANJA_VIP_OFFICIAL_ENABLED === 'false') return [];
  if (!isRealityShowInSeason('granja-vip', now)) {
    reportSkip('outside_season');
    return [];
  }

  const snapshot = await readGranjaVipOfficialSnapshot({ fetchImpl, now, reportFeedError });
  return ['elimination', 'capataz'].map(kind => buildGranjaVipWeeklyMarketSpec({ snapshot, now, kind }))
    .filter(spec => spec && isRealityShowInSeason('granja-vip', new Date(spec.end_time)))
    .map(weeklySpec => attachSuggestedPricing(weeklySpec, {
      probabilities: uniformProbabilities(weeklySpec.outcomes.length),
      source: `granja-vip-official:${weeklySpec.resolver_config.kind}`,
      rationale: 'Participantes y fecha leidos de TV Azteca; admin revisa antes de aprobar. Solo se paga con un resultado oficial claro de esa semana.',
      evidence: weeklySpec.resolver_config?.evidence || [],
    }));
}

export const _internal = {
  uniformProbabilities,
};
