import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeNewsText, fetchNews } from './newsApi.js';

test('decodeNewsText cleans numeric and double-encoded news entities', () => {
  assert.equal(
    decodeNewsText('Lo traicionaron las fotos: FBI captura a &amp;#039;El 18&amp;#039;'),
    "Lo traicionaron las fotos: FBI captura a 'El 18'",
  );
  assert.equal(
    decodeNewsText('&amp;#8216;Ovidio&amp;#8217; y Ferrari &amp;amp; mercados'),
    '‘Ovidio’ y Ferrari & mercados',
  );
});

test('fetchNews returns decoded titles and summaries for shared globe consumers', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      items: [
        {
          title: 'Lo traicionaron las fotos: FBI captura a &amp;#039;El 18&amp;#039;',
          summary: 'Señales de Ovidio &amp;amp; Sinaloa',
          sourceName: 'Milenio',
        },
      ],
    }),
  });

  try {
    const payload = await fetchNews({ category: 'featured', limit: 1 });
    assert.equal(payload.items[0].title, "Lo traicionaron las fotos: FBI captura a 'El 18'");
    assert.equal(payload.items[0].summary, 'Señales de Ovidio & Sinaloa');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
