import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLcdlfNominationMarketSpecs,
  buildLcdlfResolutionReview,
  buildLcdlfWeeklyMarketSpec,
  extractResidentsFromIndexHtml,
  parseLcdlfResidentStatus,
  readLcdlfOfficialSnapshot,
} from './lcdlf-official.js';

test('parseLcdlfResidentStatus recognizes official status labels', () => {
  assert.equal(parseLcdlfResidentStatus('<span>EN CASA</span>').key, 'en_casa');
  assert.equal(parseLcdlfResidentStatus('<span>NOMINADA</span>').key, 'nominado');
  assert.equal(parseLcdlfResidentStatus('<span>Podría estar eliminado</span>').key, 'nominado');
  assert.equal(parseLcdlfResidentStatus('<span>LÍDER DE LA SEMANA</span>').key, 'lider_semana');
  assert.equal(parseLcdlfResidentStatus('<span>ELIMINADO</span>').key, 'eliminado');
});

test('parseLcdlfResidentStatus only reads scoped resident profile badges', () => {
  const aldoPage = `
    <main>
      <section>
        <h1><a href="/habitantes/aldo-rendon">Aldo Rendón</a></h1>
        <p>Aldo sigue en competencia.</p>
      </section>
      <section>
        <article>Aldo, Karina y Gema se preocupan por saber si saldrán nominadas.</article>
        <article>La Casa espera saber si Masad será o no eliminado.</article>
      </section>
    </main>
  `;
  const ximenaPage = `
    <main>
      <section>
        <figure><span>ELIMINADA</span></figure>
        <h1><a href="/habitantes/ximena-herrera">Ximena Herrera</a></h1>
      </section>
      <section><article>Otros habitantes nominados.</article></section>
    </main>
  `;

  assert.equal(parseLcdlfResidentStatus(aldoPage, { name: 'Aldo Rendón', slug: 'aldo-rendon' }), null);
  assert.equal(parseLcdlfResidentStatus(ximenaPage, { name: 'Ximena Herrera', slug: 'ximena-herrera' }).key, 'eliminado');
});

test('extractResidentsFromIndexHtml finds official resident profile links', () => {
  const rows = extractResidentsFromIndexHtml(`
    <a href="/habitantes/ernesto-laguardia"><strong>Ernesto Laguardia</strong></a>
    <a href="https://www.lacasadelosfamososmexico.tv/habitantes/memo-schutz">Memo Schutz</a>
  `);

  assert.deepEqual(rows.map(row => row.slug), ['ernesto-laguardia', 'memo-schutz']);
  assert.deepEqual(rows.map(row => row.name), ['Ernesto Laguardia', 'Memo Schutz']);
});

test('extractResidentsFromIndexHtml uses card titles and scoped card badges', () => {
  const rows = extractResidentsFromIndexHtml(`
    <article data-card-title="Ximena Herrera">
      <a href="/habitantes/ximena-herrera"><span>ELIMINADA</span> Ximena Herrera Actriz Ver más</a>
    </article>
    <article data-card-title="Masad Altamimi">
      <a href="/habitantes/masad-altamimi">Masad Altamimi Ver más</a>
      <p>En vivo desde La Casa.</p>
    </article>
    <article data-card-title="Memo Schutz">
      <a href="/habitantes/memo-schutz">Memo Schutz Ver más</a>
    </article>
  `);

  assert.deepEqual(rows.map(row => row.name), ['Ximena Herrera', 'Masad Altamimi', 'Memo Schutz']);
  assert.deepEqual(rows.map(row => row.statusKey), ['eliminado', null, null]);
});

