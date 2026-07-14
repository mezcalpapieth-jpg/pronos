const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_SOCCER_COMPETITION_PATH = {
  WC: 'soccer/fifa.world',
  CL: 'soccer/uefa.champions',
  EL: 'soccer/uefa.europa',
  UCL: 'soccer/uefa.europa.conf',
  CLI: 'soccer/conmebol.libertadores',
  PD: 'soccer/esp.1',
  PL: 'soccer/eng.1',
  SA: 'soccer/ita.1',
  BL1: 'soccer/ger.1',
};

function ymdToDateRange(ymd) {
  if (!ymd) return null;
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return null;
  const start = new Date(Date.UTC(y, m - 1, d - 1));
  const end = new Date(Date.UTC(y, m - 1, d + 1));
  const fmt = (x) => `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, '0')}${String(x.getUTCDate()).padStart(2, '0')}`;
  return `${fmt(start)}-${fmt(end)}`;
}

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function cleanString(value) {
  const text = String(value || '').trim();
  return text.length > 0 ? text : null;
}

function normalizeTeamName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|sc|cf|afc|ac|cd|club)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function namesMatch(a, b) {
  const left = normalizeTeamName(a);
  const right = normalizeTeamName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function inferSport(leaguePath) {
  const first = String(leaguePath || '').split('/')[0].toLowerCase();
  if (first === 'basketball') return 'basketball';
  if (first === 'baseball') return 'baseball';
  if (first === 'football') return 'football';
  if (first === 'soccer') return 'soccer';
  return first || null;
}

function competitorName(c) {
  return cleanString(c?.team?.shortDisplayName)
    || cleanString(c?.team?.displayName)
    || cleanString(c?.team?.name)
    || cleanString(c?.team?.abbreviation)
    || cleanString(c?.displayName)
    || null;
}

function competitorNames(c) {
  return [
    c?.team?.shortDisplayName,
    c?.team?.displayName,
    c?.team?.name,
    c?.team?.abbreviation,
    c?.displayName,
  ].map(cleanString).filter(Boolean);
}

function anyNameMatches(names, target) {
  return names.some(name => namesMatch(name, target));
}

function competitorLogo(c) {
  return cleanString(c?.team?.logo)
    || cleanString(c?.team?.logos?.[0]?.href)
    || null;
}

function scoreNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return scoreNumber(value.value ?? value.displayValue);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function periodLabel(sport, idx) {
  const n = idx + 1;
  if (sport === 'basketball' || sport === 'football') return `${n}C`;
  if (sport === 'soccer') return n === 1 ? '1T' : n === 2 ? '2T' : `TE${n - 2}`;
  return String(n);
}

function lineScores(c) {
  const rows = Array.isArray(c?.linescores) ? c.linescores : [];
  return rows.map(row => scoreNumber(row));
}

function buildPeriods({ sport, home, away }) {
  const homeLines = lineScores(home);
  const awayLines = lineScores(away);
  const n = Math.max(homeLines.length, awayLines.length);
  return Array.from({ length: n }, (_, i) => ({
    label: periodLabel(sport, i),
    home: homeLines[i] ?? null,
    away: awayLines[i] ?? null,
  }));
}

function statusLabelFor({ sport, status }) {
  const type = status?.type || {};
  const state = cleanString(type.state);
  const shortDetail = cleanString(type.shortDetail);
  const detail = cleanString(type.detail);
  const clock = cleanString(status?.displayClock);
  const period = Number(status?.period);

  if (state === 'post' || type.completed) return 'Final';
  if (sport === 'basketball' || sport === 'football') {
    const q = Number.isFinite(period) && period > 0 ? `${period}C` : null;
    if (q && clock) return `${q} · ${clock}`;
    if (q) return q;
  }
  if (sport === 'soccer') {
    if (shortDetail && shortDetail !== '0') return shortDetail;
    if (clock) return clock.endsWith("'") ? clock : `${clock}'`;
  }
  if (sport === 'baseball') {
    if (shortDetail) return shortDetail;
    if (Number.isFinite(period) && period > 0) return `Entrada ${period}`;
  }
  return shortDetail || detail || (state === 'in' ? 'En vivo' : state);
}

function pickCompetition(event) {
  return Array.isArray(event?.competitions) ? event.competitions[0] : null;
}

function pickCompetitors(comp) {
  const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || null;
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || null;
  return { home, away };
}

function eventMatchesTeams(event, homeName, awayName) {
  if (!homeName || !awayName) return false;
  const comp = pickCompetition(event);
  if (!comp) return false;
  const { home, away } = pickCompetitors(comp);
  const eventHomeNames = competitorNames(home);
  const eventAwayNames = competitorNames(away);
  return (
    anyNameMatches(eventHomeNames, homeName) && anyNameMatches(eventAwayNames, awayName)
  ) || (
    anyNameMatches(eventHomeNames, awayName) && anyNameMatches(eventAwayNames, homeName)
  );
}

export function normalizeEspnLiveScore({ leaguePath, event }) {
  if (!event) return null;
  const comp = pickCompetition(event);
  if (!comp) return null;
  const { home, away } = pickCompetitors(comp);
  if (!home || !away) return null;
  const sport = inferSport(leaguePath);
  const status = event?.status || comp?.status || {};
  const type = status?.type || {};
  const state = cleanString(type.state);
  const completed = Boolean(type.completed || state === 'post');

  return {
    source: 'espn',
    eventId: String(event.id || comp.id || ''),
    sport,
    state,
    completed,
    statusLabel: statusLabelFor({ sport, status }),
    period: Number.isFinite(Number(status?.period)) ? Number(status.period) : null,
    clock: cleanString(status?.displayClock),
    startsAt: event?.date || null,
    lastUpdatedAt: new Date().toISOString(),
    home: {
      name: competitorName(home),
      score: scoreNumber(home?.score),
      logo: competitorLogo(home),
    },
    away: {
      name: competitorName(away),
      score: scoreNumber(away?.score),
      logo: competitorLogo(away),
    },
    periods: buildPeriods({ sport, home, away }),
  };
}

function dateYmdFromValue(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

export function buildEspnLiveScoreConfig({
  resolverType,
  resolverConfig,
  sourceData,
  sport,
  league,
  startTime,
}) {
  const cfg = parseJsonb(resolverConfig, null);
  if (resolverType === 'sports_api' && cfg?.source === 'espn' && cfg?.leaguePath && cfg?.eventId) {
    return {
      source: 'espn',
      leaguePath: String(cfg.leaguePath),
      eventId: String(cfg.eventId),
      dateYmd: cfg.dateYmd ? String(cfg.dateYmd) : null,
    };
  }

  const data = parseJsonb(sourceData, {});
  const isSoccer = sport === 'soccer' || data?.competitionCode || league?.startsWith?.('uefa-');
  if (!isSoccer) return null;
  const leaguePath = ESPN_SOCCER_COMPETITION_PATH[data?.competitionCode];
  const homeName = cleanString(data?.home?.espn || data?.home?.name || data?.homeName);
  const awayName = cleanString(data?.away?.espn || data?.away?.name || data?.awayName);
  const dateYmd = dateYmdFromValue(data?.kickoffUtc || startTime);
  if (!leaguePath || !homeName || !awayName || !dateYmd) return null;
  return {
    source: 'espn',
    leaguePath,
    eventId: null,
    dateYmd,
    homeName,
    awayName,
  };
}

export async function readEspnLiveScore({ leaguePath, eventId, dateYmd, homeName, awayName }) {
  if (!leaguePath || (!eventId && !(homeName && awayName))) {
    throw new Error('espn-live-score: missing leaguePath/event lookup');
  }
  const dateRange = ymdToDateRange(dateYmd);
  const q = dateRange ? `?dates=${dateRange}&limit=500` : '?limit=500';
  const scoreboardUrl = `${ESPN_BASE}/${leaguePath}/scoreboard${q}`;
  const res = await fetch(scoreboardUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`espn-live-score: HTTP ${res.status}`);
  const data = await res.json();
  const events = Array.isArray(data?.events) ? data.events : [];
  const event = eventId
    ? events.find(e => String(e.id) === String(eventId))
    : events.find(e => eventMatchesTeams(e, homeName, awayName));
  if (event) return normalizeEspnLiveScore({ leaguePath, event });
  if (!eventId) return null;

  const summaryUrl = `${ESPN_BASE}/${leaguePath}/summary?event=${encodeURIComponent(eventId)}`;
  const summaryRes = await fetch(summaryUrl, { headers: { Accept: 'application/json' } });
  if (!summaryRes.ok) throw new Error(`espn-live-score-summary: HTTP ${summaryRes.status}`);
  const summary = await summaryRes.json();
  const summaryEvent = summary?.header?.id && String(summary.header.id) === String(eventId)
    ? summary.header
    : null;
  return summaryEvent ? normalizeEspnLiveScore({ leaguePath, event: summaryEvent }) : null;
}
