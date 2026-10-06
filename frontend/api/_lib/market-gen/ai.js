/**
 * AI market generator.
 *
 * Emits monthly manual-review markets for model-launch questions and a
 * benchmark winner question. These intentionally do not auto-resolve:
 * model launches need official announcement/access checks, and leaderboards
 * can change methodology or lab ownership labels.
 */

import { attachSuggestedPricing } from '../market-pricing.js';
import {
  dateAtMexicoCityTime,
  endOfMexicoMonthClose,
  formatMexicoDateYmd,
  mexicoMonthKey,
  mexicoMonthNameEs,
} from './mexico-time.js';

const SOURCE_RELEASE = 'ai-model-release';
const SOURCE_NAMED_RELEASE = 'ai-named-model-release';
const SOURCE_LAB_TOP_MODEL = 'ai-lab-top-model';
const SOURCE_BENCHMARK = 'ai-benchmark';

const LABS = Object.freeze([
  {
    key: 'openai',
    label: 'OpenAI',
    officialNewsUrl: 'https://openai.com/news/',
    releaseProbability: 0.35,
  },
  {
    key: 'google',
    label: 'Google',
    officialNewsUrl: 'https://blog.google/technology/google-deepmind/',
    releaseProbability: 0.32,
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    officialNewsUrl: 'https://www.anthropic.com/news',
    releaseProbability: 0.28,
  },
]);

const BENCHMARK = Object.freeze({
  key: 'artificial-analysis-intelligence-index',
  label: 'Artificial Analysis Intelligence Index',
  leaderboardUrl: 'https://artificialanalysis.ai/leaderboards/models',
  methodologyUrl: 'https://artificialanalysis.ai/methodology/intelligence-benchmarking',
  outcomesEs: ['OpenAI', 'Google', 'Anthropic', 'xAI', 'Meta', 'Otro'],
  outcomesEn: ['OpenAI', 'Google', 'Anthropic', 'xAI', 'Meta', 'Other'],
  probabilities: [0.25, 0.21, 0.20, 0.14, 0.08, 0.12],
});

const LAB_TOP_MODEL_MARKETS = Object.freeze([
  {
    lab: 'openai',
    labLabel: 'OpenAI',
    outcomesEs: ['GPT-6.1 Astra', 'GPT-6.1 Sol', 'GPT-6 Astra', 'GPT-5.6 Sol', 'Otro OpenAI'],
    outcomesEn: ['GPT-6.1 Astra', 'GPT-6.1 Sol', 'GPT-6 Astra', 'GPT-5.6 Sol', 'Other OpenAI'],
    probabilities: [0.18, 0.28, 0.30, 0.12, 0.12],
    officialNewsUrl: 'https://openai.com/news/',
    sourceQuery: 'OpenAI GPT-6.1 Astra GPT-6.1 Sol GPT-6 Astra Artificial Analysis',
  },
  {
    lab: 'anthropic',
    labLabel: 'Anthropic',
    outcomesEs: ['Claude Fable 5.2+', 'Claude Fable 5.1', 'Claude Opus 5.5', 'Claude Sonnet 5.5', 'Otro Anthropic'],
    outcomesEn: ['Claude Fable 5.2+', 'Claude Fable 5.1', 'Claude Opus 5.5', 'Claude Sonnet 5.5', 'Other Anthropic'],
    probabilities: [0.30, 0.24, 0.24, 0.12, 0.10],
    officialNewsUrl: 'https://www.anthropic.com/news',
    sourceQuery: 'Anthropic Claude Fable 5.2 Fable 5.1 Opus 5.5 Sonnet 5.5 Artificial Analysis',
  },
  {
    lab: 'google',
    labLabel: 'Google',
    outcomesEs: ['Gemini 4 Argon', 'Gemini 3.8 Flash', 'Gemini 3.8 Live', 'Otro Gemini'],
    outcomesEn: ['Gemini 4 Argon', 'Gemini 3.8 Flash', 'Gemini 3.8 Live', 'Other Gemini'],
    probabilities: [0.48, 0.26, 0.10, 0.16],
    officialNewsUrl: 'https://blog.google/technology/google-deepmind/',
    sourceQuery: 'Google Gemini 4 Argon Gemini 3.8 Flash Artificial Analysis',
  },
]);

