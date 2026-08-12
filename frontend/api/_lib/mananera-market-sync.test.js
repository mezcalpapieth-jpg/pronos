import test from 'node:test';
import assert from 'node:assert/strict';

import { MANANERA_TRANSCRIPT_SOURCE } from './mananera.js';
import {
  extractFirstQuotedPhrase,
  syncMananeraPhraseFromQuestion,
} from './mananera-market-sync.js';

test('extractFirstQuotedPhrase reads straight and curly quoted phrases', () => {
  assert.equal(
    extractFirstQuotedPhrase('¿La presidenta mencionará "huachicol" en la mañanera?'),
    'huachicol',
  );
  assert.equal(
    extractFirstQuotedPhrase('¿La presidenta mencionará “seguridad pública” en la mañanera?'),
    'seguridad pública',
  );
});

test('syncMananeraPhraseFromQuestion updates resolver phrase from the market title', () => {
  const result = syncMananeraPhraseFromQuestion({
    question: '¿La presidenta mencionará "huachicol" en la mañanera del 13/08/2026?',
    resolverConfig: {
      source: MANANERA_TRANSCRIPT_SOURCE,
      phrase: 'aranceles',
      criteria: 'la versión oficial contiene "aranceles" al menos una vez',
    },
    sourceData: {
      kind: 'mananera_phrase',
      phrase: 'aranceles',
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.phrase, 'huachicol');
  assert.equal(result.resolverConfig.phrase, 'huachicol');
  assert.equal(result.resolverConfig.criteria, 'la versión oficial contiene "huachicol" al menos una vez');
  assert.equal(result.sourceData.phrase, 'huachicol');
});

test('syncMananeraPhraseFromQuestion ignores non-mananera resolvers', () => {
  const resolverConfig = { source: 'espn', phrase: 'aranceles' };
  const result = syncMananeraPhraseFromQuestion({
    question: '¿La presidenta mencionará "huachicol"?',
    resolverConfig,
  });

  assert.equal(result.changed, false);
  assert.equal(result.resolverConfig, resolverConfig);
});
