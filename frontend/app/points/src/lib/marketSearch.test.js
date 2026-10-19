import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesMarketSearch, normalizeSearchText } from './marketSearch.js';

test('market search ignores accents in either the title or query', () => {
  for (const query of ['Mexico', 'MÉXICO', '  méxico  ', 'Me\u0301xico']) {
    assert.equal(matchesMarketSearch({ question: '¿Ganará México el torneo?' }, query), true);
    assert.equal(matchesMarketSearch({ question: '¿Ganará Mexico el torneo?' }, query), true);
  }
  assert.equal(matchesMarketSearch({ question: 'España: clasificación de Fórmula 1' }, 'espana'), true);
  assert.equal(matchesMarketSearch({ question: 'España: clasificación de Fórmula 1' }, 'formula'), true);
  assert.equal(matchesMarketSearch({ question: 'España: clasificación de Fórmula 1' }, 'clasificacion'), true);
});

test('market search preserves substring matching and unrelated letters', () => {
  assert.equal(matchesMarketSearch({ question: 'Street Fighter' }, 'fighter'), true);
  assert.equal(matchesMarketSearch({ question: 'Street Fighter' }, 'mexico'), false);
  assert.equal(matchesMarketSearch({ question: 'México' }, ''), true);
  assert.equal(matchesMarketSearch(null, 'mexico'), false);
  assert.equal(normalizeSearchText(null), '');
  assert.equal(normalizeSearchText('東京'), '東京');
});
