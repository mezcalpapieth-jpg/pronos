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
    eyebrow: 'Mercados cerrados',
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
    eyebrow: 'Road to the final',
    summary: 'Octavos, cuartos y semifinales con cada mercado bloqueado como archivo.',
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
    summary: 'El mercado central queda cerrado por ahora, pero el escenario ya está listo.',
    markets: [
      { id: 'ucl-final-winner', question: '¿Quién gana la Champions League?', result: 'Cerrado', status: 'closed' },
      { id: 'ucl-final-goals', question: '¿La final tendrá más de 2.5 goles?', result: 'Cerrado', status: 'closed' },
      { id: 'ucl-final-mvp', question: '¿Un delantero gana el MVP de la final?', result: 'Cerrado', status: 'closed' },
    ],
  },
];

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
