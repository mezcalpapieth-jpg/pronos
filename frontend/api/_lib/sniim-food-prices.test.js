import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSniimAvocadoHassCdmx,
  parseSniimTortillaNational,
  parseSniimWhiteEggCdmx,
  parseSniimWhiteCornCdmx,
  readSniimFoodPrice,
  readSniimAvocadoHassCdmx,
  readSniimTortillaNational,
  readSniimWhiteEggCdmx,
  readSniimWhiteCornCdmx,
} from './sniim-food-prices.js';

function htmlResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    arrayBuffer: async () => {
      const bytes = Buffer.from(body, 'latin1');
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

test('SNIIM tortilla parser reads latest national tortilleria value', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const html = `
    <table>
      <tr><td>Precios de Tortilla en Tortillerias por ciudad 1/</td></tr>
      <tr><th>Ciudad</th><th>01-Oct</th><th>31-Oct</th></tr>
      <tr><td>Nacional Ponderado PPP</td><td>24.50</td><td>25.10</td></tr>
      <tr><td>Precios de Tortilla en Autoservicios</td></tr>
      <tr><td>Nacional Ponderado PPP</td><td>20.00</td><td>20.20</td></tr>
    </table>
  `;

  const parsed = parseSniimTortillaNational(html, {
    targetYear: 2026,
    targetMonth: 10,
    sourceUrl: 'https://example.test/tortilla',
  });
  assert.equal(parsed.value, 25.10);
  assert.equal(parsed.dateYmd, '2026-10-31');
  assert.equal(parsed.market, 'Nacional ponderado PPP');

  globalThis.fetch = async (url) => {
    assert.match(String(url), /TortillaMesPorDia\.asp/);
    assert.match(String(url), /prod=T/);
    assert.match(String(url), /dqMesMes=10/);
    return htmlResponse(html);
  };

  const read = await readSniimTortillaNational({ targetYear: 2026, targetMonth: 10 });
  assert.equal(read.value, 25.10);
});

test('SNIIM avocado parser reads latest CDMX frequent wholesale price', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const html = `
    <table>
      <tr><th>Fecha</th><th>Presentacion</th><th>Origen</th><th>Destino</th><th>Min</th><th>Max</th><th>Precio Frec</th></tr>
      <tr><td>28/10/2026</td><td>Caja de 9 kg.</td><td>Michoacan</td><td>DF: Central de Abasto de Iztapalapa DF</td><td>32.22</td><td>38.89</td><td>36.67</td></tr>
      <tr><td>30/10/2026</td><td>Caja de 9 kg.</td><td>Michoacan</td><td>DF: Central de Abasto de Iztapalapa DF</td><td>50.00</td><td>60.00</td><td>55.50</td></tr>
    </table>
  `;

  const parsed = parseSniimAvocadoHassCdmx(html, { dateEndYmd: '2026-10-31' });
  assert.equal(parsed.value, 55.50);
  assert.equal(parsed.dateYmd, '2026-10-30');
  assert.equal(parsed.presentation, 'Caja de 9 kg.');

  globalThis.fetch = async (url) => {
    assert.match(String(url), /ResultadosConsultaFechaFrutasYHortalizas\.aspx/);
    assert.match(String(url), /ProductoId=133/);
    assert.match(String(url), /fechaInicio=26%2F10%2F2026/);
    assert.match(String(url), /fechaFinal=31%2F10%2F2026/);
    return htmlResponse(html);
  };

  const read = await readSniimAvocadoHassCdmx({
    dateStartYmd: '2026-10-26',
    dateEndYmd: '2026-10-31',
  });
  assert.equal(read.value, 55.50);
});

