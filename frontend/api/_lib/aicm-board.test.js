import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AICM_DAILY_DELAY_BUCKETS,
  airlineNameForAicmFlightCode,
  aicmDelayBucketIndexFor,
  buildAicmDelayBucketsForDays,
  buildAicmFlightBoardUrl,
  normalizeAicmBoardPages,
  normalizeAicmObservationForDisplay,
  normalizeAicmFlightStatus,
  parseAicmFlightBoard,
  readAicmFlightBoard,
  readAicmDelayCount,
  runAicmOraclePoll,
} from './aicm-board.js';

test('buildAicmFlightBoardUrl targets official AICM departure and arrival filters', () => {
  const departure = new URL(buildAicmFlightBoardUrl('departure', { baseUrl: 'https://example.com/vuelos' }));
  const arrival = new URL(buildAicmFlightBoardUrl('arrival', { baseUrl: 'https://example.com/vuelos' }));

  assert.equal(departure.searchParams.get('da'), 'd');
  assert.equal(arrival.searchParams.get('da'), 'a');
  assert.equal(departure.searchParams.get('busca'), '');
  assert.equal(departure.searchParams.get('ciudad'), '');
  assert.equal(departure.searchParams.get('air'), '');
  assert.equal(departure.searchParams.get('in0'), 'n');
  assert.equal(departure.searchParams.get('cpage'), null);

  const departurePage2 = new URL(buildAicmFlightBoardUrl('departure', {
    baseUrl: 'https://example.com/vuelos',
    page: 2,
  }));
  assert.equal(departurePage2.searchParams.get('da'), 'd');
  assert.equal(departurePage2.searchParams.get('cpage'), '2');
});

test('normalizeAicmBoardPages keeps a small unique official-board page list', () => {
  assert.deepEqual(normalizeAicmBoardPages('1,2,2,0,abc,11'), [1, 2]);
  assert.deepEqual(normalizeAicmBoardPages([]), [1]);
});

test('normalizeAicmFlightStatus recognizes delay, cancellation, and normal states', () => {
  assert.equal(normalizeAicmFlightStatus('DEMORADO'), 'delayed');
  assert.equal(normalizeAicmFlightStatus('Retrasado'), 'delayed');
  assert.equal(normalizeAicmFlightStatus('Cancelado'), 'cancelled');
  assert.equal(normalizeAicmFlightStatus('A Tiempo'), 'scheduled');
  assert.equal(normalizeAicmFlightStatus('Abordando'), 'boarding');
  assert.equal(normalizeAicmFlightStatus('Cerrado'), 'closed');
});

test('parseAicmFlightBoard extracts normalized observations from a Spanish table', () => {
  const parsed = parseAicmFlightBoard(`
    <table>
      <thead>
        <tr>
          <th>Aerolínea</th><th>Vuelo</th><th>Destino</th><th>Hora</th>
          <th>Estimada</th><th>Terminal</th><th>Sala</th><th>Estatus</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>AEROMEXICO</td><td>AM 123</td><td>Monterrey</td><td>14:20</td>
          <td>15:05</td><td>T2</td><td>62</td><td>DEMORADO</td>
        </tr>
        <tr>
          <td>VOLARIS</td><td>Y4 777</td><td>Guadalajara</td><td>16:10</td>
          <td></td><td>T1</td><td>8</td><td>A Tiempo</td>
        </tr>
      </tbody>
    </table>
  `, {
    direction: 'departure',
    sourceUrl: 'https://example.com/vuelos?da=d',
    observedAt: '2026-08-19T18:00:00.000Z',
  });

  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.rowCount, 2);
  assert.equal(parsed.delayedCount, 1);
  assert.equal(parsed.rows[0].flightCode, 'AM123');
  assert.equal(parsed.rows[0].city, 'Monterrey');
  assert.equal(parsed.rows[0].scheduledTimeLocal, '14:20');
  assert.equal(parsed.rows[0].estimatedTimeLocal, '15:05');
  assert.equal(parsed.rows[0].statusNorm, 'delayed');
  assert.equal(parsed.rows[1].statusNorm, 'scheduled');
});

