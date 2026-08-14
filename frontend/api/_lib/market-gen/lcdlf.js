import {
  buildLcdlfNominationMarketSpecs,
  buildLcdlfWeeklyMarketSpec,
  readLcdlfOfficialSnapshot,
} from '../lcdlf-official.js';
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
  const nominationSpecs = buildLcdlfNominationMarketSpecs({ snapshot, now });
  const weeklySpec = buildLcdlfWeeklyMarketSpec({ snapshot, now });
  const specs = [
    ...nominationSpecs.map(spec => attachSuggestedPricing(spec, {
      probabilities: spec.amm_mode === 'parallel'
        ? uniformProbabilities(spec.outcomes.length)
        : [0.32, 0.68],
      source: 'lcdlf-official:active-resident',
      rationale: 'Habitante activo en el sitio oficial; el mercado se cierra cuando la fuente marca nominación o “podría estar eliminado/a”.',
      evidence: spec.resolver_config?.evidence || [],
    })),
    ...(weeklySpec ? [attachSuggestedPricing(weeklySpec, {
      probabilities: uniformProbabilities(weeklySpec.outcomes.length),
      source: 'lcdlf-official:nominated',
      rationale: 'Nominados oficiales del sitio de La Casa de los Famosos México; admin puede editar odds y liquidez antes de aprobar.',
      evidence: weeklySpec.resolver_config?.evidence || [],
    })] : []),
  ];
  if (!specs.length) return [];

  return specs;
}

export const _internal = {
  uniformProbabilities,
};
