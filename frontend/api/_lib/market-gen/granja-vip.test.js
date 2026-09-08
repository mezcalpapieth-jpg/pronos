import test from 'node:test';
import assert from 'node:assert/strict';

import { generateGranjaVipMarkets } from './granja-vip.js';

test('generateGranjaVipMarkets drafts one elimination market when nominees are official', async () => {
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
      <a href="/aztecauno/la-granja-vip/nominados">
        Carlos Trejo, Ivonne Montero y Kunno son los nominados de La Granja VIP
      </a>
    `,
  });

  const specs = await generateGranjaVipMarkets({
    now: new Date('2026-09-09T18:00:00Z'),
    fetchImpl,
  });

  assert.equal(specs.length, 1);
  assert.equal(specs[0].source, 'granja-vip-official');
  assert.deepEqual(specs[0].outcomes, ['Carlos Trejo', 'Ivonne Montero', 'Kunno']);
  assert.equal(specs[0].resolver_type, 'manual_review');
  assert.equal(specs[0].source_data.suggestedPricing.source, 'granja-vip-official:nominated');
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
