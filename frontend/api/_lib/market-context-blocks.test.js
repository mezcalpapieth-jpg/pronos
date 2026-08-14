import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachMarketContextBlocks,
  buildMarketContextBlocks,
  buildStaticMarketContextBlock,
  extractMarketSourceUrls,
} from './market-context-blocks.js';

test('buildStaticMarketContextBlock creates exact Yes/No criteria when source and criteria exist', () => {
  const result = buildStaticMarketContextBlock({
    question: '¿La inflación anual de México quedará por debajo de 3.00%?',
    category: 'mexico',
    outcomes: ['Sí', 'No'],
    end_time: '2026-08-10T12:00:00.000Z',
    resolver_config: {
      criteria: 'INEGI publica una inflación anual de México menor a 3.00% en su sala de prensa oficial',
      evidenceUrl: 'https://www.inegi.org.mx/app/saladeprensa/',
    },
  });

  assert.equal(result.missing.length, 0);
  assert.match(result.text, /\(see: https:\/\/www\.inegi\.org\.mx\/app\/saladeprensa\/\)/);
  assert.match(result.text, /This market will resolve to 'Yes' if/);
  assert.match(result.text, /Otherwise, this market will resolve to 'No\.'/);
  assert.ok(result.text.split(/\s+/).length < 80);
});

test('buildMarketContextBlocks does not fabricate a source or force multi-outcome markets into Yes/No', () => {
  const context = buildMarketContextBlocks({
    question: '¿En qué rango quedará la inflación anual de México?',
    category: 'mexico',
    outcomes: ['Menos de 3.00%', '3.00% a 3.49%', '3.50% a 3.99%', '4.00% o más'],
    end_time: '2026-08-10T12:00:00.000Z',
    resolver_config: {
      criteria: 'Seleccionar el rango que contenga el dato oficial publicado por INEGI.',
    },
  }, { now: new Date('2026-08-07T10:15:00.000Z') });

  assert.equal(context.contextResolutionCriteria, null);
  assert.ok(context.missing.includes('sourceUrl'));
  assert.ok(context.missing.includes('binaryYesNoOutcomes'));
  assert.match(context.dynamicSummary.disclaimer, /Updated 2026-08-07, 10:15 UTC$/);
});

test('attachMarketContextBlocks preserves existing source data and extracts evidence URLs', () => {
  const spec = attachMarketContextBlocks({
    question: '¿La canción X será #1?',
    category: 'musica',
    outcomes: ['Sí', 'No'],
    end_time: '2026-08-08T00:00:00.000Z',
    resolver_config: {
      criteria: 'la fuente oficial muestra la canción X en el puesto #1',
      evidence: [
        { title: 'Chart', url: 'https://soundcharts.com/es/charts/spotify/mexico' },
      ],
    },
    source_data: { weekKey: '2026-W32' },
  });

  assert.equal(spec.source_data.weekKey, '2026-W32');
  assert.equal(
    spec.source_data.contextBlocks.marketInput.sourceUrl,
    'https://soundcharts.com/es/charts/spotify/mexico',
  );
  assert.deepEqual(extractMarketSourceUrls(spec), ['https://soundcharts.com/es/charts/spotify/mexico']);
});
