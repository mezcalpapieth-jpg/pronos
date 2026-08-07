export const MEXICO_CITY_TZ = 'America/Mexico_City';

const WEEKDAYS = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const MONTH_ES = [
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

function pad(n) {
  return String(n).padStart(2, '0');
}

function partsObject(formatter, date) {
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
}

function zonedDateParts(date, timeZone = MEXICO_CITY_TZ) {
  const parts = partsObject(new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }), date);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS[parts.weekday],
  };
}

function zonedDateTimeParts(date, timeZone = MEXICO_CITY_TZ) {
  const parts = partsObject(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }), date);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function addDaysToLocalDate({ year, month, day }, days) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function dateAtMexicoCityTime({
  year,
  month,
  day,
  hour = 23,
  minute = 59,
  second = 0,
}) {
  const targetLocalMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  let utcMs = targetLocalMs;
  for (let i = 0; i < 3; i += 1) {
    const represented = zonedDateTimeParts(new Date(utcMs));
    const representedLocalMs = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
      0,
    );
    const delta = targetLocalMs - representedLocalMs;
    if (delta === 0) break;
    utcMs += delta;
  }
  return new Date(utcMs);
}

export function nextMexicoFridayClose(now = new Date()) {
  const local = zonedDateParts(now);
  const daysAhead = ((5 - local.weekday + 7) % 7) || 7;
  const target = addDaysToLocalDate(local, daysAhead);
  return dateAtMexicoCityTime({ ...target, hour: 23, minute: 59, second: 0 });
}

export function endOfMexicoMonthClose(now = new Date()) {
  const local = zonedDateParts(now);
  const lastDay = new Date(Date.UTC(local.year, local.month, 0, 12, 0, 0, 0));
  return dateAtMexicoCityTime({
    year: lastDay.getUTCFullYear(),
    month: lastDay.getUTCMonth() + 1,
    day: lastDay.getUTCDate(),
    hour: 23,
    minute: 59,
    second: 0,
  });
}

export function formatMexicoDateYmd(date) {
  const parts = zonedDateParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function formatMexicoDateEs(date) {
  const parts = zonedDateParts(date);
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
}

export function mexicoIsoWeekKey(date) {
  const parts = zonedDateParts(date);
  const copy = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  copy.setUTCDate(copy.getUTCDate() + 4 - (copy.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((copy - yearStart) / 86_400_000) + 1) / 7);
  return `${copy.getUTCFullYear()}-W${pad(weekNo)}`;
}

export function mexicoMonthKey(date) {
  const parts = zonedDateParts(date);
  return `${parts.year}-${pad(parts.month)}`;
}

export function mexicoMonthNameEs(date) {
  const parts = zonedDateParts(date);
  return MONTH_ES[parts.month - 1];
}
