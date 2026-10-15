import {
  buildGranjaVipWeeklyMarketSpec,
  readGranjaVipOfficialSnapshot,
} from '../granja-vip-official.js';
import { attachSuggestedPricing } from '../market-pricing.js';

function uniformProbabilities(count) {
  if (!Number.isInteger(count) || count < 2) return [];
  return Array.from({ length: count }, () => 1 / count);
}

export async function generateGranjaVipMarkets({
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  if (process.env.GRANJA_VIP_OFFICIAL_ENABLED === 'false') return [];

  const snapshot = await readGranjaVipOfficialSnapshot({ fetchImpl, now });
  return ['elimination', 'capataz'].map(kind => buildGranjaVipWeeklyMarketSpec({ snapshot, now, kind }))
    .filter(Boolean).map(weeklySpec => attachSuggestedPricing(weeklySpec, {
      probabilities: uniformProbabilities(weeklySpec.outcomes.length),
      source: `granja-vip-official:${weeklySpec.resolver_config.kind}`,
      rationale: 'Participantes y fecha leidos de TV Azteca; admin revisa antes de aprobar. Solo se paga con un resultado oficial claro de esa semana.',
      evidence: weeklySpec.resolver_config?.evidence || [],
    }));
}

export const _internal = {
  uniformProbabilities,
};
