import test from 'node:test';
import assert from 'node:assert/strict';

import { generateAiMarkets, _internal } from './ai.js';

test('AI generator emits monthly release, named release, lab model, and benchmark markets', async () => {
  const specs = await generateAiMarkets({ now: new Date('2026-10-06T12:00:00.000Z') });
  assert.equal(specs.length, 9);

  const byId = Object.fromEntries(specs.map(spec => [spec.source_event_id, spec]));
  const openai = byId['ai-release:2026-10:openai'];
  assert.ok(openai);
  assert.equal(openai.category, 'ai');
  assert.equal(openai.resolver_type, 'manual_review');
  assert.deepEqual(openai.outcomes, ['Sí', 'No']);
  assert.match(openai.question, /OpenAI/);
  assert.match(openai.resolver_config.criteria, /No cuentan rumores/);
  assert.equal(openai.source_data.translations.en.question, 'Will OpenAI release a new public AI model before October 2026 closes?');
  assert.deepEqual(openai.source_data.categorization.categoryTags, ['ai']);
  assert.deepEqual(openai.source_data.categorization.geoTags, ['world']);
  assert.deepEqual(openai.source_data.categorization.topicTags, ['ai']);
  assert.equal(openai.source_data.suggestedPricing.source, 'source-signals:ai');

  const google = byId['ai-release:2026-10:google'];
  assert.equal(google.resolver_config.labLabel, 'Google');
  assert.match(google.resolver_config.evidence[0].url, /blog\.google/);

  const anthropic = byId['ai-release:2026-10:anthropic'];
  assert.equal(anthropic.resolver_config.labLabel, 'Anthropic');
  assert.match(anthropic.resolver_config.evidence[0].url, /anthropic\.com\/news/);

  const topOpenAi = byId['ai-lab-top-model:2026-10:openai'];
  assert.ok(topOpenAi);
  assert.equal(topOpenAi.source, 'ai-lab-top-model');
  assert.deepEqual(topOpenAi.outcomes, ['GPT-6.1 Astra', 'GPT-6.1 Sol', 'GPT-6 Astra', 'GPT-5.6 Sol', 'Otro OpenAI']);
  assert.equal(topOpenAi.resolver_config.benchmark, _internal.BENCHMARK.key);
  assert.match(topOpenAi.resolver_config.criteria, /modelo público de texto de OpenAI/);
  assert.equal(topOpenAi.source_data.translations.en.outcomes.at(-1), 'Other OpenAI');

  const topAnthropic = byId['ai-lab-top-model:2026-10:anthropic'];
  assert.ok(topAnthropic);
  assert.ok(topAnthropic.outcomes.includes('Claude Fable 5.2+'));

  const topGoogle = byId['ai-lab-top-model:2026-10:google'];
  assert.ok(topGoogle);
  assert.ok(topGoogle.outcomes.includes('Gemini 4 Argon'));

  const astra = byId['ai-named-release:2026:gpt-astra-6-1'];
  assert.ok(astra);
  assert.equal(astra.source, 'ai-named-model-release');
  assert.deepEqual(astra.outcomes, ['Sí', 'No']);
  assert.match(astra.question, /GPT Astra 6\.1\+/);
  assert.match(astra.resolver_config.criteria, /versión 6\.1 o superior/);
  assert.match(astra.source_data.pricingHints.polymarketQuery, /GPT Astra 6\.1\+ released by 2026/);
  assert.match(astra.source_data.evidence[1].url, /polymarket\.com\/all\/astra/);

  const fable = byId['ai-named-release:2026:claude-fable-5-2'];
  assert.ok(fable);
  assert.match(fable.question, /Claude Fable 5\.2\+/);
  assert.match(fable.source_data.evidence[1].url, /polymarket\.com\/predictions\/fable/);

  const benchmark = byId['ai-benchmark:2026-10:artificial-analysis-index-lab'];
  assert.ok(benchmark);
  assert.equal(benchmark.source, 'ai-benchmark');
  assert.deepEqual(benchmark.outcomes, ['OpenAI', 'Google', 'Anthropic', 'xAI', 'Meta', 'Otro']);
  assert.equal(benchmark.resolver_config.benchmark, _internal.BENCHMARK.key);
  assert.match(benchmark.resolver_config.leaderboardUrl, /artificialanalysis\.ai\/leaderboards\/models/);
  assert.match(benchmark.resolver_config.criteria, /Artificial Analysis/);
  assert.equal(benchmark.source_data.translations.en.outcomes.at(-1), 'Other');
});