test('SNIIM white corn parser uses latest available weekly value converted to MXN per tonne', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const html = `
    <table>
      <tr><th>Producto</th><th>Origen</th><th>1a Semana</th><th>2a Semana</th><th>3a Semana</th><th>4a Semana</th><th>5a Semana</th><th>Promedio Mensual</th></tr>
      <tr><td>Maiz blanco</td><td>Sinaloa</td><td>8.00</td><td>8.00</td><td>8.25</td><td>8.50</td><td></td><td>8.19</td></tr>
    </table>
  `;

  const parsed = parseSniimWhiteCornCdmx(html, { targetYear: 2026, targetMonth: 10 });
  assert.equal(parsed.value, 8500);
  assert.equal(parsed.rawValuePerKg, 8.50);
  assert.equal(parsed.week, 4);
  assert.equal(parsed.origin, 'Sinaloa');

  globalThis.fetch = async (url) => {
    assert.match(String(url), /ResultadoConsultaMensualGranos\.aspx/);
    assert.match(String(url), /Anio=2026/);
    assert.match(String(url), /DestinoId=100/);
    assert.match(String(url), /Mes=10/);
    return htmlResponse(html);
  };

  const read = await readSniimWhiteCornCdmx({
    targetYear: 2026,
    targetMonth: 10,
    destinoId: 100,
  });
  assert.equal(read.value, 8500);
});

test('SNIIM white egg parser reads latest CDMX wholesale value', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const emptyHtml = `
    <table>
      <tr><td>Registros del 26/10/2026 al 30/10/2026</td></tr>
      <tr><th>Fecha</th><th>Producto</th><th>Presentación</th><th>Precio frecuente ($/kg)</th><th>Precio mínimo ($/kg)</th><th>Precio máximo ($/kg)</th></tr>
    </table>
  `;
  const html = `
    <table>
      <tr><td>Precio de Huevo</td></tr>
      <tr><th>Fecha</th><th>Producto</th><th>Presentación</th><th>Precio frecuente ($/kg)</th><th>Precio mínimo ($/kg)</th><th>Precio máximo ($/kg)</th></tr>
      <tr><td>AGS: Central de Abasto de Aguascalientes</td></tr>
      <tr><td>28/10/2026</td><td>Huevo blanco</td><td>Mayoreo</td><td>$28.00</td><td>$27.00</td><td>$29.00</td></tr>
      <tr><td>DF: Central de Abasto de Iztapalapa D.F.</td></tr>
      <tr><td>28/10/2026</td><td>Huevo blanco</td><td>Mayoreo</td><td>$33.50</td><td>$32.00</td><td>$34.00</td></tr>
      <tr><td>28/10/2026</td><td>Huevo blanco</td><td>Menudeo</td><td>$39.00</td><td>$38.00</td><td>$40.00</td></tr>
    </table>
  `;

  const parsed = parseSniimWhiteEggCdmx(html, {
    targetYear: 2026,
    targetMonth: 10,
    week: 4,
  });
  assert.equal(parsed.value, 33.50);
  assert.equal(parsed.dateYmd, '2026-10-28');
  assert.equal(parsed.presentation, 'Mayoreo');
  assert.equal(parsed.market, 'DF: Central de Abasto de Iztapalapa D.F.');

  globalThis.fetch = async (url) => {
    const text = String(url);
    assert.match(text, /SNIIM-Pecuarios-Nacionales\/e_Hue\.asp/);
    assert.match(text, /anio=2026/);
    assert.match(text, /destino=100/);
    assert.match(text, /mes=10/);
    assert.match(text, /prod=H01/);
    if (text.includes('sem=5')) return htmlResponse(emptyHtml);
    assert.match(text, /sem=4/);
    return htmlResponse(html);
  };

  const read = await readSniimWhiteEggCdmx({
    targetYear: 2026,
    targetMonth: 10,
    destino: 100,
    weeks: [5, 4],
  });
  assert.equal(read.value, 33.50);
  assert.equal(read.week, 4);

  const dispatched = await readSniimFoodPrice({
    commodity: 'huevo_blanco',
    targetYear: 2026,
    targetMonth: 10,
    destino: 100,
    weeks: [4],
  });
  assert.equal(dispatched.value, 33.50);
});