test('parseAicmFlightBoard keeps official AICM departure-board columns aligned', () => {
  const parsed = parseAicmFlightBoard(`
    <table>
      <thead>
        <tr>
          <th>Aerolínea</th><th>Vuelo</th><th>Hora</th><th>Destino</th>
          <th>Terminal</th><th>Sala</th><th>Estatus</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><img src="/logos/viva.png" alt="Viva"></td>
          <td>VB1232</td><td>05:00</td><td>Tijuana</td>
          <td>T1</td><td>B</td><td>DEMORADO</td>
        </tr>
        <tr>
          <td><img src="/logos/hainan.png"></td>
          <td>HU7926</td><td>04:50</td><td>Beijing</td>
          <td>T1</td><td>24</td><td>DEMORADO</td>
        </tr>
      </tbody>
    </table>
  `, {
    direction: 'departure',
    sourceUrl: 'https://example.com/vuelos?da=d',
    observedAt: '2026-08-20T09:00:00.000Z',
  });

  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.rowCount, 2);
  assert.equal(parsed.rows[0].airline, 'Viva');
  assert.equal(parsed.rows[0].flightCode, 'VB1232');
  assert.equal(parsed.rows[0].scheduledTimeLocal, '05:00');
  assert.equal(parsed.rows[0].city, 'Tijuana');
  assert.equal(parsed.rows[0].terminal, 'T1');
  assert.equal(parsed.rows[0].gate, 'B');
  assert.equal(parsed.rows[0].statusNorm, 'delayed');
  assert.equal(parsed.rows[1].airline, 'Hainan Airlines');
  assert.equal(parsed.rows[1].flightCode, 'HU7926');
  assert.equal(parsed.rows[1].scheduledTimeLocal, '04:50');
  assert.equal(parsed.rows[1].city, 'Beijing');
  assert.equal(parsed.rows[1].terminal, 'T1');
  assert.equal(parsed.rows[1].gate, '24');
});

test('AICM airline names can be inferred from flight-number prefixes', () => {
  assert.equal(airlineNameForAicmFlightCode('VB1232'), 'Viva Aerobus');
  assert.equal(airlineNameForAicmFlightCode('Y4 262'), 'Volaris');
  assert.equal(airlineNameForAicmFlightCode('HU7926'), 'Hainan Airlines');
  assert.equal(airlineNameForAicmFlightCode('TA433'), 'Avianca');
});

test('general AICM delay-count buckets match the daily operating scale', () => {
  assert.deepEqual(AICM_DAILY_DELAY_BUCKETS.map(b => b.label), ['0-419', '420-430', '431-440', '441+']);
  assert.equal(aicmDelayBucketIndexFor(419), 0);
  assert.equal(aicmDelayBucketIndexFor(420), 1);
  assert.equal(aicmDelayBucketIndexFor(430), 1);
  assert.equal(aicmDelayBucketIndexFor(431), 2);
  assert.equal(aicmDelayBucketIndexFor(440), 2);
  assert.equal(aicmDelayBucketIndexFor(441), 3);
});

test('general AICM delay-count buckets scale by counted days', () => {
  const buckets = buildAicmDelayBucketsForDays(2);
  assert.deepEqual(buckets.map(b => b.label), ['0-839', '840-860', '861-880', '881+']);
  assert.equal(aicmDelayBucketIndexFor(839, buckets), 0);
  assert.equal(aicmDelayBucketIndexFor(840, buckets), 1);
  assert.equal(aicmDelayBucketIndexFor(860, buckets), 1);
  assert.equal(aicmDelayBucketIndexFor(861, buckets), 2);
  assert.equal(aicmDelayBucketIndexFor(880, buckets), 2);
  assert.equal(aicmDelayBucketIndexFor(881, buckets), 3);
});

test('normalizeAicmObservationForDisplay repairs shifted official-board rows', () => {
  const row = normalizeAicmObservationForDisplay({
    flightDate: '2026-08-20',
    flightCode: '05',
    airline: 'VB1232',
    city: 'T1',
    scheduledTimeLocal: null,
    estimatedTimeLocal: null,
    terminal: null,
    gate: 'DEMORADO',
    statusRaw: 'DEMORADO',
    statusNorm: 'delayed',
    rawCells: ['', 'VB1232', '05:00', 'Tijuana', 'T1', 'B', 'DEMORADO'],
  });

  assert.equal(row.flightCode, 'VB1232');
  assert.equal(row.airline, 'Viva Aerobus');
  assert.equal(row.scheduledTimeLocal, '05:00');
  assert.equal(row.city, 'Tijuana');
  assert.equal(row.terminal, 'T1');
  assert.equal(row.gate, 'B');
  assert.equal(row.statusNorm, 'delayed');
});

