import test from 'node:test';
import assert from 'node:assert/strict';

import { _internal } from './team-directory.js';

test('team directory logos include static logos and ESPN-resolved missing logos', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /\/soccer\/eng\.1\/teams$/);
    return {
      ok: true,
      json: async () => ({
        sports: [{
          leagues: [{
            teams: [{
              team: {
                id: '389',
                displayName: 'AFC Bournemouth',
                shortDisplayName: 'Bournemouth',
                logos: [{ href: 'bournemouth.png' }],
              },
            }],
          }],
        }],
      }),
    };
  };

  try {
    const logos = await _internal.buildDirectoryLogos([
      {
        sport: 'soccer',
        slug: 'bournemouth',
        name: 'Bournemouth',
        aliases: ['AFC Bournemouth'],
        espnLeaguePath: 'soccer/eng.1',
      },
      {
        sport: 'baseball',
        slug: 'acereros-de-monclova',
        name: 'Acereros de Monclova',
        logoUrl: 'acereros.png',
      },
    ]);

    assert.equal(logos['soccer:bournemouth'], 'bournemouth.png');
    assert.equal(logos['baseball:acereros-de-monclova'], 'acereros.png');
  } finally {
    global.fetch = originalFetch;
  }
});
