import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ibtracsQueryUrl,
  parseIbtracsCsv,
  pointIsInMexicoLand,
  resolveMexicoMajorHurricaneLandfall,
} from './hurricanes.js';

function textResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  };
}

const HEADER = 'sid,season,basin,name,iso_time,latitude,longitude,usa_wind,usa_sshs,dist2land,landfall,usa_record';

test('IBTrACS CSV parser reads storm rows and ignores unit rows', () => {
  const rows = parseIbtracsCsv([
    HEADER,
    ',year,,,,degrees_north,degrees_east,kts,1,km,km,',
    '2026275N14264,2026,EP,TEST,2026-10-10T18:00:00Z,18.6,-103.7,120,4,0,0,L',
  ].join('\n'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'TEST');
});

test('Mexico polygon accepts coastal Mexico and rejects open Pacific', () => {
  assert.equal(pointIsInMexicoLand({ latitude: 18.6, longitude: -103.7 }), true);
  assert.equal(pointIsInMexicoLand({ latitude: 16.0, longitude: -125.0 }), false);
});

test('hurricane resolver returns Yes for Category 4 landfall inside Mexico', async () => {
  const fetchImpl = async () => textResponse([
    HEADER,
    '2026275N14264,2026,EP,TEST,2026-10-10T18:00:00Z,18.6,-103.7,120,4,0,0,L',
  ].join('\n'));

  const resolved = await resolveMexicoMajorHurricaneLandfall({
    startIso: '2026-10-01T06:00:00.000Z',
    endIso: '2026-11-01T05:59:00.000Z',
    resolveAt: '2026-01-01T00:00:00.000Z',
    fetchImpl,
  });
  assert.equal(resolved.winningIdx, 0);
  assert.equal(resolved.resolverInfo.count, 1);
  assert.equal(resolved.resolverInfo.matchedStorms[0].usaSshs, 4);
});

test('hurricane resolver returns No when no Category 4 Mexico landfall exists', async () => {
  const fetchImpl = async () => textResponse([
    HEADER,
    '2026275N14264,2026,EP,WEAK,2026-10-10T18:00:00Z,18.6,-103.7,80,1,0,0,L',
  ].join('\n'));

  const resolved = await resolveMexicoMajorHurricaneLandfall({
    startIso: '2026-10-01T06:00:00.000Z',
    endIso: '2026-11-01T05:59:00.000Z',
    resolveAt: '2026-01-01T00:00:00.000Z',
    fetchImpl,
  });
  assert.equal(resolved.winningIdx, 1);
  assert.equal(resolved.resolverInfo.count, 0);
});

test('IBTrACS query URL constrains season and October tournament window', () => {
  const url = ibtracsQueryUrl({
    startIso: '2026-10-01T06:00:00.000Z',
    endIso: '2026-11-01T05:59:00.000Z',
    season: 2026,
  });
  assert.match(url, /season=2026/);
  assert.match(url, /time%3E=2026-10-01T06%3A00%3A00\.000Z/);
  assert.match(url, /time%3C=2026-11-01T05%3A59%3A00\.000Z/);
});
