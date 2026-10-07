import { MANANERA_OFFICIAL_BASE_URL, MANANERA_TRANSCRIPT_SOURCE } from '../mananera.js';
import { attachSuggestedPricing } from '../market-pricing.js';
import { MEXICO_CITY_TZ, dateAtMexicoCityTime, formatMexicoDateEs, formatMexicoDateYmd } from './mexico-time.js';

const WEEKDAYS = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const TOPICS = [
  {
    slug: 'estados-unidos',
    phrase: 'Estados Unidos',
    threshold: 1,
    probability: 0.62,
    label: '"Estados Unidos"',
    rationale: 'Tema recurrente de agenda bilateral; apertura ligeramente cargada hacia Sí.',
  },
  {
    slug: 'seguridad-5',
    phrase: 'seguridad',
    threshold: 5,
    probability: 0.54,
    label: '"seguridad" 5 o más veces',
    rationale: 'La seguridad aparece con frecuencia, pero el umbral evita que una sola mención resuelva el mercado.',
  },
  {
    slug: 'inegi',
    phrase: 'INEGI',
    threshold: 1,
    probability: 0.36,
    label: '"INEGI"',
    rationale: 'INEGI depende más de días con datos económicos publicados o discusión de indicadores.',
  },
  {
    slug: 'inflacion',
    phrase: 'inflación',
    threshold: 1,
    probability: 0.42,
    label: '"inflación"',
    rationale: 'Inflación puede aparecer cuando hay datos de precios o consumo, pero no es tema diario.',
  },
  {
    slug: 'aranceles',
    phrase: 'aranceles',
    threshold: 1,
    probability: 0.34,
    label: '"aranceles"',
    rationale: 'Aranceles suele depender de una coyuntura comercial concreta.',
  },
];

const WEEKLY_TEMPLATE_TOPIC = {
  slug: 'tema-editable-semanal',
  phrase: 'seguridad',
  threshold: 1,
  probability: 0.66,
  label: '"seguridad"',
  topicLabel: 'tema editable',
  rationale: 'Plantilla semanal editable antes de aprobar: cambiar phrase, question y criteria al tema elegido.',
};

function partsObject(formatter, date) {
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
}

function mexicoDateTimeParts(date) {
  const parts = partsObject(new Intl.DateTimeFormat('en-US', {
    timeZone: MEXICO_CITY_TZ,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }), date);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS[parts.weekday],
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function addDaysToDateParts({ year, month, day }, days) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function nextMananeraClose(now = new Date()) {
  const local = mexicoDateTimeParts(now);
  const afterTodaysClose = (local.hour * 60 + local.minute) >= ((7 * 60) + 59);

  for (let days = afterTodaysClose ? 1 : 0; days <= 10; days += 1) {
    const target = addDaysToDateParts(local, days);
    const weekday = new Date(Date.UTC(target.year, target.month - 1, target.day, 12, 0, 0, 0)).getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      return dateAtMexicoCityTime({
        ...target,
        hour: 7,
        minute: 59,
        second: 0,
      });
    }
  }

  throw new Error('could_not_find_next_mananera_close');
}

export function nextMananeraWeek(now = new Date()) {
  const local = mexicoDateTimeParts(now);
  const minutes = local.hour * 60 + local.minute;
  const afterMondayClose = local.weekday === 1 && minutes >= ((7 * 60) + 59);
  let daysAhead = (1 - local.weekday + 7) % 7;
  if (daysAhead === 0 && afterMondayClose) daysAhead = 7;
  if (local.weekday >= 2 && local.weekday <= 6) daysAhead = 8 - local.weekday;

  const monday = addDaysToDateParts(local, daysAhead);
  const friday = addDaysToDateParts(monday, 4);
  const dateYmds = Array.from({ length: 5 }, (_, i) => {
    const day = addDaysToDateParts(monday, i);
    const date = dateAtMexicoCityTime({ ...day, hour: 12, minute: 0, second: 0 });
    return formatMexicoDateYmd(date);
  });

  return {
    start: dateAtMexicoCityTime({ ...monday, hour: 7, minute: 59, second: 0 }),
    resolveAt: dateAtMexicoCityTime({ ...friday, hour: 18, minute: 0, second: 0 }),
    weekStartYmd: formatMexicoDateYmd(dateAtMexicoCityTime({ ...monday, hour: 12, minute: 0, second: 0 })),
    weekEndYmd: formatMexicoDateYmd(dateAtMexicoCityTime({ ...friday, hour: 12, minute: 0, second: 0 })),
    weekStartLabel: formatMexicoDateEs(dateAtMexicoCityTime({ ...monday, hour: 12, minute: 0, second: 0 })),
    weekEndLabel: formatMexicoDateEs(dateAtMexicoCityTime({ ...friday, hour: 12, minute: 0, second: 0 })),
    dateYmds,
  };
}

function criteriaFor(topic, dateLabel) {
  const mentions = topic.threshold === 1
    ? `contiene ${topic.label} al menos una vez`
    : `contiene la frase "${topic.phrase}" ${topic.threshold} o más veces`;
  return `la versión estenográfica oficial de gob.mx de la mañanera del ${dateLabel} ${mentions}; si gob.mx no está disponible, se usará la transcripción/captions del video oficial de YouTube de la conferencia de prensa matutina de ese día`;
}

