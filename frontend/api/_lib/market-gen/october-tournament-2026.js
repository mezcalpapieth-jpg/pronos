import { readChainlinkPrice, FEEDS_ARBITRUM_ONE } from '../chainlink.js';
import { BANXICO_FIX_RESOLUTION_CRITERIA, readBanxicoLatest, SERIES } from '../banxico.js';
import { readCreAverages, fuelLabel } from '../fuel.js';
import { attachSuggestedPricing } from '../market-pricing.js';
import { IBTRACS_PRODUCT_PAGE } from '../hurricanes.js';
import { dateAtMexicoCityTime } from './mexico-time.js';

const SOURCE = 'october-tournament-2026';
const START_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 1,
  hour: 0,
  minute: 0,
}).toISOString();
const TOURNAMENT_END_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 31,
  hour: 23,
  minute: 59,
}).toISOString();

const PRICE_TRADING_CLOSE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 30,
  hour: 14,
  minute: 59,
}).toISOString();
const PRICE_RESOLVE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 30,
  hour: 15,
  minute: 0,
}).toISOString();
const COMMODITY_WEEKLY_RESOLVE_WINDOWS = Object.freeze([
  dateAtMexicoCityTime({ year: 2026, month: 10, day: 7, hour: 15, minute: 0 }).toISOString(),
  dateAtMexicoCityTime({ year: 2026, month: 10, day: 14, hour: 15, minute: 0 }).toISOString(),
  dateAtMexicoCityTime({ year: 2026, month: 10, day: 21, hour: 15, minute: 0 }).toISOString(),
  dateAtMexicoCityTime({ year: 2026, month: 10, day: 28, hour: 15, minute: 0 }).toISOString(),
]);
const USD_MXN_TRADING_CLOSE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 30,
  hour: 11,
  minute: 59,
}).toISOString();
const USD_MXN_RESOLVE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 30,
  hour: 12,
  minute: 0,
}).toISOString();
const FUEL_TRADING_CLOSE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 30,
  hour: 23,
  minute: 59,
}).toISOString();
const NOBEL_CLOSE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 8,
  hour: 23,
  minute: 59,
}).toISOString();
const NOBEL_RESOLVE_ISO = '2026-10-09T09:00:00.000Z';
const STREET_FIGHTER_CLOSE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 19,
  hour: 7,
  minute: 59,
}).toISOString();
const STREET_FIGHTER_RESOLVE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 19,
  hour: 8,
  minute: 0,
}).toISOString();
const BALLON_DOR_CLOSE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 26,
  hour: 11,
  minute: 59,
}).toISOString();
const FED_CLOSE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 28,
  hour: 11,
  minute: 59,
}).toISOString();
const FED_RESOLVE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 28,
  hour: 12,
  minute: 0,
}).toISOString();
const GDP_CLOSE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 29,
  hour: 23,
  minute: 59,
}).toISOString();
const GDP_RESOLVE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 10,
  day: 30,
  hour: 8,
  minute: 0,
}).toISOString();
const HURRICANE_RESOLVE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 11,
  day: 4,
  hour: 12,
  minute: 0,
}).toISOString();
const FOOD_PRICE_RESOLVE_ISO = dateAtMexicoCityTime({
  year: 2026,
  month: 11,
  day: 2,
  hour: 12,
  minute: 0,
}).toISOString();

const EVIDENCE = Object.freeze({
  banxicoFix: 'https://www.banxico.org.mx/tipcamb/main.do?page=tip&idioma=sp',
  crePrices: 'https://publicacionexterna.azurewebsites.net/publicaciones/prices',
  chainlinkFeeds: 'https://docs.chain.link/data-feeds/price-feeds/addresses',
  chainlinkXau: 'https://data.chain.link/feeds/arbitrum/mainnet/xau-usd',
  nobelDates: 'https://www.nobelprize.org/prizes/about/prize-announcement-dates/',
  nobelPeaceAnnouncement: 'https://www.nobelpeaceprize.org/press/events/announcement-nobel-peace-prize-2026',
  prioNobelUpdatedList: 'https://www.prio.org/news/3746',
  rottenTomatoes: 'https://www.rottentomatoes.com/',
  ballonDor: 'https://www.uefa.com/ballondor/',
  ballonDorNominees: 'https://www.uefa.com/uefachampionsleague/news/02a9-218b019cbca5-cb4b9be51c4b-1000--2026-ballon-dor-awards-nominees-revealed/',
  fedCalendar: 'https://www.federalreserve.gov/newsevents/2026-october.htm',
  inegiFeeds: 'https://www.inegi.org.mx/servicios/feedsnoticias/feeds.html',
  ibtracs: IBTRACS_PRODUCT_PAGE,
  sniimTortilla: 'https://www.economia-sniim.gob.mx/Tortilla.asp',
  sniimNationalMarkets: 'https://www.economia-sniim.gob.mx/e_MenNal.asp',
  siapWhiteCorn: 'https://nube.agricultura.gob.mx/Balanza/MaizGranoBlanco/index.php',
});

const DEFAULT_NOBEL_PEACE_CANDIDATES_ES = Object.freeze([
  'Mykola Kuleba y Save the Children',
  'Salas de Respuesta de Emergencia de Sudán',
  'Comité para la Protección de los Periodistas',
  'Corte Internacional de Justicia y Corte Penal Internacional',
  'Estación Espacial Internacional',
]);

const DEFAULT_NOBEL_PEACE_CANDIDATES_EN = Object.freeze([
  'Mykola Kuleba and Save the Children',
  "Sudan's Emergency Response Rooms",
  'Committee to Protect Journalists',
  'International Court of Justice and International Criminal Court',
  'International Space Station',
]);

const DEFAULT_BALLON_DOR_CANDIDATES = Object.freeze([
  'Lamine Yamal',
  'Kylian Mbappé',
  'Erling Haaland',
  'Ousmane Dembélé',
  'Jude Bellingham',
  'Vitinha',
]);

