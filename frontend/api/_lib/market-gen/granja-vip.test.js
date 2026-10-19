import test from 'node:test';
import assert from 'node:assert/strict';

import { generateGranjaVipMarkets } from './granja-vip.js';

test('generateGranjaVipMarkets drafts one elimination market after Friday final nominees are official', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => `
      <meta property="article:published_time" content="2026-09-12T03:00:00Z">
      <article><h1>Lista FINAL de nominados de La Granja VIP</h1>
      <p>Actualmente los nominados son: Carlos Trejo, Ivonne Montero y Kunno.</p></article>
      <h3>Granjeros: La Granja VIP Segunda Temporada</h3>
      <a href="/aztecauno/la-granja-vip/carlos-trejo">Carlos Trejo</a>
      <a href="/aztecauno/la-granja-vip/ivonne-montero">Ivonne Montero</a>
      <a href="/aztecauno/la-granja-vip/kunno">Kunno</a>
      <a href="/aztecauno/la-granja-vip/mono-osuna">Mono Osuna</a>
      <a href="/aztecauno/la-granja-vip/pascal-nadaud">Pascal Nadaud</a>
      <a href="/aztecauno/la-granja-vip/pimpinela-escarlata">Pimpinela Escarlata</a>
      <h3>Conductores | La Granja VIP Segunda Temporada | Críticos</h3>
      <a href="/aztecauno/la-granja-vip/nominados">
        Carlos Trejo, Ivonne Montero y Kunno son los nominados de La Granja VIP
      </a>
    `,
  });

  const specs = await generateGranjaVipMarkets({
    now: new Date('2026-09-12T18:00:00Z'),
    fetchImpl,
  });

  assert.equal(specs.length, 1);
  assert.equal(specs[0].source, 'granja-vip-official');
  assert.deepEqual(specs[0].outcomes, ['Carlos Trejo', 'Ivonne Montero', 'Kunno']);
  assert.equal(specs[0].resolver_type, 'api_chart');
  assert.equal(specs[0].source_data.suggestedPricing.source, 'granja-vip-official:granja-vip-elimination');
  assert.deepEqual(specs[0].source_data.suggestedPricing.probabilityPct, [33.3, 33.3, 33.3]);
});

test('generateGranjaVipMarkets stays quiet before nominee evidence appears', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => `
      <h3>Granjeros: La Granja VIP Segunda Temporada</h3>
      <a href="/aztecauno/la-granja-vip/carlos-trejo">Carlos Trejo</a>
      <a href="/aztecauno/la-granja-vip/ivonne-montero">Ivonne Montero</a>
      <a href="/aztecauno/la-granja-vip/kunno">Kunno</a>
      <a href="/aztecauno/la-granja-vip/mono-osuna">Mono Osuna</a>
      <a href="/aztecauno/la-granja-vip/pascal-nadaud">Pascal Nadaud</a>
      <a href="/aztecauno/la-granja-vip/pimpinela-escarlata">Pimpinela Escarlata</a>
      <h3>Conductores | La Granja VIP Segunda Temporada | Críticos</h3>
    `,
  });

  const specs = await generateGranjaVipMarkets({
    now: new Date('2026-09-09T18:00:00Z'),
    fetchImpl,
  });

  assert.deepEqual(specs, []);
});

test('generateGranjaVipMarkets drafts Capataz only for the dated official finalists', async () => {
  const fetchImpl = async url => ({ ok: true, status: 200, text: async () => String(url).includes('finalistas-capataz')
    ? `<meta property="article:published_time" content="2026-10-19T21:45:00Z">
      <article><h1>Estos son los finalistas de la prueba de Capataz</h1>
      <p>La final reunirá a Pablo Montero, Ivonne Montero, Julio Camejo y Bebeshita.</p></article>`
    : `<h3>Granjeros: La Granja VIP Segunda Temporada</h3>
      <a href="/aztecauno/la-granja-vip/pablo-montero">Pablo Montero</a>
      <a href="/aztecauno/la-granja-vip/ivonne-montero">Ivonne Montero</a>
      <a href="/aztecauno/la-granja-vip/julio-camejo">Julio Camejo</a>
      <a href="/aztecauno/la-granja-vip/daniela-alexis-bebeshita">Daniela Alexis "Bebeshita"</a>
      <a href="/aztecauno/la-granja-vip/carlos-trejo">Carlos Trejo</a>
      <a href="/aztecauno/la-granja-vip/mono-osuna">Mono Osuna</a>
      <h3>Conductores</h3><a href="/aztecauno/la-granja-vip/finalistas-capataz">Finalistas Capataz</a>` });
  const specs = await generateGranjaVipMarkets({ now: new Date('2026-10-19T23:00:00Z'), fetchImpl });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].source_event_id, 'granja-vip-capataz:2026-10-19');
  assert.equal(specs[0].resolver_config.kind, 'granja-vip-capataz');
  assert.equal(specs[0].end_time, '2026-10-20T02:25:00.000Z');
  assert.deepEqual(specs[0].outcomes, ['Pablo Montero', 'Ivonne Montero', 'Julio Camejo', 'Daniela Alexis "Bebeshita"']);
  assert.deepEqual(specs[0].source_data.suggestedPricing.probabilityPct, [25, 25, 25, 25]);
  assert.deepEqual(await generateGranjaVipMarkets({ now: new Date('2026-10-20T03:00:00Z'), fetchImpl }), []);
});
