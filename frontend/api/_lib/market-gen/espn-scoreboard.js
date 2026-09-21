const DAY_MS = 86_400_000;

export function formatEspnDateCompact(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function parseCompactDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{8}$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6)) - 1;
  const day = Number(text.slice(6, 8));
  const d = new Date(Date.UTC(year, month, day));
  return Number.isFinite(d.getTime()) ? d : null;
}

export function expandEspnDateRange(dateRange) {
  const [startText, endText = startText] = String(dateRange || '').split('-');
  const start = parseCompactDate(startText);
  const end = parseCompactDate(endText);
  if (!start || !end) return [];
  const dates = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    dates.push(formatEspnDateCompact(new Date(t)));
  }
  return dates;
}

function eventsFromData(data) {
  return Array.isArray(data?.events) ? data.events : [];
}

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function mergeScoreboards(scoreboards) {
  const first = scoreboards.find(Boolean) || {};
  const seen = new Set();
  const events = [];
  for (const data of scoreboards) {
    for (const event of eventsFromData(data)) {
      const key = event?.id != null ? String(event.id) : JSON.stringify(event);
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  return { ...first, events };
}

export async function fetchEspnScoreboardData({
  baseUrl,
  dateRange,
  limit = 500,
  fetchImpl = fetch,
  preferDaily = false,
  logPrefix,
  logContext = {},
} = {}) {
  const dates = expandEspnDateRange(dateRange);
  const errors = [];

  if (!preferDaily && dateRange) {
    const url = `${baseUrl}?dates=${dateRange}&limit=${limit}`;
    try {
      return await fetchJson(url, fetchImpl);
    } catch (error) {
      errors.push({ query: dateRange, message: error?.message || String(error) });
    }
  }

  const daily = [];
  for (const date of dates) {
    const url = `${baseUrl}?dates=${date}&limit=${limit}`;
    try {
      daily.push(await fetchJson(url, fetchImpl));
    } catch (error) {
      errors.push({ query: date, message: error?.message || String(error) });
    }
  }

  if (daily.length) return mergeScoreboards(daily);

  if (logPrefix) {
    const first = errors[0];
    console.error(logPrefix, {
      ...logContext,
      message: first?.message || 'no scoreboard data',
    });
  }
  return null;
}
