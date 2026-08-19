import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./price-history.js', import.meta.url), 'utf8');

test('points price history supports short hour windows for detail charts', () => {
  assert.match(source, /GET \/api\/points\/price-history\?ids=1,2,3&hours=4/);
  assert.match(source, /const hoursRaw = parseInt\(req\.query\.hours, 10\)/);
  assert.match(source, /const windowHours = Number\.isInteger\(hoursRaw\)/);
  assert.match(source, /\|\| ' hours'/);
});

test('points price history includes binary orderbook fills that do not move reserves', () => {
  assert.match(source, /PRONOS_TREASURY_USERNAME/);
  assert.match(source, /displayTradePointsFromRows/);
  assert.match(source, /mergeDisplayPricePoints/);
  assert.match(source, /const displayTradeRows = outcomeIdx <= 1 \? await sql/);
  assert.match(source, /t\.side IN \('buy', 'sell'\)/);
  assert.match(source, /jsonb_array_length\(m\.outcomes\) = 2/);
  assert.match(source, /tradeRowCap/);
  assert.match(source, /priceHistoryExecutionBucket\(r\.snapshotted_at\)/);
  assert.match(source, /sort\(\(a, b\) => a\.t - b\.t \|\| a\._id - b\._id\)/);
});

// A column the outer SELECT reads but `sampled` never projects is not a
// typo the source-text assertions above can see — it is a query that
// parses fine here and throws `column "id" does not exist` in Postgres,
// 500ing every chart on the site. Check the projection instead of the
// spelling.
test('points price history sampled CTE projects every column the outer select reads', () => {
  const projection = source.match(/sampled AS \(\s*SELECT([\s\S]*?)\s*FROM ranked/)?.[1];
  assert.ok(projection, 'could not locate the sampled CTE');
  const outerCols = source
    .match(/SELECT DISTINCT ON \(market_id, bucket\)\s*([^\n]+)\s*\n\s*FROM sampled/)?.[1]
    .split(',')
    .map(c => c.trim())
    .filter(Boolean);
  assert.ok(outerCols?.length, 'could not locate the outer select');
  for (const col of outerCols) {
    assert.match(projection, new RegExp(`(^|[\\s,(])${col}\\s*,`), `sampled must project "${col}"`);
  }
});
