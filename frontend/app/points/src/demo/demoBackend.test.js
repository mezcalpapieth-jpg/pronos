import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = {
  location: { origin: 'https://pronos.test' },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  setInterval: () => 0,
  clearInterval: () => {},
};

const { routeDemoRequest } = await import('./demoBackend.js');

test('demo backend returns a populated news feed with source and map metadata', () => {
  const result = routeDemoRequest('/api/points/news?limit=5', 'GET', null);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.category, 'featured');
  assert.ok(result.body.items.length > 0);
  assert.ok(result.body.sources.length >= 3);
  assert.ok(result.body.counts.featured >= result.body.items.length);
  assert.ok(result.body.items.some(item => item.geoLocations?.length > 0));
});

test('demo backend filters news by category', () => {
  const result = routeDemoRequest('/api/points/news?category=deportes&limit=20', 'GET', null);
  assert.equal(result.status, 200);
  assert.ok(result.body.items.length > 0);
  assert.ok(result.body.items.every(item => item.categories.includes('deportes')));
});
