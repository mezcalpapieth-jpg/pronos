import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const doc = await readFile(new URL('./que-es-el-libro-de-ordenes.html', import.meta.url), 'utf8');
const rootVercel = await readFile(new URL('../vercel.json', import.meta.url), 'utf8');
const frontendVercel = await readFile(new URL('./vercel.json', import.meta.url), 'utf8');

test('orderbook explainer document is linked through an extensionless route', () => {
  assert.match(doc, /Qué es el libro de órdenes/);
  assert.match(doc, /recompensa por dar liquidez/i);
  assert.doesNotMatch(doc, /recompensa maker/i);
  assert.match(doc, /20% semanal/i);
  assert.match(doc, /propio reloj de holding/i);
  assert.match(doc, /Comisión de compra = 5%/);
  assert.match(doc, /varias compras consecutivas más pequeñas/);
  for (const vercel of [rootVercel, frontendVercel]) {
    assert.match(vercel, /"source": "\/que-es-el-libro-de-ordenes"/);
    assert.match(vercel, /"destination": "\/que-es-el-libro-de-ordenes\.html"/);
  }
});
