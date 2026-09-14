function cleanString(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || '';
}

function normalizeOutcomes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (item && typeof item === 'object') {
        return cleanString(item.label || item.name || item.title || item.value);
      }
      return cleanString(item);
    })
    .filter(Boolean);
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstString(...values) {
  for (const value of values) {
    const text = cleanString(value);
    if (text) return text;
  }
  return '';
}

function stripQuestionMarks(value) {
  return cleanString(value)
    .replace(/^¿\s*/, '')
    .replace(/\?\s*$/, '')
    .trim();
}

const ES_TO_EN_LABELS = new Map([
  ['Sí', 'Yes'],
  ['Si', 'Yes'],
  ['sí', 'yes'],
  ['si', 'yes'],
  ['No', 'No'],
  ['Empate', 'Draw'],
  ['Otro', 'Other'],
  ['Otra', 'Other'],
  ['Otro actor', 'Other actor'],
  ['Otra actriz', 'Other actress'],
  ['SUBE', 'UP'],
  ['BAJA', 'DOWN'],
]);

const EN_TO_ES_LABELS = new Map([
  ['Yes', 'Sí'],
  ['yes', 'sí'],
  ['No', 'No'],
  ['Draw', 'Empate'],
  ['Other', 'Otro'],
  ['UP', 'SUBE'],
  ['DOWN', 'BAJA'],
]);

function translateSpanishOutcomePhrase(label) {
  const text = cleanString(label);
  const exact = ES_TO_EN_LABELS.get(text);
  if (exact) return exact;

  let match = text.match(/^Menos de\s+(.+)$/i);
  if (match) return `Under ${match[1]}`;

  match = text.match(/^Más de\s+(.+)$/i);
  if (match) return `Over ${match[1]}`;

  match = text.match(/^(.+?)\s+o\s+más$/i);
  if (match) return `${match[1]} or more`;

  match = text.match(/^(.+?)\s+a\s+(.+)$/i);
  if (match) return `${match[1]} to ${match[2]}`;

  match = text.match(/^No anuncian a\s+(.+)$/i);
  if (match) return `No ${match[1]} announcement`;

  return text;
}

function translateEnglishOutcomePhrase(label) {
  const text = cleanString(label);
  const exact = EN_TO_ES_LABELS.get(text);
  if (exact) return exact;
  return text;
}

export function translateOutcomeLabel(label, lang = 'en') {
  if (lang === 'en') return translateSpanishOutcomePhrase(label);
  if (lang === 'es') return translateEnglishOutcomePhrase(label);
  return cleanString(label);
}

