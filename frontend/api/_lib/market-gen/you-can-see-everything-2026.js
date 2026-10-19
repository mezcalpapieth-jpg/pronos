import { automaticConfig, applyAutomaticContract, RT_THRESHOLD_KIND, RT_THRESHOLD_FILMS } from '../automated-market-rules.js';
import { attachGeneratedPointsLiquidity } from '../market-pricing.js';

export const YOU_CAN_SEE_EVERYTHING_CUTOFF = '2026-10-26T05:59:00.000Z';
export const YOU_CAN_SEE_EVERYTHING_EVENT = 'rt:you-can-see-everything-2026:above-95:2026-10-25';

// Explicitly requested one-off market; not registered as a recurring generator.
export function buildYouCanSeeEverythingMarket({ now = new Date(), observation = null } = {}) {
  const movie = RT_THRESHOLD_FILMS['you-can-see-everything-2026'];
  const config = automaticConfig(RT_THRESHOLD_KIND, {
    cutoff: YOU_CAN_SEE_EVERYTHING_CUTOFF, film: 'you-can-see-everything-2026', threshold: 95,
  });
  const question = '¿You Can See Everything tendrá más de 95% en el Tomatometer el domingo 25 de octubre?';
  const questionEn = 'Will You Can See Everything have a Tomatometer above 95% on Sunday, October 25?';
  const context = 'You Can See Everything (2026), de Nathan Fielder y Lance Oppenheim, tiene una página oficial en Rotten Tomatoes. El porcentaje de críticas positivas puede cambiar al agregarse reseñas. Se evalúa el All Critics Tomatometer del domingo 25 de octubre de 2026 a las 23:59 CDMX.';
  const contextEn = 'You Can See Everything (2026), directed by Nathan Fielder and Lance Oppenheim, has an official Rotten Tomatoes page. Its percentage of positive reviews can change as reviews are added. This market uses the All Critics Tomatometer on Sunday, October 25, 2026 at 23:59 Mexico City time.';
  return attachGeneratedPointsLiquidity(applyAutomaticContract({
    source: 'codex-entertainment', source_event_id: YOU_CAN_SEE_EVERYTHING_EVENT,
    question, category: 'musica', icon: null, outcomes: ['Sí', 'No'], amm_mode: 'unified',
    seed_liquidity: 1000, start_time: now.toISOString(), end_time: YOU_CAN_SEE_EVERYTHING_CUTOFF,
    featured: false, tournament_featured: false, is_test_market: false,
    category_tags: ['musica'], geo_tags: ['world'], topic_tags: ['cine'],
    source_data: {
      kind: 'rotten_tomatoes_threshold', generatedAt: now.toISOString(), sourceUrl: movie.url,
      context, contextEn,
      evidence: [{ title: 'You Can See Everything (2026): All Critics Tomatometer', url: movie.url }],
      translations: {
        es: { question, outcomes: ['Sí', 'No'], context, resolutionCriteria: config.criteria },
        en: { question: questionEn, outcomes: ['Yes', 'No'], context: contextEn, resolutionCriteria: config.criteriaEn },
      },
      ...(observation ? { creationObservation: observation } : {}),
      // Approval must wait until the new resolver is released; creating this row does not deploy code.
      resolverReleaseRequired: RT_THRESHOLD_KIND,
    },
  }, config));
}
