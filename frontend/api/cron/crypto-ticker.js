/**
 * GET /api/cron/crypto-ticker
 *
 * Server-side price recorder for the 5-min crypto chart history. Runs
 * every minute via Vercel cron. Inside the single invocation it loops
 * ~12 times, fetching Coinbase's REST ticker for each asset and
 * inserting the snapshot into `crypto_ticks`. Result: ~12 ticks per
 * minute per asset, persisted regardless of whether any user has the
 * page open.
 *
 * Why server-side at all (vs. client fetching Coinbase trades on every
 * open)? Coinbase's public trades endpoint can only paginate back ~50
 * min on busy markets, so a user opening a resolved market from 2h ago
 * would see a sparse / empty chart. Persisting our own snapshots gives
 * an authoritative history that survives Coinbase's pagination depth
 * AND that's identical for every user — no per-page Coinbase rate
 * limits, no CORS weirdness, no client-side data discrepancies.
 *
 * Retention: rows older than 7 days are pruned at the tail of each
 * run. The detail page only needs the current + previous market's
 * window (≤10 min) plus a 24h archive grace, so 7d is comfortable.
 *
 * Source choice: Coinbase REST ticker, not Chainlink. The resolver
 * uses Chainlink (authoritative for settlement) — but Chainlink Data
 * Feeds update on deviation thresholds, not on a clock, so they don't
 * give a continuous curve. Coinbase ticks per fill, which is what the
 * chart wants. The settlement value at close is overridden client-
 * side from cryptoMeta.closePrice so the very last point of the
 * resolved chart still matches the threshold-vs-Chainlink comparison
 * the resolver used.
 */
import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';

const sql = neon(process.env.DATABASE_URL);

// Same products useCryptoTicker subscribes to client-side. Kept in
// sync with crypto-5min.js's ASSETS by convention — not imported to
// avoid the cron pulling the whole resolver pipeline at boot.
const PRODUCTS = [
  { asset: 'btc', productId: 'BTC-USD' },
  { asset: 'eth', productId: 'ETH-USD' },
];

const TICK_INTERVAL_MS = 5_000;     // ~12 ticks/minute per asset
const RUN_BUDGET_MS    = 55_000;    // stop ≥5s before Vercel's 60s Hobby timeout
const RETENTION_DAYS   = 7;

async function fetchTickerPrice(productId) {
  // Coinbase Exchange REST ticker — public, no auth, returns
  // {trade_id, price, size, time, bid, ask, volume}. We only care
  // about `price` (last trade) and our local clock for timestamp
  // (Coinbase's `time` is the last trade time, which can lag a few
  // seconds during quiet periods — we want even spacing).
  const res = await fetch(
    `https://api.exchange.coinbase.com/products/${productId}/ticker`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`coinbase ticker HTTP ${res.status}`);
  const json = await res.json();
  const price = Number(json?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
  return price;
}

async function recordTickAt(captureTime) {
  // One row per asset per tick. Parallel fetches so a slow asset
  // can't poison the loop's cadence.
  const results = await Promise.allSettled(
    PRODUCTS.map(p =>
      fetchTickerPrice(p.productId).then(price => ({ asset: p.asset, price })),
    ),
  );
  const rows = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
  if (rows.length === 0) return { inserted: 0, failed: results.length };

  // Single INSERT with multi-row VALUES. Conflict on (asset,
  // captured_at) does nothing — if two cron instances run back-to-
  // back at the same exact second (rare race on Vercel cron retries)
  // we don't dupe.
  await sql`
    INSERT INTO crypto_ticks (asset, captured_at, price)
    SELECT u.asset, ${captureTime.toISOString()}::timestamptz, u.price
    FROM UNNEST(
      ${rows.map(r => r.asset)}::text[],
      ${rows.map(r => r.price)}::numeric[]
    ) AS u(asset, price)
    ON CONFLICT (asset, captured_at) DO NOTHING
  `;
  return { inserted: rows.length, failed: results.length - rows.length };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  // Vercel cron sends a GET with no body. We accept GET and POST so the
  // route also works under manual hit + admin tooling.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const startedAt = Date.now();

  try {
    await ensurePointsSchema(sql);

    let inserted = 0;
    let failed = 0;
    let ticks = 0;
    while (Date.now() - startedAt < RUN_BUDGET_MS) {
      const captureTime = new Date();
      try {
        const r = await recordTickAt(captureTime);
        inserted += r.inserted;
        failed   += r.failed;
        ticks    += 1;
      } catch (e) {
        // single-tick failure isn't fatal — next iteration retries
        failed += PRODUCTS.length;
      }
      const elapsedSinceStart = Date.now() - startedAt;
      const nextRunAt = startedAt + ticks * TICK_INTERVAL_MS;
      const sleepFor = nextRunAt - Date.now();
      // Stop if the next sleep would push us past the budget.
      if (sleepFor + elapsedSinceStart >= RUN_BUDGET_MS) break;
      if (sleepFor > 0) await sleep(sleepFor);
    }

    // Tail prune. Cheap (DELETE with index on asset+captured_at). Done
    // once per cron run so retention can't drift.
    let pruned = 0;
    try {
      const dropped = await sql`
        DELETE FROM crypto_ticks
        WHERE captured_at < NOW() - INTERVAL '${RETENTION_DAYS} days'
        RETURNING id
      `;
      pruned = dropped.length;
    } catch { /* non-fatal */ }

    return res.status(200).json({
      ok: true,
      ticks,
      inserted,
      failed,
      pruned,
      durationMs: Date.now() - startedAt,
    });
  } catch (e) {
    console.error('[cron/crypto-ticker] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'ticker_failed', detail: e?.message });
  }
}
