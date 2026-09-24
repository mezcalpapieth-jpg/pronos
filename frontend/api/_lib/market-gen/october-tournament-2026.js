import { readChainlinkPrice, FEEDS_ARBITRUM_ONE } from '../chainlink.js';
import { BANXICO_FIX_RESOLUTION_CRITERIA, readBanxicoLatest, SERIES } from '../banxico.js';
import { readCreAverages, fuelLabel } from '../fuel.js';
import { attachSuggestedPricing } from '../market-pricing.js';
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

const EVIDENCE = Object.freeze({
  banxicoFix: 'https://www.banxico.org.mx/tipcamb/main.do?page=tip&idioma=sp',
  crePrices: 'https://publicacionexterna.azurewebsites.net/publicaciones/prices',
  chainlinkFeeds: 'https://docs.chain.link/data-feeds/price-feeds/addresses',
  chainlinkXau: 'https://data.chain.link/feeds/arbitrum/mainnet/xau-usd',
  nobelDates: 'https://www.nobelprize.org/prizes/about/prize-announcement-dates/',
  rottenTomatoes: 'https://www.rottentomatoes.com/',
  ballonDor: 'https://www.uefa.com/ballondor/',
  fedCalendar: 'https://www.federalreserve.gov/newsevents/2026-october.htm',
  inegiFeeds: 'https://www.inegi.org.mx/servicios/feedsnoticias/feeds.html',
});

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
  return attachSuggestedPricing(spec, {
    probabilities: probabilities || Array.from({ length: spec.outcomes.length }, () => 1 / spec.outcomes.length),
    source: 'cofounder-brief',
    rationale: 'Mercado preparado para el torneo octubre 2026; revisar en admin antes de aprobar.',
    evidence: spec.source_data?.evidence || [],
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

function csvList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function candidateOutcomes(env, key) {
  const es = csvList(env[`${key}_ES`] || env[key]);
  const enRaw = csvList(env[`${key}_EN`] || env[key]);
  if (es.length < 6) return null;
  const en = enRaw.length >= 6 ? enRaw : es;
  return {
    es: [...es.slice(0, 6), 'Otro'],
    en: [...en.slice(0, 6), 'Other'],
  };
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

async function chainlinkBucketSpec({ asset, feed, step, decimals, envKey, env = process.env }) {
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
  const criteria = `${asset} se resuelve con el precio del feed Chainlink ${configuredFeed.symbol || `${asset}/USD`} a las 15:00 CDMX del 30 de octubre de 2026. Si cae exactamente en un limite, gana el bucket superior.`;
  return [buildPriceBucketSpec({
    key: `${asset.toLowerCase()}-usd-close`,
    questionEs: `${asset} cierre de octubre 2026`,
    questionEn: `${asset} October 2026 close`,
    category: asset === 'BTC' || asset === 'ETH' ? 'crypto' : 'finanzas',
    tags: {
      categoryTags: [asset === 'BTC' || asset === 'ETH' ? 'crypto' : 'finanzas'],
      geoTags: ['world'],
      topicTags: [asset === 'BTC' || asset === 'ETH' ? 'crypto' : 'finanzas'],
    },
    icon: asset,
    outcomesEs,
    outcomesEn,
    buckets,
    endTime: PRICE_TRADING_CLOSE_ISO,
    resolverType: 'chainlink_price',
    resolverConfig: {
      source: 'chainlink',
      feedAddress: configuredFeed.feedAddress,
      chainId: configuredFeed.chainId,
      symbol: configuredFeed.symbol || `${asset}/USD`,
      closesAt: PRICE_RESOLVE_ISO,
      resolveAt: PRICE_RESOLVE_ISO,
    },
    resolutionCriteria: criteria,
    evidence: [{
      title: asset === 'XAU' ? 'Chainlink XAU/USD' : 'Chainlink price feeds',
      url: asset === 'XAU' ? EVIDENCE.chainlinkXau : EVIDENCE.chainlinkFeeds,
    }],
    extraSourceData: {
      asset,
      spotAtGeneration: spot,
      feed: configuredFeed.feedAddress,
      chainId: configuredFeed.chainId,
      closesAt: PRICE_TRADING_CLOSE_ISO,
      resolvesAt: PRICE_RESOLVE_ISO,
    },
  })];
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

  const nobel = candidateOutcomes(env, 'OCTOBER_NOBEL_PEACE_CANDIDATES');
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
      evidence: [{ title: 'Nobel Prize announcement dates', url: EVIDENCE.nobelDates }],
      kind: 'award',
      extraSourceData: { awardLabel: 'Nobel de la Paz 2026' },
    }));
  } else {
    console.warn('[market-gen/october-2026] OCTOBER_NOBEL_PEACE_CANDIDATES not configured; skipping Nobel market');
  }

  const ballonDor = candidateOutcomes(env, 'OCTOBER_BALLON_DOR_CANDIDATES');
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
      evidence: [{ title: 'Ballon d’Or official information', url: EVIDENCE.ballonDor }],
      kind: 'award',
      extraSourceData: {
        awardLabel: 'Balon de Oro masculino 2026',
        pendingSetup: 'Confirmar hora de ceremonia antes de aprobar.',
      },
    }));
  } else {
    console.warn('[market-gen/october-2026] OCTOBER_BALLON_DOR_CANDIDATES not configured; skipping Ballon d’Or market');
  }

  return specs;
}

export async function generateOctoberTournament2026Markets({ env = process.env } = {}) {
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
  specs.push(...await chainlinkBucketSpec({
    asset: 'XAU',
    step: 100,
    decimals: 0,
    envKey: 'CHAINLINK_XAU_USD',
    env,
  }));
  specs.push(...await chainlinkBucketSpec({
    asset: 'WTI',
    step: 5,
    decimals: 0,
    envKey: 'CHAINLINK_WTI_USD',
    env,
  }));
  specs.push(...manualMarkets(env));
  return specs;
}

export const _internal = {
  buildPriceBuckets,
  candidateOutcomes,
  manualMarkets,
};