function buildSpec(topic, end) {
  const dateYmd = formatMexicoDateYmd(end);
  const dateLabel = formatMexicoDateEs(end);
  const question = topic.threshold === 1
    ? `¿La presidenta mencionará ${topic.label} en la mañanera del ${dateLabel}?`
    : `¿La presidenta dirá "${topic.phrase}" ${topic.threshold} o más veces en la mañanera del ${dateLabel}?`;

  const base = {
    source: 'mananera',
    source_event_id: `mananera:${dateYmd}:${topic.slug}`,
    question,
    category: 'mexico',
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1000,
    end_time: end.toISOString(),
    amm_mode: 'unified',
    resolver_type: 'api_transcript',
    resolver_config: {
      source: MANANERA_TRANSCRIPT_SOURCE,
      dateYmd,
      timezone: MEXICO_CITY_TZ,
      phrase: topic.phrase,
      op: 'gte',
      threshold: topic.threshold,
      yesOutcome: 0,
      evidenceUrl: MANANERA_OFFICIAL_BASE_URL,
      youtubeFallback: true,
      sourceUrls: [MANANERA_OFFICIAL_BASE_URL, 'https://www.youtube.com/'],
      criteria: criteriaFor(topic, dateLabel),
    },
    source_data: {
      kind: 'mananera_phrase',
      generatedAt: new Date().toISOString(),
      dateYmd,
      dateLabel,
      phrase: topic.phrase,
      threshold: topic.threshold,
      closeLocalTime: '07:59',
      transcriptSource: 'gob.mx Presidencia; fallback YouTube oficial',
      categorization: {
        categoryTags: ['mexico'],
        geoTags: ['mexico'],
        topicTags: ['politica'],
      },
    },
  };

  return attachSuggestedPricing(base, {
    probabilities: [topic.probability, 1 - topic.probability],
    source: 'editorial-prior',
    rationale: topic.rationale,
    evidence: [{ title: 'Presidencia de la República', url: MANANERA_OFFICIAL_BASE_URL }],
  });
}

function weeklyCriteriaFor(topic, week) {
  const mentions = topic.threshold === 1
    ? `contienen ${topic.label} al menos una vez en total`
    : `contienen la frase "${topic.phrase}" ${topic.threshold} o más veces en total`;
  return `las versiones estenográficas oficiales de gob.mx de las mañaneras de la semana del ${week.weekStartLabel} al ${week.weekEndLabel} ${mentions}; si gob.mx no está disponible para algún día, se usará la transcripción/captions del video oficial de YouTube de la conferencia de prensa matutina de ese día`;
}

function buildWeeklyTemplateSpec(now = new Date()) {
  const topic = WEEKLY_TEMPLATE_TOPIC;
  const week = nextMananeraWeek(now);
  const question = `¿La presidenta mencionará ${topic.topicLabel} en alguna mañanera de la semana del ${week.weekStartLabel}?`;
  const criteria = weeklyCriteriaFor(topic, week);

  const base = {
    source: 'mananera',
    source_event_id: `mananera-weekly:${week.weekStartYmd}:${topic.slug}`,
    question,
    category: 'mexico',
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1000,
    end_time: week.start.toISOString(),
    amm_mode: 'unified',
    resolver_type: 'api_transcript',
    resolver_config: {
      source: MANANERA_TRANSCRIPT_SOURCE,
      dateYmds: week.dateYmds,
      fromDateYmd: week.weekStartYmd,
      toDateYmd: week.weekEndYmd,
      timezone: MEXICO_CITY_TZ,
      phrase: topic.phrase,
      op: 'gte',
      threshold: topic.threshold,
      yesOutcome: 0,
      resolveAt: week.resolveAt.toISOString(),
      evidenceUrl: MANANERA_OFFICIAL_BASE_URL,
      youtubeFallback: true,
      sourceUrls: [MANANERA_OFFICIAL_BASE_URL, 'https://www.youtube.com/'],
      criteria,
    },
    source_data: {
      kind: 'mananera_weekly_phrase',
      generatedAt: new Date().toISOString(),
      weekStartYmd: week.weekStartYmd,
      weekEndYmd: week.weekEndYmd,
      dateYmds: week.dateYmds,
      phrase: topic.phrase,
      threshold: topic.threshold,
      editableTemplate: true,
      approvalEditHints: {
        fields: [
          'question',
          'resolver_config.phrase',
          'resolver_config.threshold',
          'resolver_config.criteria',
          'source_data.phrase',
          'source_data.topicLabel',
        ],
        note: 'Cambiar el tema/frase antes de aprobar; el resolver suma menciones en todas las mañaneras de la semana.',
      },
      topicLabel: topic.topicLabel,
      closeLocalTime: 'lunes 07:59',
      transcriptSource: 'gob.mx Presidencia; fallback YouTube oficial por día',
      resolutionCriteria: criteria,
      categorization: {
        categoryTags: ['mexico'],
        geoTags: ['mexico'],
        topicTags: ['politica'],
      },
    },
  };

  return attachSuggestedPricing(base, {
    probabilities: [topic.probability, 1 - topic.probability],
    source: 'editorial-prior',
    rationale: topic.rationale,
    evidence: [{ title: 'Presidencia de la República', url: MANANERA_OFFICIAL_BASE_URL }],
  });
}

export async function generateMananeraMarkets({ now = new Date() } = {}) {
  const end = nextMananeraClose(now);
  return [
    ...TOPICS.map(topic => buildSpec(topic, end)),
    buildWeeklyTemplateSpec(now),
  ];
}

export const _internal = {
  WEEKLY_TEMPLATE_TOPIC,
  buildWeeklyTemplateSpec,
  weeklyCriteriaFor,
};
