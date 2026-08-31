export const TOURNAMENT_TIME_ZONE = 'America/Mexico_City';

export const TOURNAMENT_START_ISO = '2026-08-12T06:00:00.000Z';
export const TOURNAMENT_OPERATION_CLOSE_ISO = '2026-08-27T05:59:00.000Z';
export const TOURNAMENT_RANKING_CUTOFF_ISO = '2026-08-27T05:59:00.000Z';
export const TOURNAMENT_CYCLE_LABEL = 'Ciclo 12 ago - 26 ago';

export const NEXT_TOURNAMENT_START_ISO = '2026-09-01T15:00:00.000Z';
export const NEXT_TOURNAMENT_OPERATION_CLOSE_ISO = '2026-10-01T05:59:00.000Z';
export const NEXT_TOURNAMENT_RANKING_CUTOFF_ISO = '2026-10-01T05:59:00.000Z';
export const NEXT_TOURNAMENT_CYCLE_LABEL = 'Ciclo septiembre 2026';

export const TOURNAMENT_STARTING_BALANCE = 500;
export const TOURNAMENT_MIN_ENTRY_MXNP = 100;
export const TOURNAMENT_MAX_SHARES_PER_MARKET = 6000;
export const TOURNAMENT_QUALIFYING_MARKETS = 10;
export const TOURNAMENT_INACTIVITY_PENALTY = 50;
export const TOURNAMENT_HOLD_REWARD_WEEKLY_RATE = 0.25;
export const TOURNAMENT_HOLD_REWARD_MAX_WEEKS = 4;
export const TOURNAMENT_LIQUIDITY_REWARD_WEEKLY_RATE = 0.20;
export const TOURNAMENT_LIQUIDITY_REWARD_MAX_DAILY_PER_USER = 100;
export const TOURNAMENT_PARLAY_MIN_LEGS = 3;
export const TOURNAMENT_PARLAY_MAX_LEGS = 6;
export const TOURNAMENT_PARLAY_EDGE_FACTOR = 0.75;
export const TOURNAMENT_PARLAY_MIN_STAKE_MXNP = 10;
export const TOURNAMENT_PARLAY_MAX_PAYOUT_MXNP = 5000;
export const TOURNAMENT_PARLAY_MAX_MULTIPLIER = 25;
export const TOURNAMENT_PARLAY_PRICE_FLOOR = 0.05;
export const TOURNAMENT_PARLAY_PRICE_CEILING = 0.95;

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
  socialFollow: 100,
  socialPost: 100,
  socialStory: 750,
});

export const TOURNAMENT_PRIZES = Object.freeze([
  { rank: '1', prize: '$3,500 MXN', amount: 3500 },
  { rank: '2', prize: '$2,500 MXN', amount: 2500 },
  { rank: '3', prize: '$1,800 MXN', amount: 1800 },
  { rank: '4', prize: '$1,200 MXN', amount: 1200 },
  { rank: '5', prize: '$1,000 MXN', amount: 1000 },
]);

