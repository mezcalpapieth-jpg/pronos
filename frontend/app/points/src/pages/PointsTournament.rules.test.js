import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsTournament.jsx', import.meta.url), 'utf8');

test('tournament rules place new tournament features below the base rules', () => {
  assert.match(source, /Nuevos features/);
  assert.match(source, /New features/);
  assert.match(source, /Score formula/);
  assert.match(source, /Cómo se calcula/);
  assert.match(source, /Score = market PnL \+ conviction \+ liquidity \+ settled combos - inactivity/);
  assert.match(source, /Puntaje = PnL de mercados \+ convicción \+ liquidez \+ combinadas liquidadas - inactividad/);
  assert.match(source, /Winning tournament lots bought at/);
  assert.match(source, /Los lotes ganadores comprados a/);
  assert.match(source, /Create them from the Combinada button/);
  assert.match(source, /Se arman desde el botón Combinada/);
  assert.match(source, /recompensa por dar liquidez/);
  assert.match(source, /liquidity rewards/);
  assert.match(source, /weeklyRate: 0\.20/);
  assert.match(source, /\$\{liquidityRate\}% semanal/);
  assert.match(source, /\$\{liquidityRate\}% per week/);
  assert.match(source, /combo-slip PnL/);
  assert.match(source, /combinadas liquidadas/);
  assert.match(source, /max payout of/);
  assert.match(source, /tope de pago de/);

  const rulesIndex = source.indexOf('<RuleList lang={lang} rules={rules} />');
  const formulaIndex = source.indexOf('<ScoreFormulaPanel lang={lang} rules={rules} />');
  const featuresIndex = source.indexOf('<NewFeatureList lang={lang} rules={rules} />');
  const faqIndex = source.indexOf('<TournamentFaq lang={lang} rules={rules} />');
  assert.ok(rulesIndex > 0);
  assert.ok(formulaIndex > rulesIndex);
  assert.ok(featuresIndex > formulaIndex);
  assert.ok(faqIndex > featuresIndex);
});
