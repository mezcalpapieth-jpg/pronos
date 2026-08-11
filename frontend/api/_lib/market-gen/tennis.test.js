import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractAtpMensSinglesField,
  generateTennisMarkets,
} from './tennis.js';

function futureIso(days = 14) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function tennisPlayer(id, name, seed, extra = {}) {
  return {
    id: String(id),
    seed,
    athlete: {
      id: String(id),
      displayName: name,
    },
    ...extra,
  };
}

function mensSinglesGrouping(playersOrCompetitions) {
  const competitions = Array.isArray(playersOrCompetitions?.[0]?.competitors)
    ? playersOrCompetitions
    : [{ competitors: playersOrCompetitions }];
  return {
    grouping: {
      slug: 'mens-singles',
      name: "Men's Singles",
    },
    competitions,
  };
}

function atpEvent({
  id = 'national-bank-open',
  name = 'National Bank Open',
  players = [],
  groupings = null,
  state = 'pre',
  date = futureIso(10),
  endDate = futureIso(18),
} = {}) {
  return {
    id,
    name,
    date,
    endDate,
    status: {
      type: {
        state,
      },
    },
    groupings: groupings ?? [mensSinglesGrouping(players)],
  };
}

test('ATP generator uses confirmed draw entrants, not the static ranking list', async () => {
  const originalFetch = globalThis.fetch;
  const players = [
    tennisPlayer('2375', 'Alexander Zverev', 1),
    tennisPlayer('2946', 'Taylor Fritz', 2),
    tennisPlayer('9250', 'Ben Shelton', 3),
    tennisPlayer('3764', 'Lorenzo Musetti', 4),
    tennisPlayer('2651', 'Alex de Minaur', 5),
    tennisPlayer('3992', 'Tommy Paul', 6),
    tennisPlayer('9678', 'Holger Rune', 7),
    tennisPlayer('3897', 'Frances Tiafoe', 8),
    tennisPlayer('4705', 'Jack Draper', 9),
    tennisPlayer('4014', 'Felix Auger-Aliassime', 10),
  ];

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ events: [atpEvent({ players })] }),
  });

  try {
    const specs = await generateTennisMarkets();
    assert.equal(specs.length, 1);
    assert.equal(specs[0].source_data.fieldSource, 'espn-mens-singles-draw');
    assert.equal(specs[0].source_data.confirmedFieldSize, players.length);
    assert.equal(specs[0].source_data.rankingFallbackDisabled, true);
    assert.equal(specs[0].outcomes.includes('Carlos Alcaraz'), false);
    assert.equal(specs[0].outcomes.includes('Jannik Sinner'), false);
    assert.equal(specs[0].outcomes.includes('Alexander Zverev'), true);
    assert.equal(specs[0].outcomes.at(-1), 'Otro');
    assert.equal(specs[0].source_data.listedFieldSize, players.length);
    assert.equal(specs[0].source_data.fieldCap, 32);
    assert.equal(specs[0].source_data.suggestedPricing.probabilities.length, specs[0].outcomes.length);
    assert.deepEqual(
      specs[0].resolver_config.legs.map(leg => leg.label),
      specs[0].outcomes,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ATP generator emits bounded head-to-head markets for top-tier draws only', async () => {
  const originalFetch = globalThis.fetch;
  const matchDate = futureIso(3);
  const competitions = [
    {
      id: 'match-1',
      date: matchDate,
      round: { displayName: 'Round of 32' },
      status: { type: { state: 'pre' } },
      competitors: [
        tennisPlayer('2375', 'Alexander Zverev', 1),
        tennisPlayer('2946', 'Taylor Fritz', 2),
      ],
    },
    {
      id: 'match-2',
      date: matchDate,
      round: { displayName: 'Round of 32' },
      status: { type: { state: 'pre' } },
      competitors: [
        tennisPlayer('9250', 'Ben Shelton', 3),
        tennisPlayer('3764', 'Lorenzo Musetti', 4),
      ],
    },
    {
      id: 'match-3',
      date: matchDate,
      round: { displayName: 'Round of 32' },
      status: { type: { state: 'pre' } },
      competitors: [
        tennisPlayer('2651', 'Alex de Minaur', 5),
        tennisPlayer('3992', 'Tommy Paul', 6),
      ],
    },
    {
      id: 'match-4',
      date: matchDate,
      round: { displayName: 'Round of 32' },
      status: { type: { state: 'pre' } },
      competitors: [
        tennisPlayer('9678', 'Holger Rune', 7),
        tennisPlayer('3897', 'Frances Tiafoe', 8),
      ],
    },
  ];

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ events: [atpEvent({ groupings: [mensSinglesGrouping(competitions)] })] }),
  });

  try {
    const specs = await generateTennisMarkets();
    const h2h = specs.filter(spec => spec.source === 'espn-atp-match');
    assert.equal(specs[0].source, 'espn-atp-tournament');
    assert.equal(h2h.length, 4);
    assert.equal(h2h[0].amm_mode, 'unified');
    assert.equal(h2h[0].resolver_config.source, 'espn-atp-match');
    assert.equal(h2h[0].resolver_config.matchId, 'match-1');
    assert.deepEqual(h2h[0].outcomes, ['Alexander Zverev', 'Taylor Fritz']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ATP generator skips H2H markets without a match-level date', async () => {
  const originalFetch = globalThis.fetch;
  const competitions = [
    {
      id: 'undated-qf',
      round: { displayName: 'Quarterfinal' },
      status: { type: { state: 'pre' } },
      competitors: [
        tennisPlayer('2375', 'Alexander Zverev', 1),
        tennisPlayer('2946', 'Taylor Fritz', 2),
      ],
    },
  ];

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      events: [
        atpEvent({
          date: futureIso(2),
          groupings: [mensSinglesGrouping(competitions)],
        }),
      ],
    }),
  });

  try {
    const specs = await generateTennisMarkets();
    assert.deepEqual(specs, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ATP generator can use competition startDate for H2H markets', async () => {
  const originalFetch = globalThis.fetch;
  const matchDate = futureIso(2);
  const competitions = [
    {
      id: 'start-date-qf',
      startDate: matchDate,
      round: { displayName: 'Quarterfinal' },
      status: { type: { state: 'pre' } },
      competitors: [
        tennisPlayer('9250', 'Ben Shelton', 3),
        tennisPlayer('10319', 'Jakub Mensik', 13),
      ],
    },
  ];

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      events: [
        atpEvent({
          date: futureIso(-7),
          groupings: [mensSinglesGrouping(competitions)],
        }),
      ],
    }),
  });

  try {
    const specs = await generateTennisMarkets();
    assert.equal(specs.length, 1);
    assert.equal(specs[0].source, 'espn-atp-match');
    assert.equal(specs[0].end_time, matchDate);
    assert.equal(specs[0].resolver_config.dateYmd, matchDate.slice(0, 10));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ATP generator still emits H2H markets once a top-tier tournament is in progress', async () => {
  const originalFetch = globalThis.fetch;
  const matchDate = futureIso(1);
  const competitions = [
    {
      id: 'qf-1',
      date: matchDate,
      round: { displayName: 'Quarterfinals' },
      status: { type: { state: 'pre' } },
      competitors: [
        tennisPlayer('2375', 'Alexander Zverev', 1),
        tennisPlayer('2946', 'Taylor Fritz', 2),
      ],
    },
    {
      id: 'qf-2',
      date: matchDate,
      round: { displayName: 'Quarterfinals' },
      status: { type: { state: 'pre' } },
      competitors: [
        tennisPlayer('9250', 'Ben Shelton', 3),
        tennisPlayer('3764', 'Lorenzo Musetti', 4),
      ],
    },
  ];

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      events: [
        atpEvent({
          state: 'in',
          date: futureIso(-7),
          endDate: futureIso(3),
          groupings: [mensSinglesGrouping(competitions)],
        }),
      ],
    }),
  });

  try {
    const specs = await generateTennisMarkets();
    const h2h = specs.filter(spec => spec.source === 'espn-atp-match');
    assert.equal(specs.some(spec => spec.source === 'espn-atp-tournament'), false);
    assert.equal(h2h.length, 2);
    assert.equal(h2h[0].source_data.roundLabel, 'Quarterfinals');
    assert.equal(h2h[0].resolver_config.matchId, 'qf-1');
    assert.deepEqual(h2h[0].outcomes, ['Alexander Zverev', 'Taylor Fritz']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ATP generator emits H2H when ESPN marks the tournament post but nested matches pre', async () => {
  const originalFetch = globalThis.fetch;
  const competitions = [
    {
      id: 'espn-qf-1',
      date: futureIso(1),
      startDate: futureIso(1),
      round: { id: '5', displayName: 'Quarterfinal' },
      status: { type: { state: 'pre', completed: false } },
      competitors: [
        tennisPlayer('10052', 'Arthur Fils', null),
        tennisPlayer('12657', 'Rafael Jodar', null),
      ],
    },
  ];

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      events: [
        atpEvent({
          state: 'post',
          date: futureIso(-9),
          endDate: futureIso(4),
          groupings: [mensSinglesGrouping(competitions)],
        }),
      ],
    }),
  });

  try {
    const specs = await generateTennisMarkets();
    assert.equal(specs.length, 1);
    assert.equal(specs[0].source, 'espn-atp-match');
    assert.equal(specs[0].resolver_config.matchId, 'espn-qf-1');
    assert.deepEqual(specs[0].outcomes, ['Arthur Fils', 'Rafael Jodar']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ATP generator skips top-tier tournaments until ESPN exposes a confirmed draw', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ events: [atpEvent({ groupings: [] })] }),
  });

  try {
    const specs = await generateTennisMarkets();
    assert.deepEqual(specs, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ATP field extraction ignores placeholder draw slots and dedupes players', () => {
  const field = extractAtpMensSinglesField(atpEvent({
    players: [
      tennisPlayer('2946', 'Taylor Fritz', 4),
      tennisPlayer('2946', 'Taylor Fritz', 2),
      tennisPlayer('bye', 'BYE', null),
      tennisPlayer('q1', 'Qualifier', null),
    ],
  }));

  assert.deepEqual(field.map(player => player.name), ['Taylor Fritz']);
  assert.equal(field[0].seed, 2);
});
