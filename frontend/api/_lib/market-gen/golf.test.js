import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractGolfEventField,
  generateGolfMarkets,
} from './golf.js';

function futureIso(days = 14) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function golfer(id, name, order) {
  return {
    id: String(id),
    type: 'athlete',
    order,
    athlete: {
      id: String(id),
      displayName: name,
    },
  };
}

function golfEvent({ id = 'pga-event', name = 'National Bank Open', competitors = [] } = {}) {
  return {
    id,
    name,
    date: futureIso(10),
    status: {
      type: {
        state: 'pre',
      },
    },
    competitions: [
      { competitors },
    ],
  };
}

test('PGA generator uses confirmed ESPN competitors, not the static ranking list', async () => {
  const originalFetch = globalThis.fetch;
  const competitors = [
    golfer('3470', 'Rory McIlroy', 1),
    golfer('10140', 'Xander Schauffele', 2),
    golfer('4375972', 'Ludvig Åberg', 3),
    golfer('4364873', 'Viktor Hovland', 4),
    golfer('10592', 'Collin Morikawa', 5),
    golfer('5860', 'Hideki Matsuyama', 6),
    golfer('5539', 'Tommy Fleetwood', 7),
    golfer('6007', 'Patrick Cantlay', 8),
    golfer('9938', 'Sam Burns', 9),
    golfer('5467', 'Jordan Spieth', 10),
  ];

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ events: [golfEvent({ competitors })] }),
  });

  try {
    const specs = await generateGolfMarkets();
    assert.equal(specs.length, 1);
    assert.equal(specs[0].source_data.fieldSource, 'espn-scoreboard-competitors');
    assert.equal(specs[0].source_data.confirmedFieldSize, competitors.length);
    assert.equal(specs[0].source_data.rankingFallbackDisabled, true);
    assert.equal(specs[0].source_data.listedFieldSize, competitors.length);
    assert.equal(specs[0].source_data.fieldCap, 40);
    assert.equal(specs[0].source_data.suggestedPricing.probabilities.length, specs[0].outcomes.length);
    assert.equal(specs[0].outcomes.includes('Scottie Scheffler'), false);
    assert.equal(specs[0].outcomes.includes('Rory McIlroy'), true);
    assert.equal(specs[0].outcomes.at(-1), 'Otro');
    assert.deepEqual(
      specs[0].resolver_config.legs.map(leg => leg.label),
      specs[0].outcomes,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PGA generator caps large confirmed fields at 40 listed golfers plus Otro', async () => {
  const originalFetch = globalThis.fetch;
  const competitors = Array.from({ length: 45 }, (_, index) =>
    golfer(String(9000 + index), `Golfer ${index + 1}`, index + 1),
  );

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ events: [golfEvent({ competitors })] }),
  });

  try {
    const specs = await generateGolfMarkets();
    assert.equal(specs.length, 1);
    assert.equal(specs[0].source_data.confirmedFieldSize, 45);
    assert.equal(specs[0].source_data.listedFieldSize, 40);
    assert.equal(specs[0].outcomes.length, 41);
    assert.equal(specs[0].outcomes.at(-1), 'Otro');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PGA generator skips tournaments until ESPN exposes a confirmed field', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ events: [golfEvent({ competitors: [] })] }),
  });

  try {
    const specs = await generateGolfMarkets();
    assert.deepEqual(specs, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PGA field extraction keeps team-format entrants label-matchable', () => {
  const field = extractGolfEventField(golfEvent({
    competitors: [
      {
        id: 'team-1',
        type: 'team',
        order: 1,
        team: {
          displayName: 'Smalley/Springer',
          logo: 'team.png',
        },
      },
      {
        id: 'placeholder',
        type: 'athlete',
        athlete: {
          id: 'placeholder',
          displayName: 'TBD',
        },
      },
    ],
  }));

  assert.deepEqual(field.map(player => ({
    id: player.id,
    name: player.name,
    type: player.type,
    logo: player.logo,
  })), [
    {
      id: null,
      name: 'Smalley/Springer',
      type: 'team',
      logo: 'team.png',
    },
  ]);
});
