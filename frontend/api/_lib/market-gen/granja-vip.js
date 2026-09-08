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
  const weeklySpec = buildGranjaVipWeeklyMarketSpec({ snapshot, now });
  if (!weeklySpec) return [];

  return [attachSuggestedPricing(weeklySpec, {
    probabilities: uniformProbabilities(weeklySpec.outcomes.length),
    source: 'granja-vip-official:nominated',
    rationale: 'Nominados visibles en TV Azteca; admin debe revisar el mercado y confirmar el resultado tras la gala.',
    evidence: weeklySpec.resolver_config?.evidence || [],
  })];
}

export const _internal = {
  uniformProbabilities,
};
