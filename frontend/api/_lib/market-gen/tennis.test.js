import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractAtpMensSinglesField,
  generateTennisMarkets,
} from './tennis.js';

function futureIso(days = 14) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function tennisPlayer(id, name, seed) {
  return {
    id: String(id),
    seed,
    athlete: {
      id: String(id),
      displayName: name,
    },
  };
}

function mensSinglesGrouping(players) {
  return {
    grouping: {
      slug: 'mens-singles',
      name: "Men's Singles",
    },
    competitions: [
      { competitors: players },
    ],
  };
}

function atpEvent({ id = 'national-bank-open', name = 'National Bank Open', players = [], groupings = null } = {}) {
  return {
    id,
    name,
    date: futureIso(10),
    endDate: futureIso(18),
    status: {
      type: {
        state: 'pre',
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
    assert.deepEqual(
      specs[0].resolver_config.legs.map(leg => leg.label),
      specs[0].outcomes,
    );
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