const NAMED_RELEASE_MARKETS = Object.freeze([
  {
    key: 'gpt-astra-6-1',
    lab: 'openai',
    labLabel: 'OpenAI',
    modelLabel: 'GPT Astra 6.1+',
    modelFamily: 'GPT Astra',
    minVersion: '6.1',
    officialNewsUrl: 'https://openai.com/news/',
    polymarketUrl: 'https://polymarket.com/all/astra',
    probability: 0.22,
  },
  {
    key: 'claude-fable-5-2',
    lab: 'anthropic',
    labLabel: 'Anthropic',
    modelLabel: 'Claude Fable 5.2+',
    modelFamily: 'Claude Fable',
    minVersion: '5.2',
    officialNewsUrl: 'https://www.anthropic.com/news',
    polymarketUrl: 'https://polymarket.com/predictions/fable',
    probability: 0.42,
  },
]);

function monthNameEn(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function monthWindow(now = new Date()) {
  const close = endOfMexicoMonthClose(now);
  const resolve = new Date(close.getTime() + 12 * 60 * 60 * 1000);
  return {
    monthKey: mexicoMonthKey(now),
    monthEs: `${mexicoMonthNameEs(now)} ${mexicoMonthKey(now).slice(0, 4)}`,
    monthEn: monthNameEn(now),
    startIso: now.toISOString(),
    closeIso: close.toISOString(),
    closeYmd: formatMexicoDateYmd(close),
    resolveIso: resolve.toISOString(),
  };
}

function yearWindow(now = new Date()) {
  const localYear = Number(mexicoMonthKey(now).slice(0, 4));
  const close = dateAtMexicoCityTime({
    year: localYear,
    month: 12,
    day: 31,
    hour: 23,
    minute: 59,
    second: 0,
  });
  const resolve = new Date(close.getTime() + 12 * 60 * 60 * 1000);
  return {
    year: localYear,
    yearLabelEs: String(localYear),
    yearLabelEn: String(localYear),
    startIso: now.toISOString(),
    closeIso: close.toISOString(),
    closeYmd: formatMexicoDateYmd(close),
    resolveIso: resolve.toISOString(),
  };
}

function withPricing(spec, probabilities) {
  return attachSuggestedPricing(spec, {
    probabilities,
    source: 'source-signals:ai',
    rationale: 'Mercado de IA para revisión manual; requiere confirmar fuente oficial o snapshot del benchmark antes de resolver.',
    evidence: spec.source_data?.evidence || [],
  });
}

function releaseCriteria(lab, window) {
  const criteriaEs = [
    `Gana Sí si ${lab.label} anuncia oficialmente y hace disponible al público un nuevo modelo fundacional o versión mayor de IA generativa entre la apertura de este mercado y el ${window.closeYmd} a las 23:59 CDMX.`,
    'Debe existir acceso público en producto, API o consola de desarrolladores.',
    'No cuentan rumores, filtraciones, waitlists sin acceso general, betas privadas, renombres de modelos existentes, ajustes de router, parches menores, fine-tunes, embeddings, modelos solo de imagen/audio/video o lanzamientos internos.',
    'Si no hay anuncio oficial y acceso público antes del cierre, gana No.',
  ].join(' ');
  const criteriaEn = [
    `Yes wins if ${lab.label} officially announces and makes publicly available a new foundation model or major generative-AI model version between this market opening and ${window.closeYmd} at 23:59 Mexico City time.`,
    'Public availability must exist through a product, API, or developer console.',
    'Rumors, leaks, waitlists without general access, private betas, existing-model renames, router changes, minor patches, fine-tunes, embeddings, image/audio/video-only models, and internal launches do not count.',
    'If there is no official announcement and public access before close, No wins.',
  ].join(' ');
  return { criteriaEs, criteriaEn };
}

function releaseMarket(lab, window) {
  const { criteriaEs, criteriaEn } = releaseCriteria(lab, window);
  const questionEs = `¿${lab.label} lanza un nuevo modelo público de IA antes de que cierre ${window.monthEs}?`;
  const questionEn = `Will ${lab.label} release a new public AI model before ${window.monthEn} closes?`;
  return withPricing({
    source: SOURCE_RELEASE,
    source_event_id: `ai-release:${window.monthKey}:${lab.key}`,
    question: questionEs,
    category: 'ai',
    icon: lab.label,
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1000,
    start_time: window.startIso,
    end_time: window.closeIso,
    amm_mode: 'unified',
    resolver_type: 'manual_review',
    resolver_config: {
      source: SOURCE_RELEASE,
      shape: 'binary',
      lab: lab.key,
      labLabel: lab.label,
      resolveAt: window.resolveIso,
      criteria: criteriaEs,
      criteriaEn,
      evidence: [{ title: `${lab.label} official news`, url: lab.officialNewsUrl }],
    },
    source_data: {
      kind: 'ai_model_release',
      generatedAt: new Date().toISOString(),
      lab: lab.key,
      labLabel: lab.label,
      monthKey: window.monthKey,
      monthLabelEs: window.monthEs,
      monthLabelEn: window.monthEn,
      closesAt: window.closeIso,
      resolvesAt: window.resolveIso,
      resolutionCriteria: criteriaEs,
      resolutionCriteriaEn: criteriaEn,
      evidence: [{ title: `${lab.label} official news`, url: lab.officialNewsUrl }],
      translations: {
        es: { question: questionEs, outcomes: ['Sí', 'No'] },
        en: { question: questionEn, outcomes: ['Yes', 'No'] },
      },
      categorization: {
        categoryTags: ['ai'],
        geoTags: ['world'],
        topicTags: ['ai'],
      },
    },
  }, [lab.releaseProbability, 1 - lab.releaseProbability]);
}

function namedReleaseCriteria(config, window) {
  const criteriaEs = [
    `Gana Sí si ${config.labLabel} anuncia oficialmente y hace disponible al público un modelo ${config.modelFamily} con versión ${config.minVersion} o superior antes del ${window.closeYmd} a las 23:59 CDMX.`,
    `El nombre del modelo debe pertenecer claramente a la familia ${config.modelFamily}; no cuentan otros modelos del mismo laboratorio con otro nombre de familia.`,
    'Debe existir acceso público en producto, API o consola de desarrolladores.',
    'No cuentan rumores, filtraciones, benchmarks sin acceso público, waitlists sin acceso general, betas privadas, renombres de modelos existentes, parches menores o modelos internos.',
    'Si no hay anuncio oficial y acceso público antes del cierre, gana No.',
  ].join(' ');
  const criteriaEn = [
    `Yes wins if ${config.labLabel} officially announces and makes publicly available a ${config.modelFamily} model with version ${config.minVersion} or higher before ${window.closeYmd} at 23:59 Mexico City time.`,
    `The model name must clearly belong to the ${config.modelFamily} family; other model families from the same lab do not count.`,
    'Public availability must exist through a product, API, or developer console.',
    'Rumors, leaks, benchmarks without public access, waitlists without general access, private betas, existing-model renames, minor patches, and internal models do not count.',
    'If there is no official announcement and public access before close, No wins.',
  ].join(' ');
  return { criteriaEs, criteriaEn };
}

function namedReleaseMarket(config, window) {
  const { criteriaEs, criteriaEn } = namedReleaseCriteria(config, window);
  const questionEs = `¿${config.modelLabel} será lanzado públicamente antes de que termine ${window.yearLabelEs}?`;
  const questionEn = `Will ${config.modelLabel} be publicly released before the end of ${window.yearLabelEn}?`;
  return withPricing({
    source: SOURCE_NAMED_RELEASE,
    source_event_id: `ai-named-release:${window.year}:${config.key}`,
    question: questionEs,
    category: 'ai',
    icon: config.modelLabel,
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1100,
    start_time: window.startIso,
    end_time: window.closeIso,
    amm_mode: 'unified',
    resolver_type: 'manual_review',
    resolver_config: {
      source: SOURCE_NAMED_RELEASE,
      shape: 'binary',
      lab: config.lab,
      labLabel: config.labLabel,
      modelLabel: config.modelLabel,
      modelFamily: config.modelFamily,
      minVersion: config.minVersion,
      resolveAt: window.resolveIso,
      criteria: criteriaEs,
      criteriaEn,
      evidence: [
        { title: `${config.labLabel} official news`, url: config.officialNewsUrl },
        { title: 'Polymarket related market search', url: config.polymarketUrl },
      ],
    },
    source_data: {
      kind: 'ai_named_model_release',
      generatedAt: new Date().toISOString(),
      lab: config.lab,
      labLabel: config.labLabel,
      modelLabel: config.modelLabel,
      modelFamily: config.modelFamily,
      minVersion: config.minVersion,
      year: window.year,
      closesAt: window.closeIso,
      resolvesAt: window.resolveIso,
      resolutionCriteria: criteriaEs,
      resolutionCriteriaEn: criteriaEn,
      evidence: [
        { title: `${config.labLabel} official news`, url: config.officialNewsUrl },
        { title: 'Polymarket related market search', url: config.polymarketUrl },
      ],
      translations: {
        es: { question: questionEs, outcomes: ['Sí', 'No'] },
        en: { question: questionEn, outcomes: ['Yes', 'No'] },
      },
      categorization: {
        categoryTags: ['ai'],
        geoTags: ['world'],
        topicTags: ['ai'],
      },
      pricingHints: {
        polymarketQuery: `${config.modelLabel} released by ${window.year}`,
        polymarketUrl: config.polymarketUrl,
      },
    },
  }, [config.probability, 1 - config.probability]);
}

function labTopModelMarket(config, window) {
  const criteriaEs = [
    `Se resuelve con el modelo público de texto de ${config.labLabel} con mayor puntaje visible en el ${BENCHMARK.label} a las 23:59 CDMX del ${window.closeYmd}.`,
    'Solo cuenta la tabla pública de modelos de Artificial Analysis.',
    'Si dos modelos del mismo laboratorio tienen el mismo puntaje numérico, gana el que aparezca con mejor ranking visible en la tabla.',
    `Si el modelo líder de ${config.labLabel} no está listado por nombre entre las opciones, gana ${config.outcomesEs.at(-1)}.`,
    'Si la metodología o la tabla no están disponibles al cierre, requiere revisión manual usando el último snapshot público verificable del mismo índice.',
  ].join(' ');
  const criteriaEn = [
    `Resolve to the public text model from ${config.labLabel} with the highest visible score on the ${BENCHMARK.label} at 23:59 Mexico City time on ${window.closeYmd}.`,
    'Only the public Artificial Analysis models leaderboard counts.',
    'If two models from the same lab share the same numeric score, the higher visible leaderboard rank wins.',
    `If ${config.labLabel}'s leading model is not listed by name among the outcomes, ${config.outcomesEn.at(-1)} wins.`,
    'If the methodology or table is unavailable at close, use manual review with the latest verifiable public snapshot of the same index.',
  ].join(' ');
  const questionEs = `¿Cuál será el mejor modelo de ${config.labLabel} en Artificial Analysis al cierre de ${window.monthEs}?`;
  const questionEn = `Which ${config.labLabel} model will rank highest on Artificial Analysis at the end of ${window.monthEn}?`;

  return withPricing({
    source: SOURCE_LAB_TOP_MODEL,
    source_event_id: `ai-lab-top-model:${window.monthKey}:${config.lab}`,
    question: questionEs,
    category: 'ai',
    icon: config.labLabel,
    outcomes: config.outcomesEs,
    seed_liquidity: 1300,
    start_time: window.startIso,
    end_time: window.closeIso,
    amm_mode: 'unified',
    resolver_type: 'manual_review',
    resolver_config: {
      source: SOURCE_LAB_TOP_MODEL,
      benchmark: BENCHMARK.key,
      benchmarkLabel: BENCHMARK.label,
      lab: config.lab,
      labLabel: config.labLabel,
      leaderboardUrl: BENCHMARK.leaderboardUrl,
      methodologyUrl: BENCHMARK.methodologyUrl,
      resolveAt: window.resolveIso,
      criteria: criteriaEs,
      criteriaEn,
      evidence: [
        { title: `${BENCHMARK.label} leaderboard`, url: BENCHMARK.leaderboardUrl },
        { title: `${BENCHMARK.label} methodology`, url: BENCHMARK.methodologyUrl },
        { title: `${config.labLabel} official news`, url: config.officialNewsUrl },
      ],
    },
    source_data: {
      kind: 'ai_lab_top_model',
      generatedAt: new Date().toISOString(),
      lab: config.lab,
      labLabel: config.labLabel,
      benchmark: BENCHMARK.key,
      benchmarkLabel: BENCHMARK.label,
      monthKey: window.monthKey,
      monthLabelEs: window.monthEs,
      monthLabelEn: window.monthEn,
      closesAt: window.closeIso,
      resolvesAt: window.resolveIso,
      resolutionCriteria: criteriaEs,
      resolutionCriteriaEn: criteriaEn,
      sourceQuery: config.sourceQuery,
      evidence: [
        { title: `${BENCHMARK.label} leaderboard`, url: BENCHMARK.leaderboardUrl },
        { title: `${BENCHMARK.label} methodology`, url: BENCHMARK.methodologyUrl },
        { title: `${config.labLabel} official news`, url: config.officialNewsUrl },
      ],
      translations: {
        es: { question: questionEs, outcomes: config.outcomesEs },
        en: { question: questionEn, outcomes: config.outcomesEn },
      },
      categorization: {
        categoryTags: ['ai'],
        geoTags: ['world'],
        topicTags: ['ai'],
      },
    },
  }, config.probabilities);
}

function benchmarkMarket(window) {
  const criteriaEs = [
    `Se resuelve con el laboratorio del modelo público de texto con mayor puntaje visible en el ${BENCHMARK.label} a las 23:59 CDMX del ${window.closeYmd}.`,
    'Solo cuenta la tabla pública de modelos de Artificial Analysis.',
    'Si dos modelos tienen el mismo puntaje numérico, gana el que aparezca con mejor ranking visible en la tabla.',
    'Si el líder pertenece a un laboratorio fuera de la lista, gana Otro.',
    'Si la metodología o la tabla no están disponibles al cierre, requiere revisión manual usando el último snapshot público verificable del mismo índice.',
  ].join(' ');
  const criteriaEn = [
    `Resolve to the lab behind the public text model with the highest visible score on the ${BENCHMARK.label} at 23:59 Mexico City time on ${window.closeYmd}.`,
    'Only the public Artificial Analysis models leaderboard counts.',
    'If two models share the same numeric score, the higher visible leaderboard rank wins.',
    'If the leading model belongs to a lab outside the listed outcomes, Other wins.',
    'If the methodology or table is unavailable at close, use manual review with the latest verifiable public snapshot of the same index.',
  ].join(' ');
  const questionEs = `¿Quién tendrá el mejor modelo de IA en Artificial Analysis al cierre de ${window.monthEs}?`;
  const questionEn = `Who will have the top AI model on Artificial Analysis at the end of ${window.monthEn}?`;

  return withPricing({
    source: SOURCE_BENCHMARK,
    source_event_id: `ai-benchmark:${window.monthKey}:artificial-analysis-index-lab`,
    question: questionEs,
    category: 'ai',
    icon: 'AI',
    outcomes: BENCHMARK.outcomesEs,
    seed_liquidity: 1400,
    start_time: window.startIso,
    end_time: window.closeIso,
    amm_mode: 'unified',
    resolver_type: 'manual_review',
    resolver_config: {
      source: SOURCE_BENCHMARK,
      benchmark: BENCHMARK.key,
      benchmarkLabel: BENCHMARK.label,
      leaderboardUrl: BENCHMARK.leaderboardUrl,
      methodologyUrl: BENCHMARK.methodologyUrl,
      resolveAt: window.resolveIso,
      criteria: criteriaEs,
      criteriaEn,
      evidence: [
        { title: `${BENCHMARK.label} leaderboard`, url: BENCHMARK.leaderboardUrl },
        { title: `${BENCHMARK.label} methodology`, url: BENCHMARK.methodologyUrl },
      ],
    },
    source_data: {
      kind: 'ai_benchmark_winner',
      generatedAt: new Date().toISOString(),
      benchmark: BENCHMARK.key,
      benchmarkLabel: BENCHMARK.label,
      monthKey: window.monthKey,
      monthLabelEs: window.monthEs,
      monthLabelEn: window.monthEn,
      closesAt: window.closeIso,
      resolvesAt: window.resolveIso,
      resolutionCriteria: criteriaEs,
      resolutionCriteriaEn: criteriaEn,
      evidence: [
        { title: `${BENCHMARK.label} leaderboard`, url: BENCHMARK.leaderboardUrl },
        { title: `${BENCHMARK.label} methodology`, url: BENCHMARK.methodologyUrl },
      ],
      translations: {
        es: { question: questionEs, outcomes: BENCHMARK.outcomesEs },
        en: { question: questionEn, outcomes: BENCHMARK.outcomesEn },
      },
      categorization: {
        categoryTags: ['ai'],
        geoTags: ['world'],
        topicTags: ['ai'],
      },
    },
  }, BENCHMARK.probabilities);
}

export async function generateAiMarkets({ now = new Date() } = {}) {
  const window = monthWindow(now);
  const namedWindow = yearWindow(now);
  return [
    ...LABS.map(lab => releaseMarket(lab, window)),
    ...LAB_TOP_MODEL_MARKETS.map(config => labTopModelMarket(config, window)),
    ...NAMED_RELEASE_MARKETS.map(config => namedReleaseMarket(config, namedWindow)),
    benchmarkMarket(window),
  ];
}

export const _internal = {
  BENCHMARK,
  LABS,
  LAB_TOP_MODEL_MARKETS,
  NAMED_RELEASE_MARKETS,
  benchmarkMarket,
  labTopModelMarket,
  monthWindow,
  namedReleaseMarket,
  releaseMarket,
  yearWindow,
};
