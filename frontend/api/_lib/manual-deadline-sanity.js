const MONTHS = [
  ['enero', 'january', 'jan'],
  ['febrero', 'february', 'feb'],
  ['marzo', 'march', 'mar'],
  ['abril', 'april', 'apr'],
  ['mayo', 'may'],
  ['junio', 'june', 'jun'],
  ['julio', 'july', 'jul'],
  ['agosto', 'august', 'aug'],
  ['septiembre', 'setiembre', 'september', 'sept', 'sep'],
  ['octubre', 'october', 'oct'],
  ['noviembre', 'november', 'nov'],
  ['diciembre', 'december', 'dec'],
];

const MONTH_NAME_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const MONTH_ALIASES = new Map(
  MONTHS.flatMap((aliases, index) => aliases.map(alias => [normalizeText(alias), index + 1])),
);

const MONTH_PATTERN = [...MONTH_ALIASES.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join('|');

const BEFORE_MONTH_RE = new RegExp(
  [
    '\\b(?:antes\\s+de(?:l)?|before)\\s+',
    '(?:(?:el|the)\\s+)?',
    '(?:(?:0?1|1)(?:ro|o|st|º|°)?\\s+(?:de|of)\\s+)?',
    `(${MONTH_PATTERN})\\b`,
    '(?:\\s+(?:0?1|1)(?:st|nd|rd|th|ro|o|º|°)?)?',
    '(?:\\s*,?\\s*(?:de\\s+)?(\\d{4}))?',
  ].join(''),
  'i',
);

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function referenceDate({ resolverConfig, sourceData, startTime, now }) {
  return parseDate(resolverConfig?.launchDate)
    || parseDate(sourceData?.generatedAt)
    || parseDate(startTime)
    || parseDate(now)
    || new Date();
}

function inferYearForMonth(month, anchorDate) {
  const anchorYear = anchorDate.getUTCFullYear();
  const anchorMonth = anchorDate.getUTCMonth() + 1;
  return month <= anchorMonth ? anchorYear + 1 : anchorYear;
}

function deadlineLabel(deadline) {
  if (!deadline) return '';
  return `${MONTH_NAME_ES[deadline.month - 1]} ${deadline.year}`;
}

function endFallsNearMonthBoundary(endTime, deadline) {
  const end = parseDate(endTime);
  if (!end || !deadline) return true;
  const boundaryMs = Date.UTC(deadline.year, deadline.month - 1, 1, 0, 0, 0, 0);
  const driftMs = Math.abs(end.getTime() - boundaryMs);
  return driftMs <= 36 * 60 * 60 * 1000;
}

export function inferBeforeMonthDeadline(text, { anchorDate = new Date() } = {}) {
  const normalized = normalizeText(text);
  const match = normalized.match(BEFORE_MONTH_RE);
  if (!match) return null;
  const month = MONTH_ALIASES.get(match[1]);
  if (!month) return null;
  const explicitYear = match[2] ? Number(match[2]) : null;
  const year = Number.isInteger(explicitYear)
    ? explicitYear
    : inferYearForMonth(month, anchorDate);
  return {
    month,
    year,
    label: deadlineLabel({ month, year }),
  };
}

export function validateBeforeMonthDeadline({
  question,
  endTime,
  resolverConfig,
  sourceData,
  startTime,
  now = new Date(),
} = {}) {
  const anchorDate = referenceDate({ resolverConfig, sourceData, startTime, now });
  const questionDeadline = inferBeforeMonthDeadline(question, { anchorDate });
  if (!questionDeadline) return null;

  const criteriaText = [
    resolverConfig?.resolutionCriteria,
    resolverConfig?.criteria,
    resolverConfig?.rationale,
    sourceData?.contextBlocks?.resolutionCriteria,
    sourceData?.contextBlocks?.contextResolutionCriteria,
  ].filter(Boolean).join('\n');
  const criteriaDeadline = inferBeforeMonthDeadline(criteriaText, { anchorDate });

  if (
    criteriaDeadline
    && (
      criteriaDeadline.month !== questionDeadline.month
      || criteriaDeadline.year !== questionDeadline.year
    )
  ) {
    return {
      error: 'deadline_question_mismatch',
      detail: `question implies before ${questionDeadline.label}, but resolution criteria imply before ${criteriaDeadline.label}`,
    };
  }

  if (!endFallsNearMonthBoundary(endTime, questionDeadline)) {
    const end = parseDate(endTime);
    return {
      error: 'deadline_question_mismatch',
      detail: `question implies before ${questionDeadline.label}, but end_time is ${end ? end.toISOString() : 'invalid'}`,
    };
  }

  return null;
}