function roundDownToStep(value, step) {
  return Math.floor(Number(value) / step) * step;
}

function formatMoney(value, decimals, { prefix = '$', suffix = '' } = {}) {
  return `${prefix}${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;
}

function buildPriceBuckets(current, {
  step,
  decimals,
  prefix = '$',
  suffix = '',
}) {
  const base = roundDownToStep(current, step);
  const boundaries = Array.from({ length: 6 }, (_, i) => base + (i - 2) * step)
    .map(value => Number(value.toFixed(decimals + 2)));

  const buckets = [];
  const outcomesEs = [];
  const outcomesEn = [];
  for (let i = 0; i <= boundaries.length; i += 1) {
    const lower = i === 0 ? null : boundaries[i - 1];
    const upper = i === boundaries.length ? null : boundaries[i];
    let es;
    let en;
    if (lower == null) {
      es = `Menos de ${formatMoney(upper, decimals, { prefix, suffix })}`;
      en = `Under ${formatMoney(upper, decimals, { prefix, suffix })}`;
    } else if (upper == null) {
      es = `${formatMoney(lower, decimals, { prefix, suffix })} o más`;
      en = `${formatMoney(lower, decimals, { prefix, suffix })} or higher`;
    } else {
      es = `${formatMoney(lower, decimals, { prefix, suffix })} a ${formatMoney(upper, decimals, { prefix, suffix })}`;
      en = `${formatMoney(lower, decimals, { prefix, suffix })} to ${formatMoney(upper, decimals, { prefix, suffix })}`;
    }
    outcomesEs.push(es);
    outcomesEn.push(en);
    buckets.push({
      label: es,
      labelEn: en,
      min: lower,
      max: upper,
    });
  }
  return { buckets, outcomesEs, outcomesEn };
}

function sourceDataBase({
  kind,
  translations,
  tags,
  resolutionCriteria,
  evidence,
  extra = {},
}) {
  return {
    kind,
    generatedAt: new Date().toISOString(),
    tournament: {
      key: 'october-2026',
      label: 'Torneo octubre 2026',
      startsAt: START_ISO,
      endsAt: TOURNAMENT_END_ISO,
    },
    touchMarket: false,
    resolutionCriteria,
    evidence,
    translations,
    categorization: tags,
    ...extra,
  };
}

function pricedSpec(spec, probabilities = null) {
  const tournamentSpec = { tournament_featured: true, ...spec };
  return attachSuggestedPricing(tournamentSpec, {
    probabilities: probabilities || Array.from({ length: tournamentSpec.outcomes.length }, () => 1 / tournamentSpec.outcomes.length),
    source: 'cofounder-brief',
    rationale: 'Mercado preparado para el torneo octubre 2026; revisar en admin antes de aprobar.',
    evidence: tournamentSpec.source_data?.evidence || [],
  });
}

function buildPriceBucketSpec({
  key,
  questionEs,
  questionEn,
  category,
  tags,
  icon,
  outcomesEs,
  outcomesEn,
  buckets,
  endTime,
  resolverType,
  resolverConfig,
  evidence,
  resolutionCriteria,
  extraSourceData = {},
}) {
  return pricedSpec({
    source: SOURCE,
    source_event_id: `october-2026:${key}`,
    question: questionEs,
    category,
    icon,
    outcomes: outcomesEs,
    seed_liquidity: 1200,
    start_time: START_ISO,
    end_time: endTime,
    amm_mode: 'unified',
    resolver_type: resolverType,
    resolver_config: {
      ...resolverConfig,
      shape: 'price-bucket',
      buckets,
      tieRule: 'upper_bucket',
      criteria: resolutionCriteria,
      rationale: resolutionCriteria,
    },
    source_data: sourceDataBase({
      kind: 'october_tournament_price_bucket',
      translations: {
        es: { question: questionEs, outcomes: outcomesEs },
        en: { question: questionEn, outcomes: outcomesEn },
      },
      tags,
      resolutionCriteria,
      evidence,
      extra: {
        bucketTieRule: 'upper_bucket',
        ...extraSourceData,
      },
    }),
  });
}

function buildManualSpec({
  key,
  questionEs,
  questionEn,
  category,
  tags,
  icon,
  outcomesEs,
  outcomesEn,
  closeIso,
  resolveIso,
  criteriaEs,
  criteriaEn,
  evidence,
  kind = 'october_tournament_manual',
  extraSourceData = {},
}) {
  return pricedSpec({
    source: SOURCE,
    source_event_id: `october-2026:${key}`,
    question: questionEs,
    category,
    icon,
    outcomes: outcomesEs,
    seed_liquidity: 1000,
    start_time: START_ISO,
    end_time: closeIso,
    amm_mode: 'unified',
    resolver_type: 'manual_review',
    resolver_config: {
      source: SOURCE,
      shape: 'manual',
      resolveAt: resolveIso,
      criteria: criteriaEs,
      criteriaEn,
      evidence,
    },
    source_data: sourceDataBase({
      kind,
      translations: {
        es: { question: questionEs, outcomes: outcomesEs },
        en: { question: questionEn, outcomes: outcomesEn },
      },
      tags,
      resolutionCriteria: criteriaEs,
      evidence,
      extra: {
        resolveAt: resolveIso,
        resolutionCriteriaEn: criteriaEn,
        ...extraSourceData,
      },
    }),
  });
}

function buildAutoBinarySpec({
  key,
  questionEs,
  questionEn,
  category,
  tags,
  icon,
  outcomesEs,
  outcomesEn,
  closeIso,
  resolverType,
  resolverConfig,
  criteriaEs,
  criteriaEn,
  evidence,
  kind,
  extraSourceData = {},
  touchMarket = false,
}) {
  return pricedSpec({
    source: SOURCE,
    source_event_id: `october-2026:${key}`,
    question: questionEs,
    category,
    icon,
    outcomes: outcomesEs,
    seed_liquidity: 1000,
    start_time: START_ISO,
    end_time: closeIso,
    amm_mode: 'unified',
    resolver_type: resolverType,
    resolver_config: {
      ...resolverConfig,
      criteria: criteriaEs,
      criteriaEn,
      evidence,
    },
    source_data: sourceDataBase({
      kind,
      translations: {
        es: { question: questionEs, outcomes: outcomesEs },
        en: { question: questionEn, outcomes: outcomesEn },
      },
      tags,
      resolutionCriteria: criteriaEs,
      evidence,
      extra: {
        touchMarket,
        resolutionCriteriaEn: criteriaEn,
        ...extraSourceData,
      },
    }),
  }, [0.28, 0.72]);
}

function csvList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function candidateOutcomes(env, key, fallbackEs = [], fallbackEn = fallbackEs) {
  const configuredEs = csvList(env[`${key}_ES`] || env[key]);
  const configuredEn = csvList(env[`${key}_EN`] || env[key]);
  const es = configuredEs.length >= 2 ? configuredEs : fallbackEs;
  if (es.length < 2) return null;
  const enRaw = configuredEn.length >= 2 ? configuredEn : (configuredEs.length >= 2 ? configuredEs : fallbackEn);
  const en = enRaw.length >= 2 ? enRaw : es;
  return {
    es: [...es.slice(0, 6), 'Otro'],
    en: [...en.slice(0, 6), 'Other'],
  };
}

function bucketMetadata(outcomesEs, outcomesEn, ranges) {
  return outcomesEs.map((label, idx) => ({
    label,
    labelEn: outcomesEn[idx],
    ...(ranges[idx] || {}),
  }));
}

async function usdMxnSpec() {
  let latest;
  try {
    latest = await readBanxicoLatest(SERIES.FX_USD_MXN);
  } catch (e) {
    console.warn('[market-gen/october-2026] Banxico read failed; skipping USD/MXN', {
      message: e?.message,
    });
    return [];
  }
  if (!Number.isFinite(latest?.value)) return [];

  const { buckets, outcomesEs, outcomesEn } = buildPriceBuckets(latest.value, {
    step: 0.25,
    decimals: 2,
    prefix: '$',
    suffix: ' MXN',
  });
  const criteria = `${BANXICO_FIX_RESOLUTION_CRITERIA} Para buckets, el valor exacto en un limite gana el bucket superior.`;
  return [buildPriceBucketSpec({
    key: 'usd-mxn-close',
    questionEs: 'USD/MXN cierre de octubre 2026',
    questionEn: 'USD/MXN October 2026 close',
    category: 'finanzas',
    tags: { categoryTags: ['finanzas', 'mexico'], geoTags: ['mexico'], topicTags: ['finanzas'] },
    icon: '$',
    outcomesEs,
    outcomesEn,
    buckets,
    endTime: USD_MXN_TRADING_CLOSE_ISO,
    resolverType: 'api_price',
    resolverConfig: {
      source: 'banxico-fix',
      seriesId: SERIES.FX_USD_MXN,
      resolveDateYmd: '2026-10-30',
      resolveAt: USD_MXN_RESOLVE_ISO,
      symbol: 'USD/MXN',
    },
    resolutionCriteria: criteria,
    evidence: [{ title: 'Banxico FIX', url: EVIDENCE.banxicoFix }],
    extraSourceData: {
      pair: 'USD/MXN',
      spotAtGeneration: latest.value,
      spotFecha: latest.fecha,
      sourceTitle: latest.title,
      closesAt: USD_MXN_TRADING_CLOSE_ISO,
      resolvesAt: USD_MXN_RESOLVE_ISO,
    },
  })];
}

async function premiumGasolineSpec() {
  let averages;
  try {
    averages = await readCreAverages();
  } catch (e) {
    console.warn('[market-gen/october-2026] CRE read failed; skipping premium gasoline', {
      message: e?.message,
    });
    return [];
  }
  const avg = averages.premium;
  if (!Number.isFinite(avg)) return [];

  const { buckets, outcomesEs, outcomesEn } = buildPriceBuckets(avg, {
    step: 0.5,
    decimals: 2,
    prefix: '$',
    suffix: ' MXN/L',
  });
  const criteria = 'Se resuelve con el promedio nacional de gasolina Premium calculado desde la publicacion publica de precios CRE al cierre de octubre. Si cae exactamente en un limite, gana el bucket superior.';
  return [buildPriceBucketSpec({
    key: 'premium-gasoline-close',
    questionEs: 'Gasolina Premium: promedio nacional cierre de octubre 2026',
    questionEn: 'Premium gasoline: Mexico national average at October 2026 close',
    category: 'finanzas',
    tags: { categoryTags: ['finanzas', 'mexico'], geoTags: ['mexico'], topicTags: ['finanzas'] },
    icon: 'gas',
    outcomesEs,
    outcomesEn,
    buckets,
    endTime: FUEL_TRADING_CLOSE_ISO,
    resolverType: 'api_price',
    resolverConfig: {
      source: 'cre-gasolina',
      fuelType: 'premium',
      resolveAt: FUEL_TRADING_CLOSE_ISO,
      symbol: 'Premium MXN/L',
    },
    resolutionCriteria: criteria,
    evidence: [{ title: 'CRE precios publicos', url: EVIDENCE.crePrices }],
    extraSourceData: {
      fuelType: 'premium',
      fuelLabel: fuelLabel('premium'),
      spotAtGeneration: avg,
      sampleSize: averages.sampleSize?.premium ?? null,
      closesAt: FUEL_TRADING_CLOSE_ISO,
      resolvesAt: FUEL_TRADING_CLOSE_ISO,
    },
  })];
}

function weeklyCommodityWindow(now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const fallback = COMMODITY_WEEKLY_RESOLVE_WINDOWS[0];
  const resolveIso = COMMODITY_WEEKLY_RESOLVE_WINDOWS.find(iso => {
    const ms = new Date(iso).getTime();
    return !Number.isFinite(nowMs) || ms > nowMs;
  }) || COMMODITY_WEEKLY_RESOLVE_WINDOWS[COMMODITY_WEEKLY_RESOLVE_WINDOWS.length - 1] || fallback;
  const resolveMs = new Date(resolveIso).getTime();
  const closeIso = Number.isFinite(resolveMs)
    ? new Date(resolveMs - 60 * 1000).toISOString()
    : PRICE_TRADING_CLOSE_ISO;
  return {
    keySuffix: resolveIso.slice(0, 10),
    closeIso,
    resolveIso,
  };
}

async function chainlinkBucketSpec({
  asset,
  feed,
  step,
  decimals,
  envKey,
  env = process.env,
  key = `${asset.toLowerCase()}-usd-close`,
  displayNameEs = asset,
  displayNameEn = asset,
  questionEs = `${asset} cierre de octubre 2026`,
  questionEn = `${asset} October 2026 close`,
  closeIso = PRICE_TRADING_CLOSE_ISO,
  resolveIso = PRICE_RESOLVE_ISO,
  criteriaEs = null,
  category = asset === 'BTC' || asset === 'ETH' ? 'crypto' : 'finanzas',
  tags = {
    categoryTags: [asset === 'BTC' || asset === 'ETH' ? 'crypto' : 'finanzas'],
    geoTags: ['world'],
    topicTags: [asset === 'BTC' || asset === 'ETH' ? 'crypto' : 'finanzas'],
  },
  icon = asset,
}) {
  const configuredFeed = feed || {
    feedAddress: env[`${envKey}_FEED_ADDRESS`],
    chainId: Number(env[`${envKey}_CHAIN_ID`] || 42161),
    symbol: env[`${envKey}_SYMBOL`] || `${asset}/USD`,
  };
  if (!configuredFeed?.feedAddress) {
    console.warn(`[market-gen/october-2026] ${asset} feed not configured; skipping`);
    return [];
  }

  let spot;
  try {
    spot = await readChainlinkPrice(configuredFeed);
  } catch (e) {
    console.warn('[market-gen/october-2026] Chainlink read failed; skipping asset', {
      asset,
      feedAddress: configuredFeed.feedAddress,
      message: e?.message,
    });
    return [];
  }
  if (!Number.isFinite(spot)) return [];

  const { buckets, outcomesEs, outcomesEn } = buildPriceBuckets(spot, {
    step,
    decimals,
    prefix: '$',
    suffix: ' USD',
  });
  const criteria = criteriaEs
    || `${displayNameEs} se resuelve con el precio del feed Chainlink ${configuredFeed.symbol || `${asset}/USD`} a las 15:00 CDMX del 30 de octubre de 2026. Si cae exactamente en un limite, gana el bucket superior.`;
  return [buildPriceBucketSpec({
    key,
    questionEs,
    questionEn,
    category,
    tags,
    icon,
    outcomesEs,
    outcomesEn,
    buckets,
    endTime: closeIso,
    resolverType: 'chainlink_price',
    resolverConfig: {
      source: 'chainlink',
      feedAddress: configuredFeed.feedAddress,
      chainId: configuredFeed.chainId,
      symbol: configuredFeed.symbol || `${asset}/USD`,
      closesAt: resolveIso,
      resolveAt: resolveIso,
    },
    resolutionCriteria: criteria,
    evidence: [{
      title: asset === 'XAU' ? 'Chainlink XAU/USD' : 'Chainlink price feeds',
      url: asset === 'XAU' ? EVIDENCE.chainlinkXau : EVIDENCE.chainlinkFeeds,
    }],
    extraSourceData: {
      asset,
      displayNameEs,
      displayNameEn,
      spotAtGeneration: spot,
      feed: configuredFeed.feedAddress,
      chainId: configuredFeed.chainId,
      closesAt: closeIso,
      resolvesAt: resolveIso,
    },
  })];
}

async function commodityChainlinkSpecs({
  asset,
  displayNameEs,
  displayNameEn,
  step,
  decimals,
  envKey,
  env,
  now,
  defaultChainId = 42161,
}) {
  const weekly = weeklyCommodityWindow(now);
  const configuredFeed = {
    feedAddress: env[`${envKey}_FEED_ADDRESS`],
    chainId: Number(env[`${envKey}_CHAIN_ID`] || defaultChainId),
    symbol: env[`${envKey}_SYMBOL`] || `${asset}/USD`,
  };
  if (!configuredFeed.feedAddress) {
    console.warn(`[market-gen/october-2026] ${asset} feed not configured; skipping`);
    return [];
  }
  const common = {
    asset,
    displayNameEs,
    displayNameEn,
    step,
    decimals,
    envKey,
    env,
    feed: configuredFeed,
    category: 'finanzas',
    tags: {
      categoryTags: ['finanzas'],
      geoTags: ['world'],
      topicTags: ['finanzas', 'commodities'],
    },
    icon: asset,
  };
  const specs = [];
  specs.push(...await chainlinkBucketSpec({
    ...common,
    key: `${asset.toLowerCase()}-usd-weekly-${weekly.keySuffix}`,
    questionEs: `${displayNameEs}: cierre semanal ${weekly.keySuffix}`,
    questionEn: `${displayNameEn}: weekly close ${weekly.keySuffix}`,
    closeIso: weekly.closeIso,
    resolveIso: weekly.resolveIso,
    criteriaEs: `${displayNameEs} se resuelve con el precio del feed Chainlink ${configuredFeed.symbol || `${asset}/USD`} a las 15:00 CDMX del ${weekly.keySuffix}. Si cae exactamente en un limite, gana el bucket superior.`,
  }));
  specs.push(...await chainlinkBucketSpec({
    ...common,
    key: `${asset.toLowerCase()}-usd-close`,
    questionEs: `${displayNameEs}: cierre mensual de octubre 2026`,
    questionEn: `${displayNameEn}: October 2026 monthly close`,
    closeIso: PRICE_TRADING_CLOSE_ISO,
    resolveIso: PRICE_RESOLVE_ISO,
    criteriaEs: `${displayNameEs} se resuelve con el precio del feed Chainlink ${configuredFeed.symbol || `${asset}/USD`} a las 15:00 CDMX del 30 de octubre de 2026. Si cae exactamente en un limite, gana el bucket superior.`,
  }));
  return specs;
}

function manualMarkets(env = process.env) {
  const specs = [];

  specs.push(buildManualSpec({
    key: 'cdmx-seismic-alert',
    questionEs: '¿Se activa la alerta sismica en CDMX durante octubre 2026?',
    questionEn: 'Will the seismic alert be activated in Mexico City during October 2026?',
    category: 'mexico',
    tags: { categoryTags: ['mexico', 'infraestructura'], geoTags: ['mexico'], topicTags: ['infraestructura'] },
    icon: 'CDMX',
    outcomesEs: ['Sí', 'No'],
    outcomesEn: ['Yes', 'No'],
    closeIso: TOURNAMENT_END_ISO,
    resolveIso: TOURNAMENT_END_ISO,
    criteriaEs: 'Gana Sí si la fuente oficial definida para el mercado de septiembre registra activacion de la alerta sismica en CDMX durante octubre 2026. Si no hay activacion oficial al 31 de octubre 23:59 CDMX, gana No.',
    criteriaEn: 'Yes wins if the official source used for the September market records a Mexico City seismic-alert activation during October 2026. If no official activation exists by October 31 at 23:59 Mexico City time, No wins.',
    evidence: [],
    extraSourceData: {
      pendingSetup: 'Confirmar la misma fuente oficial usada para el mercado de septiembre antes de aprobar.',
    },
  }));

  specs.push(buildManualSpec({
    key: 'street-fighter-rotten-tomatoes',
    questionEs: 'Street Fighter: Tomatometer en Rotten Tomatoes el 19 de octubre',
    questionEn: 'Street Fighter: Rotten Tomatoes Tomatometer on October 19',
    category: 'musica',
    tags: { categoryTags: ['musica'], geoTags: ['world'], topicTags: ['cine'] },
    icon: 'RT',
    outcomesEs: [
      '45 o menos',
      '46 a 50',
      '51 a 55',
      '56 a 60',
      '61 a 65',
      '66 a 70',
      '71 a 75',
      '76 a 80',
      '81 a 85',
      '86 a 90',
      '91 o más',
    ],
    outcomesEn: [
      '45 or lower',
      '46 to 50',
      '51 to 55',
      '56 to 60',
      '61 to 65',
      '66 to 70',
      '71 to 75',
      '76 to 80',
      '81 to 85',
      '86 to 90',
      '91 or higher',
    ],
    closeIso: STREET_FIGHTER_CLOSE_ISO,
    resolveIso: STREET_FIGHTER_RESOLVE_ISO,
    criteriaEs: 'Se toma el Tomatometer visible en Rotten Tomatoes a las 08:00 CDMX del 19 de octubre de 2026. Si no hay score publicado a esa hora, requiere anulacion o regla admin antes de aprobar.',
    criteriaEn: 'Use the Tomatometer visible on Rotten Tomatoes at 08:00 Mexico City time on October 19, 2026. If no score is published at that time, cancellation or an admin rule must be decided before approval.',
    evidence: [{ title: 'Rotten Tomatoes', url: env.OCTOBER_STREET_FIGHTER_RT_URL || EVIDENCE.rottenTomatoes }],
    extraSourceData: {
      snapshotAt: STREET_FIGHTER_RESOLVE_ISO,
      pendingSetup: 'Confirmar URL canonica de Rotten Tomatoes antes de aprobar.',
    },
  }));

  specs.push(buildManualSpec({
    key: 'fed-october-decision',
    questionEs: 'Fed: decision del 28 de octubre de 2026',
    questionEn: 'Fed: October 28, 2026 decision',
    category: 'finanzas',
    tags: { categoryTags: ['finanzas'], geoTags: ['world'], topicTags: ['finanzas'] },
    icon: 'Fed',
    outcomesEs: ['Recorta', 'Mantiene', 'Sube'],
    outcomesEn: ['Cut', 'Hold', 'Hike'],
    closeIso: FED_CLOSE_ISO,
    resolveIso: FED_RESOLVE_ISO,
    criteriaEs: 'Se resuelve con el comunicado FOMC publicado el 28 de octubre de 2026 a las 14:00 ET. Recorta si el rango objetivo baja, Mantiene si no cambia, Sube si aumenta.',
    criteriaEn: 'Resolve from the FOMC statement released on October 28, 2026 at 2:00 p.m. ET. Cut wins if the target range moves lower, Hold wins if unchanged, Hike wins if higher.',
    evidence: [{ title: 'Federal Reserve October 2026 calendar', url: EVIDENCE.fedCalendar }],
  }));

  specs.push(buildManualSpec({
    key: 'mexico-gdp-q3-yoy',
    questionEs: 'PIB Mexico Q3 2026: variacion anual de la estimacion oportuna',
    questionEn: 'Mexico Q3 2026 GDP: annual change in the flash estimate',
    category: 'finanzas',
    tags: { categoryTags: ['finanzas', 'mexico'], geoTags: ['mexico'], topicTags: ['finanzas'] },
    icon: 'INEGI',
    outcomesEs: ['< 0.5%', '0.5% a 1.0%', '1.0% a 1.5%', '1.5% a 2.0%', '2.0% a 2.5%', '2.5% a 3.0%', '3.0% a 3.5%', '3.5% o más'],
    outcomesEn: ['< 0.5%', '0.5% to 1.0%', '1.0% to 1.5%', '1.5% to 2.0%', '2.0% to 2.5%', '2.5% to 3.0%', '3.0% to 3.5%', '3.5% or higher'],
    closeIso: GDP_CLOSE_ISO,
    resolveIso: GDP_RESOLVE_ISO,
    criteriaEs: 'Solo cuenta el dato inicial de la Estimacion Oportuna del PIB Trimestral para Q3 2026, variacion anual. Revisiones posteriores no cuentan. Si el dato cae exactamente en un limite, gana el bucket superior.',
    criteriaEn: 'Only the initial Q3 2026 flash GDP estimate, annual change, counts. Later revisions do not count. If the value lands exactly on a boundary, the upper bucket wins.',
    evidence: [{ title: 'INEGI feeds', url: EVIDENCE.inegiFeeds }],
  }));

  const tortillaOutcomesEs = [
    'Menos de $23.00 MXN/kg',
    '$23.00 a $24.00 MXN/kg',
    '$24.00 a $25.00 MXN/kg',
    '$25.00 a $26.00 MXN/kg',
    '$26.00 a $27.00 MXN/kg',
    '$27.00 MXN/kg o más',
  ];
  const tortillaOutcomesEn = [
    'Under $23.00 MXN/kg',
    '$23.00 to $24.00 MXN/kg',
    '$24.00 to $25.00 MXN/kg',
    '$25.00 to $26.00 MXN/kg',
    '$26.00 to $27.00 MXN/kg',
    '$27.00 MXN/kg or higher',
  ];
  specs.push(buildManualSpec({
    key: 'tortilla-national-tortilleria-close',
    questionEs: 'Tortilla de maíz: precio nacional en tortillería al cierre de octubre 2026',
    questionEn: 'Corn tortilla: national tortilleria price at October 2026 close',
    category: 'mexico',
    tags: { categoryTags: ['mexico', 'finanzas'], geoTags: ['mexico'], topicTags: ['alimentos', 'commodities'] },
    icon: 'SNIIM',
    outcomesEs: tortillaOutcomesEs,
    outcomesEn: tortillaOutcomesEn,
    closeIso: TOURNAMENT_END_ISO,
    resolveIso: FOOD_PRICE_RESOLVE_ISO,
    criteriaEs: 'Se resuelve con el precio nacional de tortilla en tortillerías publicado por SNIIM, usando el último dato oficial publicado en día hábil hasta el 31 de octubre de 2026. No cuenta autoservicio. Si el dato cae exactamente en un límite, gana el bucket superior.',
    criteriaEn: 'Resolve from the national tortilleria corn-tortilla price published by SNIIM, using the latest official business-day datapoint published through October 31, 2026. Supermarket prices do not count. If the value lands exactly on a boundary, the upper bucket wins.',
    evidence: [{ title: 'SNIIM tortilla prices', url: EVIDENCE.sniimTortilla }],
    kind: 'october_tournament_food_price',
    extraSourceData: {
      commodity: 'tortilla',
      unit: 'MXN/kg',
      sourceTitle: 'SNIIM tortilla nacional en tortillería',
      bucketTieRule: 'upper_bucket',
      buckets: bucketMetadata(tortillaOutcomesEs, tortillaOutcomesEn, [
        { min: null, max: 23 },
        { min: 23, max: 24 },
        { min: 24, max: 25 },
        { min: 25, max: 26 },
        { min: 26, max: 27 },
        { min: 27, max: null },
      ]),
    },
  }));

  const avocadoOutcomesEs = [
    'Menos de $35 MXN/kg',
    '$35 a $45 MXN/kg',
    '$45 a $55 MXN/kg',
    '$55 a $65 MXN/kg',
    '$65 a $75 MXN/kg',
    '$75 MXN/kg o más',
  ];
  const avocadoOutcomesEn = [
    'Under $35 MXN/kg',
    '$35 to $45 MXN/kg',
    '$45 to $55 MXN/kg',
    '$55 to $65 MXN/kg',
    '$65 to $75 MXN/kg',
    '$75 MXN/kg or higher',
  ];
  specs.push(buildManualSpec({
    key: 'avocado-hass-cdmx-wholesale-close',
    questionEs: 'Aguacate Hass: precio mayoreo CDMX al cierre de octubre 2026',
    questionEn: 'Hass avocado: Mexico City wholesale price at October 2026 close',
    category: 'mexico',
    tags: { categoryTags: ['mexico', 'finanzas'], geoTags: ['mexico', 'cdmx'], topicTags: ['alimentos', 'commodities'] },
    icon: 'SNIIM',
    outcomesEs: avocadoOutcomesEs,
    outcomesEn: avocadoOutcomesEn,
    closeIso: TOURNAMENT_END_ISO,
    resolveIso: FOOD_PRICE_RESOLVE_ISO,
    criteriaEs: 'Se resuelve con el precio mayoreo de Aguacate Hass en SNIIM para Central de Abasto CDMX, usando el último dato oficial publicado hasta el 31 de octubre de 2026. Si SNIIM muestra mínimo y máximo sin precio medio, se usa el punto medio aritmético. Si el dato cae exactamente en un límite, gana el bucket superior.',
    criteriaEn: 'Resolve from the SNIIM wholesale Hass avocado price for Mexico City Central de Abasto, using the latest official datapoint published through October 31, 2026. If SNIIM shows only min/max prices, use their arithmetic midpoint. If the value lands exactly on a boundary, the upper bucket wins.',
    evidence: [{ title: 'SNIIM national market prices', url: EVIDENCE.sniimNationalMarkets }],
    kind: 'october_tournament_food_price',
    extraSourceData: {
      commodity: 'aguacate_hass',
      unit: 'MXN/kg',
      market: 'Central de Abasto CDMX',
      sourceTitle: 'SNIIM Aguacate Hass',
      bucketTieRule: 'upper_bucket',
      buckets: bucketMetadata(avocadoOutcomesEs, avocadoOutcomesEn, [
        { min: null, max: 35 },
        { min: 35, max: 45 },
        { min: 45, max: 55 },
        { min: 55, max: 65 },
        { min: 65, max: 75 },
        { min: 75, max: null },
      ]),
    },
  }));

  const whiteCornOutcomesEs = [
    'Menos de $5,000 MXN/t',
    '$5,000 a $5,500 MXN/t',
    '$5,500 a $6,000 MXN/t',
    '$6,000 a $6,500 MXN/t',
    '$6,500 a $7,000 MXN/t',
    '$7,000 MXN/t o más',
  ];
  const whiteCornOutcomesEn = [
    'Under $5,000 MXN/t',
    '$5,000 to $5,500 MXN/t',
    '$5,500 to $6,000 MXN/t',
    '$6,000 to $6,500 MXN/t',
    '$6,500 to $7,000 MXN/t',
    '$7,000 MXN/t or higher',
  ];
  specs.push(buildManualSpec({
    key: 'white-corn-wholesale-close',
    questionEs: 'Maíz blanco: precio mayoreo al cierre de octubre 2026',
    questionEn: 'White corn: wholesale price at October 2026 close',
    category: 'mexico',
    tags: { categoryTags: ['mexico', 'finanzas'], geoTags: ['mexico'], topicTags: ['alimentos', 'commodities'] },
    icon: 'SIAP',
    outcomesEs: whiteCornOutcomesEs,
    outcomesEn: whiteCornOutcomesEn,
    closeIso: TOURNAMENT_END_ISO,
    resolveIso: FOOD_PRICE_RESOLVE_ISO,
    criteriaEs: 'Se resuelve con el precio mayoreo de maíz blanco publicado por SNIIM para el último día hábil disponible hasta el 31 de octubre de 2026. Si SNIIM no tiene dato utilizable, se usa la publicación oficial SIAP/SADER más reciente disponible para maíz blanco y se documenta la fuente en la resolución. Si el dato cae exactamente en un límite, gana el bucket superior.',
    criteriaEn: 'Resolve from the SNIIM wholesale white-corn price for the latest available business day through October 31, 2026. If SNIIM has no usable datapoint, use the latest official SIAP/SADER white-corn publication and document the source in the resolution. If the value lands exactly on a boundary, the upper bucket wins.',
    evidence: [
      { title: 'SNIIM national market prices', url: EVIDENCE.sniimNationalMarkets },
      { title: 'SIAP white corn balance', url: EVIDENCE.siapWhiteCorn },
    ],
    kind: 'october_tournament_food_price',
    extraSourceData: {
      commodity: 'maiz_blanco',
      unit: 'MXN/t',
      sourceTitle: 'SNIIM/SIAP Maiz blanco',
      bucketTieRule: 'upper_bucket',
      buckets: bucketMetadata(whiteCornOutcomesEs, whiteCornOutcomesEn, [
        { min: null, max: 5000 },
        { min: 5000, max: 5500 },
        { min: 5500, max: 6000 },
        { min: 6000, max: 6500 },
        { min: 6500, max: 7000 },
        { min: 7000, max: null },
      ]),
    },
  }));

  const nobel = candidateOutcomes(
    env,
    'OCTOBER_NOBEL_PEACE_CANDIDATES',
    DEFAULT_NOBEL_PEACE_CANDIDATES_ES,
    DEFAULT_NOBEL_PEACE_CANDIDATES_EN,
  );
  if (nobel) {
    specs.push(buildManualSpec({
      key: 'nobel-peace-prize',
      questionEs: '¿Quién gana el Nobel de la Paz 2026?',
      questionEn: 'Who wins the 2026 Nobel Peace Prize?',
      category: 'politica',
      tags: { categoryTags: ['politica'], geoTags: ['world'], topicTags: ['politica'] },
      icon: 'Nobel',
      outcomesEs: nobel.es,
      outcomesEn: nobel.en,
      closeIso: NOBEL_CLOSE_ISO,
      resolveIso: NOBEL_RESOLVE_ISO,
      criteriaEs: 'Se resuelve con el anuncio oficial del Comite Nobel noruego. Si el premio es compartido, gana cualquier opcion incluida entre los laureados. Si gana alguien fuera de la lista o se declara desierto, gana Otro.',
      criteriaEn: 'Resolve from the official Norwegian Nobel Committee announcement. If the prize is shared, any listed laureate wins. If the winner is outside the list or no prize is awarded, Other wins.',
      evidence: [
        { title: 'Nobel Peace Prize 2026 announcement', url: EVIDENCE.nobelPeaceAnnouncement },
        { title: 'Nobel Prize announcement dates', url: EVIDENCE.nobelDates },
        { title: 'PRIO Director updated 2026 list', url: EVIDENCE.prioNobelUpdatedList },
      ],
      kind: 'award',
      extraSourceData: {
        awardLabel: 'Nobel de la Paz 2026',
        candidateSource: 'PRIO Director updated 2026 public list. Official Nobel nominations are not public.',
      },
    }));
  } else {
    console.warn('[market-gen/october-2026] OCTOBER_NOBEL_PEACE_CANDIDATES not configured; skipping Nobel market');
  }

  const ballonDor = candidateOutcomes(
    env,
    'OCTOBER_BALLON_DOR_CANDIDATES',
    DEFAULT_BALLON_DOR_CANDIDATES,
    DEFAULT_BALLON_DOR_CANDIDATES,
  );
  if (ballonDor) {
    specs.push(buildManualSpec({
      key: 'ballon-dor-men',
      questionEs: '¿Quién gana el Balón de Oro masculino 2026?',
      questionEn: 'Who wins the 2026 men’s Ballon d’Or?',
      category: 'deportes',
      tags: { categoryTags: ['deportes'], geoTags: ['world'], topicTags: ['deportes'] },
      icon: 'Ballon',
      outcomesEs: ballonDor.es,
      outcomesEn: ballonDor.en,
      closeIso: BALLON_DOR_CLOSE_ISO,
      resolveIso: dateAtMexicoCityTime({ year: 2026, month: 10, day: 26, hour: 23, minute: 59 }).toISOString(),
      criteriaEs: 'Se resuelve con el ganador del Balon de Oro masculino 2026 anunciado por France Football/Ballon d’Or. Si gana alguien fuera de la lista, gana Otro.',
      criteriaEn: 'Resolve from the 2026 men’s Ballon d’Or winner announced by France Football/Ballon d’Or. If the winner is outside the list, Other wins.',
      evidence: [
        { title: 'Ballon d’Or official information', url: EVIDENCE.ballonDor },
        { title: 'UEFA 2026 Ballon d’Or nominees', url: EVIDENCE.ballonDorNominees },
      ],
      kind: 'award',
      extraSourceData: {
        awardLabel: 'Balon de Oro masculino 2026',
        candidateSource: 'UEFA published nominee list; default market uses six high-salience nominees plus Otro.',
        pendingSetup: 'Confirmar hora de ceremonia antes de aprobar.',
      },
    }));
  } else {
    console.warn('[market-gen/october-2026] OCTOBER_BALLON_DOR_CANDIDATES not configured; skipping Ballon d’Or market');
  }

  return specs;
}

function hurricaneMarket() {
  const criteriaEs = 'Gana Sí si NOAA IBTrACS registra que el centro de un huracán categoría 4 o 5 toca tierra dentro de México entre el 1 de octubre 00:00 CDMX y el 31 de octubre 23:59 CDMX. No cuenta solo acercarse a la costa ni tocar tierra fuera de México. Si no hay un evento oficial que cumpla esos criterios, gana No.';
  const criteriaEn = 'Yes wins if NOAA IBTrACS records the center of a Category 4 or 5 hurricane making landfall inside Mexico between October 1 00:00 Mexico City time and October 31 23:59 Mexico City time. A close coastal approach or landfall outside Mexico does not count. If no official event meets those criteria, No wins.';
  return buildAutoBinarySpec({
    key: 'mexico-major-hurricane-landfall',
    questionEs: '¿Un huracán categoría 4 o 5 tocará tierra en México durante octubre 2026?',
    questionEn: 'Will a Category 4 or 5 hurricane make landfall in Mexico during October 2026?',
    category: 'mexico',
    tags: { categoryTags: ['mexico', 'clima'], geoTags: ['mexico'], topicTags: ['clima'] },
    icon: 'NOAA',
    outcomesEs: ['Sí', 'No'],
    outcomesEn: ['Yes', 'No'],
    closeIso: TOURNAMENT_END_ISO,
    resolverType: 'api_hurricane',
    resolverConfig: {
      source: 'noaa-ibtracs',
      shape: 'mexico-major-hurricane-landfall',
      startIso: START_ISO,
      endIso: TOURNAMENT_END_ISO,
      resolveAt: HURRICANE_RESOLVE_ISO,
      minCategory: 4,
      yesOutcome: 0,
      noOutcome: 1,
      sourceUrl: 'https://erddap.aoml.noaa.gov/hdb/erddap/tabledap/IBTRACS_last3years.csv',
    },
    criteriaEs,
    criteriaEn,
    evidence: [{ title: 'NOAA IBTrACS', url: EVIDENCE.ibtracs }],
    kind: 'october_tournament_hurricane',
    touchMarket: true,
    extraSourceData: {
      sourceTitle: 'NOAA IBTrACS',
      closesAt: TOURNAMENT_END_ISO,
      resolvesAt: HURRICANE_RESOLVE_ISO,
    },
  });
}

export async function generateOctoberTournament2026Markets({ env = process.env, now = new Date() } = {}) {
  const specs = [];
  specs.push(...await usdMxnSpec());
  specs.push(...await premiumGasolineSpec());
  specs.push(...await chainlinkBucketSpec({
    asset: 'BTC',
    feed: FEEDS_ARBITRUM_ONE.BTC_USD,
    step: 5000,
    decimals: 0,
    env,
  }));
  specs.push(...await chainlinkBucketSpec({
    asset: 'ETH',
    feed: FEEDS_ARBITRUM_ONE.ETH_USD,
    step: 500,
    decimals: 0,
    env,
  }));
  specs.push(...await commodityChainlinkSpecs({
    asset: 'XAU',
    displayNameEs: 'Oro (XAU/USD)',
    displayNameEn: 'Gold (XAU/USD)',
    step: 100,
    decimals: 0,
    envKey: 'CHAINLINK_XAU_USD',
    env,
    now,
  }));
  specs.push(...await commodityChainlinkSpecs({
    asset: 'WTI',
    displayNameEs: 'Petróleo WTI (WTI/USD)',
    displayNameEn: 'WTI oil (WTI/USD)',
    step: 5,
    decimals: 0,
    envKey: 'CHAINLINK_WTI_USD',
    env,
    now,
    defaultChainId: 56,
  }));
  specs.push(hurricaneMarket());
  specs.push(...manualMarkets(env));
  return specs;
}

export const _internal = {
  DEFAULT_BALLON_DOR_CANDIDATES,
  DEFAULT_NOBEL_PEACE_CANDIDATES_EN,
  DEFAULT_NOBEL_PEACE_CANDIDATES_ES,
  buildPriceBuckets,
  candidateOutcomes,
  hurricaneMarket,
  manualMarkets,
  weeklyCommodityWindow,
};
