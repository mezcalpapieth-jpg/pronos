export const TOURNAMENT_TIME_ZONE = 'America/Mexico_City';

export const TOURNAMENT_START_ISO = '2026-08-12T06:00:00.000Z';
export const TOURNAMENT_OPERATION_CLOSE_ISO = '2026-08-25T20:00:00.000Z';
export const TOURNAMENT_RANKING_CUTOFF_ISO = '2026-08-26T05:59:00.000Z';
export const TOURNAMENT_CYCLE_LABEL = 'Ciclo 12 ago - 25 ago';

export const TOURNAMENT_STARTING_BALANCE = 500;
export const TOURNAMENT_MIN_ENTRY_MXNP = 100;
export const TOURNAMENT_MAX_SHARES_PER_MARKET = 6000;
export const TOURNAMENT_QUALIFYING_MARKETS = 10;
export const TOURNAMENT_INACTIVITY_PENALTY = 50;

export const TOURNAMENT_REWARDS = Object.freeze({
  signupBonus: 500,
  preCycleSignupBonus: 200,
  dailyBase: 100,
  dailyStep: 20,
  dailyMax: 200,
  rescueFloor: 300,
  rescueMaxClaims: 3,
  referrerReward: 100,
  preCycleReferralReward: 50,
  referredReward: 250,
  referralCycleCap: 10,
  socialFollow: 300,
  socialPost: 300,
  socialStory: 750,
});

export const TOURNAMENT_PRIZES = Object.freeze([
  { rank: '1', prize: '$3,500 MXN', amount: 3500 },
  { rank: '2', prize: '$2,500 MXN', amount: 2500 },
  { rank: '3', prize: '$1,800 MXN', amount: 1800 },
  { rank: '4', prize: '$1,200 MXN', amount: 1200 },
  { rank: '5', prize: '$1,000 MXN', amount: 1000 },
]);

const MEXICO_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: TOURNAMENT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function partsForMexicoDate(date) {
  const parts = MEXICO_DATE_FORMAT.formatToParts(date instanceof Date ? date : new Date(date));
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: byType.year,
    month: byType.month,
    day: byType.day,
  };
}

export function mexicoDateKey(date = new Date()) {
  const { year, month, day } = partsForMexicoDate(date);
  return `${year}-${month}-${day}`;
}

export function mexicoDateKeyToUtcNoon(key) {
  return new Date(`${key}T12:00:00.000Z`);
}

export function previousMexicoDateKey(date = new Date()) {
  const cursor = mexicoDateKeyToUtcNoon(mexicoDateKey(date));
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  return mexicoDateKey(cursor);
}

export function nextMexicoMidnightUtcIso(date = new Date()) {
  const cursor = mexicoDateKeyToUtcNoon(mexicoDateKey(date));
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  const nextKey = mexicoDateKey(cursor);
  return `${nextKey}T06:00:00.000Z`;
}

export function countMexicoDaysInclusive(start, end) {
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  if (!(Number.isFinite(startDate.getTime()) && Number.isFinite(endDate.getTime())) || endDate < startDate) {
    return 0;
  }
  const lastKey = mexicoDateKey(endDate);
  const cursor = mexicoDateKeyToUtcNoon(mexicoDateKey(startDate));
  let count = 0;
  for (let guard = 0; guard < 400; guard += 1) {
    count += 1;
    if (mexicoDateKey(cursor) === lastKey) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function roundTournamentAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function getTournamentWindow(now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  const startsAt = new Date(TOURNAMENT_START_ISO);
  const operationCloseAt = new Date(TOURNAMENT_OPERATION_CLOSE_ISO);
  const rankingCutoffAt = new Date(TOURNAMENT_RANKING_CUTOFF_ISO);
  const nowMs = current.getTime();

  let status = 'scheduled';
  if (nowMs >= rankingCutoffAt.getTime()) status = 'closed';
  else if (nowMs >= operationCloseAt.getTime()) status = 'closing';
  else if (nowMs >= startsAt.getTime()) status = 'active';

  const secondsUntilStart = Math.max(0, Math.floor((startsAt.getTime() - nowMs) / 1000));
  const secondsRemaining = Math.max(0, Math.floor((rankingCutoffAt.getTime() - nowMs) / 1000));
  const secondsUntilOperationClose = Math.max(0, Math.floor((operationCloseAt.getTime() - nowMs) / 1000));

  return {
    label: TOURNAMENT_CYCLE_LABEL,
    status,
    paused: false,
    scheduled: status === 'scheduled',
    active: status === 'active' || status === 'closing',
    startsAt: TOURNAMENT_START_ISO,
    operationCloseAt: TOURNAMENT_OPERATION_CLOSE_ISO,
    rankingCutoffAt: TOURNAMENT_RANKING_CUTOFF_ISO,
    endsAt: TOURNAMENT_RANKING_CUTOFF_ISO,
    secondsUntilStart,
    secondsUntilOperationClose,
    secondsRemaining,
    pastDeadline: status === 'closed',
  };
}

export function tournamentRulesActive(now = new Date()) {
  const window = getTournamentWindow(now);
  return window.status === 'active' || window.status === 'closing';
}

export function tournamentRulesPayload() {
  return {
    startingBalance: TOURNAMENT_STARTING_BALANCE,
    minEntryMxnp: TOURNAMENT_MIN_ENTRY_MXNP,
    maxSharesPerMarket: TOURNAMENT_MAX_SHARES_PER_MARKET,
    qualifyingMarkets: TOURNAMENT_QUALIFYING_MARKETS,
    inactivityPenalty: TOURNAMENT_INACTIVITY_PENALTY,
    rewards: TOURNAMENT_REWARDS,
    prizes: TOURNAMENT_PRIZES,
  };
}
