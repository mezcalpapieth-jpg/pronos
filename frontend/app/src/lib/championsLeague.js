export const CHAMPIONS_LEAGUE_FINAL = {
  season: '2025/26',
  competition: 'UEFA Champions League',
  stage: 'Final',
  kickoffIso: '2026-05-30T16:00:00.000Z',
  venue: 'Puskas Arena, Budapest',
  home: {
    name: 'Paris Saint-Germain',
    shortName: 'PSG',
    city: 'Paris',
    crestUrl: 'https://a.espncdn.com/i/teamlogos/soccer/500/160.png',
    primary: '#004170',
    secondary: '#da291c',
  },
  away: {
    name: 'Arsenal',
    shortName: 'ARS',
    city: 'London',
    crestUrl: 'https://a.espncdn.com/i/teamlogos/soccer/500/359.png',
    primary: '#ef0107',
    secondary: '#d4af37',
  },
};

export const CHAMPIONS_LEAGUE_HUB_PATH = '/c/deportes/uefa-champions-league';
export const CHAMPIONS_LEAGUE_FINAL_BADGE = '🏆';

export const CHAMPIONS_LEAGUE_NEXT_SEASON = {
  enabled: false,
  season: '2026/27',
  route: '/c/deportes/uefa-champions-league/2026-27',
  copy: 'La misma base queda lista para activar fase de liga, playoff y bracket cuando tengamos datos confiables.',
};

export const CHAMPIONS_LEAGUE_ROAD = [
  {
    id: 'league',
    label: 'Fase de liga',
    status: 'closed',
    psg: 'Top 8 y pase directo',
    arsenal: 'Top 8 y pase directo',
  },
  {
    id: 'round-16',
    label: 'Octavos',
    status: 'closed',
    psg: 'PSG avanza',
    arsenal: 'Arsenal avanza',
  },
  {
    id: 'quarterfinals',
    label: 'Cuartos',
    status: 'closed',
    psg: 'PSG elimina a su rival',
    arsenal: 'Arsenal elimina a su rival',
  },
  {
    id: 'semifinals',
    label: 'Semifinales',
    status: 'closed',
    psg: 'PSG gana la serie',
    arsenal: 'Arsenal gana la serie',
  },
  {
    id: 'final',
    label: 'Final',
    status: 'closed',
    psg: 'Paris Saint-Germain',
    arsenal: 'Arsenal',
  },
];

export const CHAMPIONS_LEAGUE_MARKET_GROUPS = [
  {
    id: 'league-phase',
    title: 'Fase de liga',
    eyebrow: 'Historial',
    summary: 'La zona para revivir posiciones, top 8 y clasificación antes del bracket.',
    markets: [
      { id: 'ucl-league-psg-top8', question: '¿PSG termina en top 8 de la fase de liga?', result: 'Sí', status: 'closed' },
      { id: 'ucl-league-arsenal-top8', question: '¿Arsenal termina en top 8 de la fase de liga?', result: 'Sí', status: 'closed' },
      { id: 'ucl-league-spanish-top4', question: '¿Un club español acaba top 4?', result: 'No', status: 'closed' },
    ],
  },
  {
    id: 'knockouts',
    title: 'Eliminatorias',
    eyebrow: 'Camino a la final',
    summary: 'Octavos, cuartos y semifinales con el recorrido que trae a PSG y Arsenal a Budapest.',
    markets: [
      { id: 'ucl-ko-psg-semis', question: '¿PSG llega a semifinales?', result: 'Sí', status: 'closed' },
      { id: 'ucl-ko-arsenal-semis', question: '¿Arsenal llega a semifinales?', result: 'Sí', status: 'closed' },
      { id: 'ucl-ko-extra-time', question: '¿Alguna semifinal se va a tiempo extra?', result: 'No', status: 'closed' },
    ],
  },
  {
    id: 'final-market',
    title: 'Final',
    eyebrow: 'Budapest',
    summary: 'El mercado central de la final vive aquí junto al camino del torneo.',
    markets: [
      { id: 'ucl-final-winner', question: '¿Quién gana la Champions League?', result: 'Abierto', status: 'open' },
      { id: 'ucl-final-goals', question: '¿La final tendrá más de 2.5 goles?', result: 'Por abrir', status: 'pending' },
      { id: 'ucl-final-mvp', question: '¿Un delantero gana el MVP de la final?', result: 'Por abrir', status: 'pending' },
    ],
  },
];

function normalizeFinalText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function isDrawOutcomeLabel(label) {
  const text = normalizeFinalText(label);
  return text === 'empate' || text === 'draw' || text === 'tie';
}

function marketSearchText(market) {
  const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
  return normalizeFinalText([
    market?.question,
    market?.league,
    market?.sport,
    ...outcomes,
  ].filter(Boolean).join(' '));
}