test('parseAicmFlightBoard treats maintenance as missing oracle data, not zero delays', () => {
  const parsed = parseAicmFlightBoard(`
    <main>
      <form name="busca_fids"></form>
      <strong>Por el momento se encuentra en mantenimiento.</strong>
    </main>
  `, {
    direction: 'arrival',
    observedAt: '2026-08-19T18:00:00.000Z',
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, 'maintenance');
  assert.equal(parsed.rowCount, 0);
  assert.equal(parsed.delayedCount, 0);
});

test('readAicmFlightBoard returns a compact source hash without raw HTML', async () => {
  const snapshot = await readAicmFlightBoard({
    direction: 'departure',
    now: new Date('2026-08-19T18:00:00.000Z'),
    baseUrl: 'https://example.com/vuelos',
    fetchImpl: async (url, options) => {
      assert.match(String(url), /da=d/);
      assert.equal(options.method, 'GET');
      return {
        ok: true,
        status: 200,
        text: async () => '<strong>Por el momento se encuentra en mantenimiento.</strong>',
      };
    },
  });

  assert.equal(snapshot.status, 'maintenance');
  assert.equal(snapshot.rawHtmlSha256.length, 64);
  assert.ok(snapshot.rawHtmlBytes > 0);
  assert.equal(Object.hasOwn(snapshot, 'rawHtml'), false);
});

test('readAicmFlightBoard merges the first two official AICM pages', async () => {
  const seenUrls = [];
  const snapshot = await readAicmFlightBoard({
    direction: 'departure',
    now: new Date('2026-08-20T12:45:00.000Z'),
    baseUrl: 'https://example.com/vuelos',
    pages: [1, 2],
    fetchImpl: async (url) => {
      seenUrls.push(String(url));
      const page = new URL(String(url)).searchParams.get('cpage') || '1';
      const rows = page === '2'
        ? '<tr><td>Volaris</td><td>Y4 262</td><td>05:05</td><td>Tuxtla Gutierrez</td><td>T1</td><td>B</td><td>A Tiempo</td></tr>'
        : '<tr><td>Aeromexico</td><td>AM 614</td><td>08:45</td><td>Phoenix</td><td>T2</td><td>63</td><td>Demorado</td></tr>';
      return {
        ok: true,
        status: 200,
        text: async () => `
          <table>
            <thead>
              <tr><th>Aerolínea</th><th>Vuelo</th><th>Hora</th><th>Destino</th><th>Terminal</th><th>Sala</th><th>Estatus</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        `,
      };
    },
  });

  assert.equal(seenUrls.length, 2);
  assert.equal(new URL(seenUrls[0]).searchParams.get('cpage'), null);
  assert.equal(new URL(seenUrls[1]).searchParams.get('cpage'), '2');
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.rowCount, 2);
  assert.deepEqual(snapshot.sourceUrls.map(url => new URL(url).searchParams.get('cpage')), [null, '2']);
  assert.deepEqual(snapshot.rows.map(row => row.flightCode), ['AM614', 'Y4262']);
  assert.equal(snapshot.delayedCount, 1);
});

test('runAicmOraclePoll supports a dry-run both-direction probe', async () => {
  const result = await runAicmOraclePoll({
    dryRun: true,
    now: new Date('2026-08-19T18:00:00.000Z'),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '<strong>Por el momento se encuentra en mantenimiento.</strong>',
    }),
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.status, 'maintenance');
  assert.deepEqual(result.snapshots.map(s => s.direction), ['departure', 'arrival']);
  assert.deepEqual(result.snapshots.map(s => s.pollRunId), [null, null]);
});

test('readAicmDelayCount queries distinct delayed flights for a date range', async () => {
  const calls = [];
  const result = await readAicmDelayCount({
    query: async (text, params) => {
      calls.push({ text, params });
      return [{ count: 7, first_observed_at: '2026-08-19T13:00:00Z', last_observed_at: '2026-08-19T21:00:00Z' }];
    },
  }, {
    fromDateYmd: '2026-08-19',
    toDateYmd: '2026-08-20',
    direction: 'salidas',
  });

  assert.equal(result.count, 7);
  assert.equal(result.direction, 'departure');
  assert.deepEqual(calls[0].params, ['2026-08-19', '2026-08-20', 'departure', 'delayed']);
  assert.match(calls[0].text, /COUNT\(DISTINCT flight_key\)::int/);
});
