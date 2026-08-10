import { buildLcdlfWeeklyMarketSpec, readLcdlfOfficialSnapshot } from '../lcdlf-official.js';
import { attachSuggestedPricing } from '../market-pricing.js';

function uniformProbabilities(count) {
  if (!Number.isInteger(count) || count < 2) return [];
  return Array.from({ length: count }, () => 1 / count);
}

export async function generateLcdlfMarkets({
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  if (process.env.LCDLF_OFFICIAL_ENABLED === 'false') return [];

  const snapshot = await readLcdlfOfficialSnapshot({ fetchImpl, now });
  const spec = buildLcdlfWeeklyMarketSpec({ snapshot, now });
  if (!spec) return [];

  return [
    attachSuggestedPricing(spec, {
      probabilities: uniformProbabilities(spec.outcomes.length),
      source: 'lcdlf-official:nominated',
      rationale: 'Nominados oficiales del sitio de La Casa de los Famosos México; admin puede editar odds y liquidez antes de aprobar.',
      evidence: spec.resolver_config?.evidence || [],
    }),
  ];
}

export const _internal = {
  uniformProbabilities,
};