function isoDatePart(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

function isPsgArsenalFinalMarket(market) {
  const text = marketSearchText(market);
  const hasPsg = /\bpsg\b/.test(text) || text.includes('paris saint-germain');
  const hasArsenal = /\barsenal\b/.test(text);
  const isSoccer = !market?.sport || normalizeFinalText(market.sport) === 'soccer';
  const isChampions = !market?.league
    || normalizeFinalText(market.league) === 'uefa-cl'
    || text.includes('champions league');
  const marketDate = market?.startTime || market?.start_time || market?.endTime || market?.end_time || null;
  const sameFinalDate = !marketDate || isoDatePart(marketDate) === CHAMPIONS_LEAGUE_FINAL.kickoffIso.slice(0, 10);
  return hasPsg && hasArsenal && isSoccer && isChampions && sameFinalDate;
}

export function isChampionsLeagueFinalWinnerMarket(market) {
  return isPsgArsenalFinalMarket(market);
}

function isChampionsLeagueFinalSideMarket(market, kind) {
  const text = marketSearchText(market);
  const isSoccer = !market?.sport || normalizeFinalText(market.sport) === 'soccer';
  const isChampions = !market?.league
    || normalizeFinalText(market.league) === 'uefa-cl'
    || text.includes('champions league');
  const marketDate = market?.startTime || market?.start_time || market?.endTime || market?.end_time || null;
  const sameFinalDate = !marketDate || isoDatePart(marketDate) === CHAMPIONS_LEAGUE_FINAL.kickoffIso.slice(0, 10);
  if (!isSoccer || !isChampions || !sameFinalDate) return false;
  if (kind === 'goals') return text.includes('2.5') && text.includes('goles');
  if (kind === 'mvp') return text.includes('mvp') && text.includes('delantero');
  return false;
}

function rankMarketCandidate(market) {
  const text = marketSearchText(market);
  const status = normalizeFinalText(market.status);
  let score = 0;
  if (status === 'active' || status === 'open') score += 40;
  if (normalizeFinalText(market.league) === 'uefa-cl') score += 30;
  if (isoDatePart(market.startTime || market.start_time || market.endTime || market.end_time) === CHAMPIONS_LEAGUE_FINAL.kickoffIso.slice(0, 10)) score += 20;
  if (text.includes('champions')) score += 10;
  if (Array.isArray(market.outcomes) && market.outcomes.length >= 2) score += 5;
  return score;
}

function bestMarket(markets) {
  if (!Array.isArray(markets) || markets.length === 0) return null;
  return markets
    .map(market => ({ market, score: rankMarketCandidate(market) }))
    .sort((a, b) => b.score - a.score)[0].market;
}

export function findChampionsLeagueFinalMarket(markets = []) {
  const candidates = (Array.isArray(markets) ? markets : [])
    .filter(isPsgArsenalFinalMarket);
  if (candidates.length === 0) return null;
  return bestMarket(candidates);
}

export function findChampionsLeagueFinalMarkets(markets = []) {
  const list = Array.isArray(markets) ? markets : [];
  return {
    winner: findChampionsLeagueFinalMarket(list),
    goals: bestMarket(list.filter(market => isChampionsLeagueFinalSideMarket(market, 'goals'))),
    mvp: bestMarket(list.filter(market => isChampionsLeagueFinalSideMarket(market, 'mvp'))),
  };
}

export function finalMarketOptions(market) {
  const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
  const rawPrices = Array.isArray(market?.prices) && market.prices.length === outcomes.length
    ? market.prices.map(Number)
    : outcomes.map(() => outcomes.length > 0 ? 1 / outcomes.length : 0.5);
  const images = Array.isArray(market?.outcomeImages) ? market.outcomeImages : [];
  const options = outcomes
    .map((label, outcomeIndex) => ({
      label,
      outcomeIndex,
      rawPrice: Number.isFinite(rawPrices[outcomeIndex]) ? Math.max(0, rawPrices[outcomeIndex]) : 0,
      image: images[outcomeIndex] || null,
    }))
    .filter(option => !isDrawOutcomeLabel(option.label));
  const total = options.reduce((sum, option) => sum + option.rawPrice, 0) || options.length || 1;
  return options.map(option => ({
    ...option,
    pct: Math.round((option.rawPrice / total) * 100),
    price: option.rawPrice / total,
  }));
}

export function formatCountdown(targetIso, nowInput = Date.now()) {
  const now = typeof nowInput === 'string' ? new Date(nowInput).getTime() : Number(nowInput);
  const target = new Date(targetIso).getTime();
  const deltaSec = Math.max(0, Math.floor((target - now) / 1000));
  return {
    days: Math.floor(deltaSec / 86400),
    hours: Math.floor((deltaSec % 86400) / 3600),
    minutes: Math.floor((deltaSec % 3600) / 60),
    seconds: deltaSec % 60,
    done: deltaSec === 0,
  };
}

export function formatKickoff(iso, locale = 'es-MX') {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}