function dateLabelFromYmd(ymd) {
  const text = cleanString(ymd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  return text;
}

function translateKnownKind(question, sourceData) {
  const kind = cleanString(sourceData.kind);
  if (kind === 'netflix_top10') {
    const title = firstString(sourceData.title, stripQuestionMarks(question).replace(/\s+(será #1 global en Netflix TV|entra al Top 3 de Netflix México).+$/i, ''));
    return sourceData.scope === 'mx'
      ? `Will ${title} enter the Top 3 on Netflix Mexico this week?`
      : `Will ${title} be #1 globally on Netflix TV this week?`;
  }
  if (kind === 'box_office_weekend') {
    const title = firstString(sourceData.movie, stripQuestionMarks(question).replace(/\s+será #1 en taquilla.+$/i, ''));
    return `Will ${title} be #1 at the U.S. box office this weekend?`;
  }
  if (kind === 'reality_week') {
    const show = firstString(sourceData.showLabel, 'the reality show');
    const season = firstString(sourceData.seasonLabel);
    const week = sourceData.weekNumber == null ? '' : `, week ${sourceData.weekNumber}`;
    const suffix = season ? ` (${season}${week})` : '';
    return `Who leaves ${show} this week?${suffix}`;
  }
  if (kind === 'reality_winner') {
    const show = firstString(sourceData.showLabel, 'the reality show');
    const season = firstString(sourceData.seasonLabel);
    return `Who wins ${show}${season ? ` (${season})` : ''}?`;
  }
  if (kind === 'aicm_delay_window') {
    const threshold = sourceData.thresholdMinutes ?? '';
    const fromDate = dateLabelFromYmd(sourceData.fromDateYmd);
    const toDate = dateLabelFromYmd(sourceData.toDateYmd);
    const range = fromDate && toDate && fromDate !== toDate
      ? `${fromDate} to ${toDate}`
      : fromDate || toDate || 'the target date';
    return `How many AICM departures will be delayed by more than ${threshold} minutes on ${range}?`;
  }
  if (kind === 'award') {
    const category = firstString(sourceData.categoryLabel, stripQuestionMarks(question).split('·')[0]);
    const award = firstString(sourceData.awardLabel, stripQuestionMarks(question).split('·')[1]);
    return [category, award].filter(Boolean).join(' · ') || question;
  }
  if (kind === 'popular_event' && sourceData.englishQuestion) {
    return cleanString(sourceData.englishQuestion);
  }
  return '';
}

function translateByPattern(question, sourceData = {}, spec = {}) {
  const original = cleanString(question);
  const text = stripQuestionMarks(original);
  if (!original) return '';

  // Newer sports generators often use "Away @ Home" or "Home vs Away".
  // These labels are already language-neutral and look better as-is.
  if (!/^¿/.test(original) && /\s(@|vs)\s/i.test(original)) return original;

  let match = text.match(/^(.+?) entra al Top 3 de Netflix México esta semana$/i);
  if (match) return `Will ${match[1]} enter the Top 3 on Netflix Mexico this week?`;

  match = text.match(/^(.+?) será #1 global en Netflix TV esta semana$/i);
  if (match) return `Will ${match[1]} be #1 globally on Netflix TV this week?`;

  match = text.match(/^(.+?) será #1 en taquilla de EE\.UU\. este fin de semana$/i);
  if (match) return `Will ${match[1]} be #1 at the U.S. box office this weekend?`;

  match = text.match(/^Quién sale de (.+?) esta semana\?*\s*\((.+?), semana (\d+)\)$/i);
  if (match) return `Who leaves ${match[1]} this week? (${match[2]}, week ${match[3]})`;

  match = text.match(/^Quién gana (.+?) \((.+?)\)$/i);
  if (match) return `Who wins ${match[1]} (${match[2]})?`;

  match = text.match(/^Quién gana:\s*(.+?)\s+vs\s+(.+?)\s+en el\s+(.+)$/i);
  if (match) return `Who wins: ${match[1]} vs ${match[2]} at ${match[3]}?`;

  match = text.match(/^Quién gana\s+(.+?)\s+@\s+(.+)$/i);
  if (match) return `Who wins ${match[1]} @ ${match[2]}?`;

  match = text.match(/^Quién gana\s+(.+?)\s+vs\s+(.+)$/i);
  if (match) return `Who wins ${match[1]} vs ${match[2]}?`;

  match = text.match(/^Quién gana el Grupo\s+(.+)$/i);
  if (match) return `Who wins Group ${match[1]}?`;

  match = text.match(/^Quién gana el Mundial de Pilotos\s+(.+)$/i);
  if (match) return `Who wins the ${match[1]} Drivers' Championship?`;

  match = text.match(/^Quién gana el Mundial de Constructores\s+(.+)$/i);
  if (match) return `Who wins the ${match[1]} Constructors' Championship?`;

  match = text.match(/^Quién gana el\s+(.+)$/i);
  if (match) return `Who wins the ${match[1]}?`;

  match = text.match(/^Qué equipo gana el\s+(.+)$/i);
  if (match) return `Which team wins the ${match[1]}?`;

  match = text.match(/^La final tendrá más de\s+([0-9.]+)\s+goles$/i);
  if (match) return `Will the final have over ${match[1]} goals?`;

  match = text.match(/^Un delantero gana el MVP de la final$/i);
  if (match) return 'Will a forward win the final MVP?';

  match = text.match(/^Temperatura máxima en\s+(.+?)\s+el\s+(.+)$/i);
  if (match) return `Max temperature in ${match[1]} on ${match[2]}?`;

  match = text.match(/^Cuántas salidas del AICM se retrasarán más de\s+(\d+)\s+minutos el\s+(.+)$/i);
  if (match) return `How many AICM departures will be delayed by more than ${match[1]} minutes on ${match[2]}?`;

  match = text.match(/^(.+?) cerrará por encima de \$([^ ]+) USD el (.+)$/i);
  if (match) return `Will ${match[1]} close above $${match[2]} USD on ${match[3]}?`;

  match = text.match(/^\$(.+?) cerrará arriba de \$([^ ]+) de market cap el (.+)$/i);
  if (match) return `Will $${match[1]} close above $${match[2]} market cap on ${match[3]}?`;

  match = text.match(/^USD\/MXN cierre del viernes > \$([^ ]+)$/i);
  if (match) return `USD/MXN Friday close > $${match[1]}`;

  match = text.match(/^(.+?) cierre del viernes > \$([^ ]+)$/i);
  if (match) return `${match[1]} Friday close > $${match[2]}`;

  match = text.match(/^(.+?) promedio nacional cierre de (.+?) > \$([^ ]+)$/i);
  if (match) return `${match[1]} national average ${match[2]} close > $${match[3]}`;

  match = text.match(/^Qué canal tendrá el video #1 en Tendencias México el (.+)$/i);
  if (match) return `Which channel will have the #1 video on YouTube Trending Mexico on ${match[1]}?`;

  match = text.match(/^Quién tendrá la canción #1 en México este viernes \((.+)\)$/i);
  if (match) return `Who will have the #1 song in Mexico this Friday (${match[1]})?`;

  match = text.match(/^La presidenta mencionará "(.+)" en la mañanera del (.+)$/i);
  if (match) return `Will the president mention "${match[1]}" in the morning press conference on ${match[2]}?`;

  match = text.match(/^La presidenta dirá "(.+)" (\d+) o más veces en la mañanera del (.+)$/i);
  if (match) return `Will the president say "${match[1]}" ${match[2]} or more times in the morning press conference on ${match[3]}?`;

  match = text.match(/^Contra quién pelea (.+?) a continuación$/i);
  if (match) return `Who will ${match[1]} fight next?`;

  match = text.match(/^Quién terminará delante en la carrera del (.+?): (.+?) o (.+)$/i);
  if (match) return `Who will finish ahead in the ${match[1]} race: ${match[2]} or ${match[3]}?`;

  match = text.match(/^(.+?) gana su primera carrera de la temporada en casa$/i);
  if (match) return `Will ${match[1]} win his first race of the season at home?`;

  match = text.match(/^(.+?) suma sus primeros puntos de la temporada en la carrera del (.+)$/i);
  if (match) return `Will ${match[1]} score his first points of the season in the ${match[2]} race?`;

  match = text.match(/^(.+?) se retrasa otra vez antes del (.+)$/i);
  if (match) return `Will ${match[1]} be delayed again before ${match[2]}?`;

  match = text.match(/^(.+?) se retrasa de su estreno del (.+)$/i);
  if (match) return `Will ${match[1]} be delayed from its ${match[2]} release?`;

  match = text.match(/^La Fed sube la tasa en la reunión del (.+)$/i);
  if (match) return `Will the Fed raise rates at the ${match[1]} meeting?`;

  match = text.match(/^(.+?) supera \$2,000MDD de taquilla mundial antes de septiembre$/i);
  if (match) return `Will ${match[1]} pass $2B at the worldwide box office before September?`;

  match = text.match(/^(.+?) renuncia como presidente de FIFA antes de (.+)$/i);
  if (match) return `Will ${match[1]} resign as FIFA president before ${match[2]}?`;

  match = text.match(/^Quién será anunciado como (.+)$/i);
  if (match) return `Who will be announced as ${match[1]}?`;

  if (spec?.sport || spec?.league || sourceData.league) return original;
  return original;
}

export function translateMarketQuestion(question, sourceData = {}, spec = {}) {
  const normalizedSourceData = normalizeObject(sourceData);
  return firstString(
    translateKnownKind(question, normalizedSourceData),
    translateByPattern(question, normalizedSourceData, spec),
    question,
  );
}

function normalizeTranslationBranch(value) {
  const branch = normalizeObject(value);
  const question = cleanString(branch.question || branch.title);
  const outcomes = normalizeOutcomes(branch.outcomes || branch.options);
  return {
    ...(question ? { question } : {}),
    ...(outcomes.length ? { outcomes } : {}),
  };
}

export function buildMarketTranslations(spec = {}) {
  const sourceData = normalizeObject(spec.source_data || spec.sourceData);
  const existing = normalizeObject(sourceData.translations);
  const existingEs = normalizeTranslationBranch(existing.es);
  const existingEn = normalizeTranslationBranch(existing.en);
  const question = cleanString(spec.question || spec.title);
  const outcomes = normalizeOutcomes(spec.outcomes);

  const es = {
    question: existingEs.question || question,
    outcomes: existingEs.outcomes?.length === outcomes.length ? existingEs.outcomes : outcomes,
  };
  const en = {
    question: existingEn.question || translateMarketQuestion(question, sourceData, spec),
    outcomes: existingEn.outcomes?.length === outcomes.length
      ? existingEn.outcomes
      : outcomes.map(label => translateOutcomeLabel(label, 'en')),
  };

  return { es, en };
}

export function attachMarketTranslations(spec = {}) {
  const sourceData = normalizeObject(spec.source_data);
  return {
    ...spec,
    source_data: {
      ...sourceData,
      translations: buildMarketTranslations(spec),
    },
  };
}

function optionObjects(labels) {
  return labels.map(label => ({ label }));
}

export function publicMarketTranslationFields({ question, outcomes, sourceData, source_data: snakeSourceData } = {}) {
  const baseOutcomes = normalizeOutcomes(outcomes);
  const translations = buildMarketTranslations({
    question,
    outcomes: baseOutcomes,
    source_data: sourceData || snakeSourceData || {},
  });
  const title = cleanString(question);
  return {
    title,
    title_es: translations.es.question || title,
    title_en: translations.en.question || title,
    outcomes_es: translations.es.outcomes.length === baseOutcomes.length ? translations.es.outcomes : baseOutcomes,
    outcomes_en: translations.en.outcomes.length === baseOutcomes.length ? translations.en.outcomes : baseOutcomes,
    options_es: optionObjects(translations.es.outcomes.length === baseOutcomes.length ? translations.es.outcomes : baseOutcomes),
    options_en: optionObjects(translations.en.outcomes.length === baseOutcomes.length ? translations.en.outcomes : baseOutcomes),
  };
}

export const _internal = {
  buildMarketTranslations,
  stripQuestionMarks,
  translateByPattern,
  translateKnownKind,
};
