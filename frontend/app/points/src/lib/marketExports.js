const CRLF = '\r\n';
const encoder = new TextEncoder();

function calendarTimestamp(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function foldCalendarLine(line) {
  let folded = '';
  let bytes = 0;
  for (const char of line) {
    const width = encoder.encode(char).length;
    if (bytes + width > 75) {
      folded += '\r\n ';
      bytes = 1;
    }
    folded += char;
    bytes += width;
  }
  return folded;
}

export function marketCloseCalendar({ marketId, title, endTime, origin, now = new Date() }) {
  const date = calendarTimestamp(endTime);
  if (!date) return null;
  const summary = String(title || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[,;]/g, '\\$&');
  const url = new URL('/market', origin);
  url.searchParams.set('id', String(marketId));
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pronos//Market close//EN',
    'BEGIN:VEVENT',
    `UID:pronos-market-${marketId}@pronos.io`,
    `DTSTAMP:${calendarTimestamp(now)}`,
    `DTSTART:${date}`,
    `SUMMARY:${summary}`,
    `URL:${url.href}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(foldCalendarLine).join(CRLF) + CRLF;
}

function spreadsheetText(value) {
  const text = String(value ?? '');
  const safe = /^[\t\r\n]|^\s*[=+\-@＝＋－＠]/u.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function timestampedRows(points, { valueField, multiplier, start, end }) {
  const rows = new Map();
  for (const point of points) {
    if (point?.t == null || point?.[valueField] == null) continue;
    const time = Number(point.t);
    const value = Number(point[valueField]);
    if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(value)) continue;
    if ((start != null && time < start) || (end != null && time > end)) continue;
    const instant = new Date(time * multiplier);
    if (Number.isFinite(instant.getTime())) rows.set(time, [instant.toISOString(), value]);
  }
  return [...rows.values()];
}

export function marketProbabilityCsv(series, { start, end } = {}) {
  const rows = series.flatMap(({ label, data }) => {
    const outcome = spreadsheetText(label);
    return timestampedRows(data, { valueField: 'p', multiplier: 1000, start, end })
      .map(([timestamp, value]) => [timestamp, outcome, Math.min(100, Math.max(0, value))]);
  });
  if (!rows.length) return null;
  rows.sort(([a], [b]) => a.localeCompare(b));
  return ['timestamp_utc,outcome,probability_percent', ...rows.map(row => row.join(','))].join(CRLF) + CRLF;
}

export function marketCryptoPriceCsv(data, { start, end } = {}) {
  const rows = timestampedRows(data, { valueField: 'price', multiplier: 1, start, end });
  if (!rows.length) return null;
  rows.sort(([a], [b]) => a.localeCompare(b));
  return ['timestamp_utc,price_usd', ...rows.map(row => row.join(','))].join(CRLF) + CRLF;
}

export function downloadMarketExport({ content, filename, type }) {
  if (!content) return;
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