test('readLcdlfOfficialSnapshot merges discovered cards with configured full roster', async () => {
  const previousResidents = process.env.LCDLF_RESIDENTS_JSON;
  const previousDiscover = process.env.LCDLF_DISCOVER_RESIDENTS;
  try {
    delete process.env.LCDLF_DISCOVER_RESIDENTS;
    process.env.LCDLF_RESIDENTS_JSON = JSON.stringify([
      { name: 'Mariana Ochoa', slug: 'mariana-ochoa' },
      { name: 'Ximena Herrera', slug: 'ximena-herrera' },
      { name: 'Masad Altamimi', slug: 'masad-altamimi' },
    ]);

    const fetchImpl = async (url) => {
      if (!String(url).includes('/habitantes/')) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <article data-card-title="Ximena Herrera">
              <a href="/habitantes/ximena-herrera"><span>ELIMINADA</span> Ximena Herrera Ver más</a>
            </article>
            <article data-card-title="Masad Altamimi"><a href="/habitantes/masad-altamimi">Masad Altamimi</a></article>
            <article data-card-title="Aldo Rendón"><a href="/habitantes/aldo-rendon">Aldo Rendón</a></article>
            <article data-card-title="Yahir"><a href="/habitantes/yahir">Yahir</a></article>
            <article data-card-title="Memo Schutz"><a href="/habitantes/memo-schutz">Memo Schutz</a></article>
            <article data-card-title="Fede Vigevani"><a href="/habitantes/fede-vigevani">Fede Vigevani</a></article>
          `,
        };
      }
      const slug = String(url).split('/habitantes/')[1]?.split('?')[0];
      const badge = slug === 'mariana-ochoa' ? '<span>ELIMINADA</span>' : '';
      const title = slug === 'mariana-ochoa' ? 'Mariana Ochoa'
        : slug === 'ximena-herrera' ? 'Ximena Herrera'
          : slug === 'masad-altamimi' ? 'Masad Altamimi'
            : 'Habitante';
      return {
        ok: true,
        status: 200,
        text: async () => `<main><section>${badge}<h1><a href="/habitantes/${slug}">${title}</a></h1></section></main>`,
      };
    };

    const snapshot = await readLcdlfOfficialSnapshot({
      fetchImpl,
      baseUrl: 'https://example.com',
      now: new Date('2026-08-10T12:00:00Z'),
    });

    assert.equal(snapshot.total, 7);
    assert.equal(snapshot.ok, true);
    assert.deepEqual(snapshot.eliminated.map(row => row.name), ['Ximena Herrera', 'Mariana Ochoa']);
  } finally {
    if (previousResidents === undefined) delete process.env.LCDLF_RESIDENTS_JSON;
    else process.env.LCDLF_RESIDENTS_JSON = previousResidents;
    if (previousDiscover === undefined) delete process.env.LCDLF_DISCOVER_RESIDENTS;
    else process.env.LCDLF_DISCOVER_RESIDENTS = previousDiscover;
  }
});

test('buildLcdlfWeeklyMarketSpec creates a manual-review market from nominees', () => {
  const now = new Date('2026-08-10T12:00:00Z');
  const snapshot = {
    ok: true,
    sourceUrl: 'https://www.lacasadelosfamososmexico.tv',
    observedAt: now.toISOString(),
    parsedCount: 3,
    total: 3,
    rows: [
      { name: 'Ernesto Laguardia', slug: 'ernesto-laguardia', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/ernesto' },
      { name: 'Memo Schutz', slug: 'memo-schutz', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/memo' },
      { name: 'Yahir', slug: 'yahir', statusKey: 'en_casa', statusLabel: 'En casa', url: 'https://example.com/yahir' },
    ],
    nominated: [
      { name: 'Ernesto Laguardia', statusLabel: 'Nominado/a', url: 'https://example.com/ernesto' },
      { name: 'Memo Schutz', statusLabel: 'Nominado/a', url: 'https://example.com/memo' },
    ],
    eliminated: [],
    active: [],
  };

  const spec = buildLcdlfWeeklyMarketSpec({ snapshot, now });
  assert.equal(spec.source, 'lcdlf-official');
  assert.equal(spec.resolver_type, 'manual_review');
  assert.deepEqual(spec.outcomes, ['Ernesto Laguardia', 'Memo Schutz']);
  assert.equal(spec.category, 'musica');
  assert.deepEqual(spec.topic_tags, ['tv', 'farandula']);
  assert.match(spec.source_event_id, /^lcdlf-mx-elimination:/);
  assert.equal(spec.resolver_config.requireHumanConfirmation, true);
});

test('buildLcdlfNominationMarketSpecs creates one parallel market from active residents before nominees are official', () => {
  const now = new Date('2026-08-12T18:00:00Z');
  const snapshot = {
    ok: true,
    sourceUrl: 'https://www.lacasadelosfamososmexico.tv',
    observedAt: now.toISOString(),
    parsedCount: 2,
    total: 4,
    rows: [
      { name: 'Fede Vigevani', slug: 'fede-vigevani', ok: true, statusKey: 'eliminado', statusLabel: 'Eliminado/a', url: 'https://example.com/fede' },
      { name: 'Brianda Deyanara', slug: 'brianda-deyanara', ok: true, statusKey: 'lider_semana', statusLabel: 'Líder de la semana', url: 'https://example.com/brianda' },
      { name: 'Flor Vigna', slug: 'flor-vigna', ok: true, statusKey: null, statusLabel: null, url: 'https://example.com/flor' },
      { name: 'Yahir', slug: 'yahir', ok: true, statusKey: 'en_casa', statusLabel: 'En casa', url: 'https://example.com/yahir' },
    ],
    active: [
      { name: 'Brianda Deyanara', slug: 'brianda-deyanara', ok: true, statusKey: 'lider_semana', statusLabel: 'Líder de la semana', url: 'https://example.com/brianda' },
      { name: 'Flor Vigna', slug: 'flor-vigna', ok: true, statusKey: null, statusLabel: null, url: 'https://example.com/flor' },
      { name: 'Yahir', slug: 'yahir', ok: true, statusKey: 'en_casa', statusLabel: 'En casa', url: 'https://example.com/yahir' },
    ],
    nominated: [],
    eliminated: [
      { name: 'Fede Vigevani', slug: 'fede-vigevani', ok: true, statusKey: 'eliminado', statusLabel: 'Eliminado/a', url: 'https://example.com/fede' },
    ],
  };

  const specs = buildLcdlfNominationMarketSpecs({ snapshot, now });

  assert.equal(specs.length, 1);
  assert.deepEqual(specs[0].outcomes, ['Brianda Deyanara', 'Flor Vigna', 'Yahir']);
  assert.equal(specs[0].amm_mode, 'parallel');
  assert.equal(specs[0].resolver_type, 'api_lcdlf');
  assert.equal(specs[0].resolver_config.shape, 'parallel-status');
  assert.equal(specs[0].resolver_config.statusKey, 'nominado');
  assert.deepEqual(
    specs[0].resolver_config.legs.map(leg => leg.residentSlug),
    ['brianda-deyanara', 'flor-vigna', 'yahir'],
  );
  assert.equal(specs[0].resolver_config.nominationMinStatusCount, 2);
  assert.equal(specs[0].source_data.kind, 'lcdlf_nomination');
  assert.match(specs[0].source_event_id, /^lcdlf-mx-nomination:/);
  assert.ok(!specs[0].question.includes('Fede Vigevani'));
  assert.deepEqual(specs[0].source_data.suggestedPricing.legProbabilityPct, [32, 32, 32]);
});

test('buildLcdlfResolutionReview suggests the eliminated nominee only after official evidence', async () => {
  const now = new Date('2026-08-10T12:00:00Z');
  const snapshot = {
    ok: true,
    sourceUrl: 'https://www.lacasadelosfamososmexico.tv',
    observedAt: now.toISOString(),
    parsedCount: 2,
    total: 2,
    rows: [
      { name: 'Ernesto Laguardia', slug: 'ernesto-laguardia', statusKey: 'en_casa', statusLabel: 'En casa', url: 'https://example.com/ernesto' },
      { name: 'Memo Schutz', slug: 'memo-schutz', statusKey: 'eliminado', statusLabel: 'Eliminado/a', url: 'https://example.com/memo' },
    ],
    nominated: [],
    eliminated: [
      { name: 'Memo Schutz', slug: 'memo-schutz', statusKey: 'eliminado', statusLabel: 'Eliminado/a', url: 'https://example.com/memo' },
    ],
    active: [],
  };

  const review = await buildLcdlfResolutionReview({
    market: { id: 123, source_event_id: 'lcdlf-mx-elimination:2026-08-16' },
    cfg: {},
    sourceData: { kind: 'lcdlf_week' },
    outcomes: ['Ernesto Laguardia', 'Memo Schutz'],
    snapshot,
    now,
  });

  assert.equal(review.resolverConfigPatch.suggestedOutcomeIndex, 1);
  assert.equal(review.resolverConfigPatch.confidenceBps, 8500);
  assert.match(review.resolverConfigPatch.rationale, /Memo Schutz/);
  assert.equal(review.resolverConfigPatch.evidenceUrl, 'https://example.com/memo');
});
