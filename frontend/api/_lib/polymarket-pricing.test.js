import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldUsePolymarketPricing,
  tryAttachPolymarketPricing,
} from './polymarket-pricing.js';

function jsonResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    },
  };
}

function makeFetch(routes, calls = []) {
  return async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, init });
    const route = routes.find(item => href.includes(item.match) && (!item.method || item.method === (init.method || 'GET')));
    if (!route) {
      return { ok: false, async json() { return {}; } };
    }
    const payload = typeof route.payload === 'function'
      ? route.payload({ url: href, init })
      : route.payload;
    return jsonResponse(payload);
  };
}

test('Polymarket pricing attaches CLOB midpoint probabilities to a matching binary market', async () => {
  const fetchImpl = makeFetch([
    {
      match: '/public-search?',
      payload: {
        events: [{ id: '90177', slug: 'spiderman-trailer-before-august', title: 'Spider-Man trailer before August?' }],
      },
    },
    {
      match: '/events/90177',
      payload: {
        id: '90177',
        slug: 'spiderman-trailer-before-august',
        title: 'Spider-Man trailer before August?',
        markets: [{
          id: '703257',
          slug: 'spiderman-trailer-before-august',
          question: 'Will Spider-Man Brand New Day release a trailer before August?',
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.58","0.42"]',
          clobTokenIds: '["yes-token","no-token"]',
        }],
      },
    },
    {
      match: '/midpoints',
      method: 'POST',
      payload: {
        'yes-token': '0.61',
        'no-token': '0.39',
      },
    },
    {
      match: '/spreads',
      method: 'POST',
      payload: {
        'yes-token': '0.02',
        'no-token': '0.02',
      },
    },
  ]);

  const priced = await tryAttachPolymarketPricing({
    source: 'manual',
    source_event_id: 'spiderman-trailer',
    question: 'Will Spider-Man Brand New Day release a trailer before August?',
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1000,
    source_data: {
      suggestedPricing: {
        source: 'uniform-default',
        probabilities: [0.5, 0.5],
      },
    },
  }, { fetchImpl });

  const pricing = priced.source_data.suggestedPricing;
  assert.equal(pricing.source, 'polymarket:midpoint');
  assert.deepEqual(pricing.probabilityPct, [61, 39]);
  assert.notDeepEqual(pricing.seedLiquidities, [1000, 1000]);
  assert.equal(pricing.evidence[0].source, 'polymarket');
  assert.equal(pricing.evidence[0].eventSlug, 'spiderman-trailer-before-august');
});

test('Polymarket pricing can normalize several Polymarket yes markets into one Pronos market', async () => {
  const fetchImpl = makeFetch([
    {
      match: '/public-search?',
      payload: {
        events: [{ id: '200', slug: 'premios-juventud-winner', title: 'Premios Juventud winner markets' }],
      },
    },
    {
      match: '/events/200',
      payload: {
        id: '200',
        slug: 'premios-juventud-winner',
        title: 'Premios Juventud winner markets',
        markets: [
          {
            id: '1',
            slug: 'bad-bunny-wins-premios-juventud',
            question: 'Will Bad Bunny win Premios Juventud artist of the year?',
            outcomes: { yes: { tokenId: 'bad-bunny-yes' }, no: { tokenId: 'bad-bunny-no' } },
            outcomePrices: '["0.52","0.48"]',
          },
          {
            id: '2',
            slug: 'karol-g-wins-premios-juventud',
            question: 'Will Karol G win Premios Juventud artist of the year?',
            outcomes: { yes: { tokenId: 'karol-yes' }, no: { tokenId: 'karol-no' } },
            outcomePrices: '["0.34","0.66"]',
          },
        ],
      },
    },
    {
      match: '/midpoints',
      method: 'POST',
      payload: {
        'bad-bunny-yes': '0.5',
        'bad-bunny-no': '0.5',
        'karol-yes': '0.3',
        'karol-no': '0.7',
      },
    },
    {
      match: '/spreads',
      method: 'POST',
      payload: {
        'bad-bunny-yes': '0.04',
        'bad-bunny-no': '0.04',
        'karol-yes': '0.04',
        'karol-no': '0.04',
      },
    },
  ]);

  const priced = await tryAttachPolymarketPricing({
    question: '¿Quién gana artista del año en Premios Juventud?',
    outcomes: ['Bad Bunny', 'Karol G', 'Otro'],
    seed_liquidity: 900,
    source_data: {
      suggestedPricing: {
        source: 'source-signals:entertainment',
        probabilities: [1 / 3, 1 / 3, 1 / 3],
      },
    },
  }, { fetchImpl, minScore: 0.35 });

  const pricing = priced.source_data.suggestedPricing;
  assert.equal(pricing.source, 'polymarket:midpoint');
  assert.equal(pricing.probabilityPct.length, 3);
  assert.ok(pricing.probabilityPct[0] > pricing.probabilityPct[1]);
  assert.ok(pricing.probabilityPct[2] < 10);
  assert.equal(pricing.evidence[0].type, 'parallel');
});

test('Polymarket pricing does not override strong existing pricing sources', async () => {
  const calls = [];
  const fetchImpl = makeFetch([], calls);
  const spec = {
    question: '¿Quién gana el partido?',
    outcomes: ['A', 'B'],
    source_data: {
      suggestedPricing: {
        source: 'the-odds-api:h2h',
        probabilities: [0.6, 0.4],
      },
    },
  };

  assert.equal(shouldUsePolymarketPricing(spec), false);
  const priced = await tryAttachPolymarketPricing(spec, { fetchImpl });
  assert.equal(priced, spec);
  assert.equal(calls.length, 0);
});