export const TOURNAMENT_WINDOWS = Object.freeze([
  Object.freeze({
    label: TOURNAMENT_CYCLE_LABEL,
    startsAt: TOURNAMENT_START_ISO,
    operationCloseAt: TOURNAMENT_OPERATION_CLOSE_ISO,
    rankingCutoffAt: TOURNAMENT_RANKING_CUTOFF_ISO,
    endsAt: TOURNAMENT_RANKING_CUTOFF_ISO,
  }),
  Object.freeze({
    label: NEXT_TOURNAMENT_CYCLE_LABEL,
    startsAt: NEXT_TOURNAMENT_START_ISO,
    operationCloseAt: NEXT_TOURNAMENT_OPERATION_CLOSE_ISO,
    rankingCutoffAt: NEXT_TOURNAMENT_RANKING_CUTOFF_ISO,
    endsAt: NEXT_TOURNAMENT_RANKING_CUTOFF_ISO,
  }),
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

function tournamentWindowForNow(now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  const nowMs = current.getTime();
  if (!Number.isFinite(nowMs)) return TOURNAMENT_WINDOWS[0];
  return TOURNAMENT_WINDOWS.find(window => nowMs < new Date(window.rankingCutoffAt).getTime())
    || TOURNAMENT_WINDOWS[TOURNAMENT_WINDOWS.length - 1];
}

export function configuredTournamentWindowForStart(startIso) {
  const startMs = new Date(startIso).getTime();
  if (!Number.isFinite(startMs)) return null;
  return TOURNAMENT_WINDOWS.find((window) => {
    const windowStartMs = new Date(window.startsAt).getTime();
    const windowEndMs = new Date(window.rankingCutoffAt).getTime();
    return startMs >= windowStartMs && startMs < windowEndMs;
  }) || null;
}

export function configuredCycleEndIso(startIso, fallbackDays = 14) {
  const startMs = new Date(startIso).getTime();
  if (!Number.isFinite(startMs)) return null;
  const window = configuredTournamentWindowForStart(startIso);
  const configuredEndMs = new Date(window?.operationCloseAt || '').getTime();
  if (window && Number.isFinite(configuredEndMs) && configuredEndMs > startMs) {
    return window.operationCloseAt;
  }
  return new Date(startMs + fallbackDays * 24 * 60 * 60 * 1000).toISOString();
}

export function configuredCycleWindowFromRow(row) {
  if (!row?.started_at || !row?.ends_at) return null;
  const configured = configuredTournamentWindowForStart(row.started_at);
  const currentEndMs = new Date(row.ends_at).getTime();
  const configuredEndMs = new Date(configured?.rankingCutoffAt || '').getTime();
  const shouldExtend = configured
    && Number.isFinite(currentEndMs)
    && Number.isFinite(configuredEndMs)
    && configuredEndMs > currentEndMs;
  const endsAt = shouldExtend ? configured.rankingCutoffAt : row.ends_at;
  return {
    id: row.id ?? null,
    label: shouldExtend ? configured.label : (row.label || configured?.label || null),
    startsAt: row.started_at,
    operationCloseAt: shouldExtend ? configured.operationCloseAt : endsAt,
    rankingCutoffAt: endsAt,
    endsAt,
  };
}

export function getTournamentWindow(now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  const configured = tournamentWindowForNow(current);
  const startsAt = new Date(configured.startsAt);
  const operationCloseAt = new Date(configured.operationCloseAt);
  const rankingCutoffAt = new Date(configured.rankingCutoffAt);
  const nowMs = current.getTime();

  let status = 'scheduled';
  if (nowMs >= rankingCutoffAt.getTime()) status = 'closed';
  else if (nowMs >= operationCloseAt.getTime()) status = 'closing';
  else if (nowMs >= startsAt.getTime()) status = 'active';

  const secondsUntilStart = Math.max(0, Math.floor((startsAt.getTime() - nowMs) / 1000));
  const secondsRemaining = Math.max(0, Math.floor((rankingCutoffAt.getTime() - nowMs) / 1000));
  const secondsUntilOperationClose = Math.max(0, Math.floor((operationCloseAt.getTime() - nowMs) / 1000));

  return {
    label: configured.label,
    status,
    paused: false,
    scheduled: status === 'scheduled',
    active: status === 'active' || status === 'closing',
    startsAt: configured.startsAt,
    operationCloseAt: configured.operationCloseAt,
    rankingCutoffAt: configured.rankingCutoffAt,
    endsAt: configured.endsAt,
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
    holdReward: {
      weeklyRate: TOURNAMENT_HOLD_REWARD_WEEKLY_RATE,
      maxWeeks: TOURNAMENT_HOLD_REWARD_MAX_WEEKS,
    },
    liquidityReward: {
      weeklyRate: TOURNAMENT_LIQUIDITY_REWARD_WEEKLY_RATE,
      maxDailyPerUser: TOURNAMENT_LIQUIDITY_REWARD_MAX_DAILY_PER_USER,
    },
    parlay: {
      minLegs: TOURNAMENT_PARLAY_MIN_LEGS,
      maxLegs: TOURNAMENT_PARLAY_MAX_LEGS,
      edgeFactor: TOURNAMENT_PARLAY_EDGE_FACTOR,
      minStakeMxnp: TOURNAMENT_PARLAY_MIN_STAKE_MXNP,
      maxPayoutMxnp: TOURNAMENT_PARLAY_MAX_PAYOUT_MXNP,
      maxMultiplier: TOURNAMENT_PARLAY_MAX_MULTIPLIER,
    },
    rewards: TOURNAMENT_REWARDS,
    prizes: TOURNAMENT_PRIZES,
  };
}
