import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COINGECKO_MARKETS_SOURCE,
  GECKOTERMINAL_VERIFY_SOURCE,
  marketCapDivergenceBps,
  parseCoinGeckoMarket,
  parseGeckoTerminalOhlcvCandles,
  parseGeckoTerminalPools,
  readGeckoTerminalBoundaryMcap,
  resolveSolanaTokenMcapOutcome,
  readStoredSolanaTokenMcapSnapshot,
  selectMostLiquidPool,
} from './solana-token-mcap.js';

const TOKEN = 'BS7HxRitaY5ipGfbek1nmatWLbaS9yoWRSEQzCb3pump';

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

test('parses CoinGecko market cap and supply snapshots', () => {
  const snapshot = parseCoinGeckoMarket({
    id: 'holder',
    symbol: 'doggy',
    name: 'HOLDER',
    current_price: 0.000125,
    market_cap: 125000,
    circulating_supply: 1000000000,
    total_supply: 1000000000,
    fully_diluted_valuation: 125000,
    last_updated: '2026-08-24T05:59:30.000Z',
  }, { capturedAt: '2026-08-24T05:59:45.000Z' });

  assert.equal(snapshot.source, COINGECKO_MARKETS_SOURCE);
  assert.equal(snapshot.coinId, 'holder');
  assert.equal(snapshot.symbol, 'DOGGY');
  assert.equal(snapshot.marketCap, 125000);
  assert.equal(snapshot.circulatingSupply, 1000000000);
  assert.equal(snapshot.sourceUpdatedAt, '2026-08-24T05:59:30.000Z');
});

test('selects the most liquid GeckoTerminal pool by reserve_in_usd', () => {
  const pools = parseGeckoTerminalPools({
    data: [
      { id: 'solana_small', attributes: { address: 'small', reserve_in_usd: '75.50' } },
      { id: 'solana_big', attributes: { address: 'big', reserve_in_usd: '1000.01' } },
      { id: 'solana_empty', attributes: { address: 'empty', reserve_in_usd: null } },
    ],
  });

  const selected = selectMostLiquidPool(pools);
  assert.equal(selected.address, 'big');
  assert.equal(selected.reserveInUsd, 1000.01);
});

test('uses the last complete 1m candle at or before the close boundary', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/tokens/')) {
      return jsonResponse({
        data: [
          { id: 'solana_pool-low', attributes: { address: 'pool-low-1234567890', reserve_in_usd: '900' } },
          { id: 'solana_pool-high', attributes: { address: 'pool-high-1234567890', reserve_in_usd: '1200' } },
        ],
      });
    }
    return jsonResponse({
      data: {
        attributes: {
          ohlcv_list: [
            [1787551200, 0.13, 0.13, 0.13, 0.13, 10], // incomplete: ends after target
            [1787551140, 0.12, 0.12, 0.12, 0.125, 20], // complete: 05:59:00-05:59:59
            [1787551080, 0.11, 0.11, 0.11, 0.11, 30],
          ],
        },
      },
    });
  };

  const result = await readGeckoTerminalBoundaryMcap({
    network: 'solana',
    tokenAddress: TOKEN,
    targetAt: '2026-08-24T05:59:59.000Z',
    supply: 1000000,
    fetchImpl,
  });

  assert.equal(result.source, GECKOTERMINAL_VERIFY_SOURCE);
  assert.equal(result.poolAddress, 'pool-high-1234567890');
  assert.equal(result.priceUsd, 0.125);
  assert.equal(result.marketCap, 125000);
  assert.equal(result.candleStartAt, '2026-08-24T05:59:00.000Z');
  assert.match(calls[1], /pool-high-1234567890/);
  assert.match(calls[1], new RegExp(encodeURIComponent(TOKEN)));
});

test('stored snapshots honor the close-time tolerance window', async () => {
  const calls = [];
  const sql = {
    query: async (statement, params) => {
      calls.push({ statement, params });
      return {
        rows: [{
          id: 7,
          market_id: 42,
          coin_id: 'holder',
          network: 'solana',
          token_address: TOKEN,
          source: COINGECKO_MARKETS_SOURCE,
          market_cap_usd: '124999.99',
          price_usd: '0.00012499',
          circulating_supply: '1000000000',
          total_supply: '1000000000',
          fdv_usd: '124999.99',
          captured_at: new Date('2026-08-24T05:59:30.000Z'),
          source_updated_at: new Date('2026-08-24T05:59:12.000Z'),
          raw: { id: 'holder' },
        }],
      };
    },
  };

  const snapshot = await readStoredSolanaTokenMcapSnapshot(sql, {
    marketId: 42,
    coinId: 'holder',
    tokenAddress: TOKEN,
    targetAt: '2026-08-24T05:59:59.000Z',
    toleranceSeconds: 300,
  });

  assert.equal(snapshot.marketCap, 124999.99);
  assert.equal(snapshot.capturedAt, '2026-08-24T05:59:30.000Z');
  assert.equal(calls[0].params[3], '300 seconds');
});

test('resolver defers to manual review when CoinGecko and GeckoTerminal disagree by 2%+', async () => {
  const sql = {
    query: async () => ({
      rows: [{
        id: 8,
        market_id: 42,
        coin_id: 'holder',
        network: 'solana',
        token_address: TOKEN,
        source: COINGECKO_MARKETS_SOURCE,
        market_cap_usd: '100',
        price_usd: '1',
        circulating_supply: '100',
        total_supply: '100',
        fdv_usd: '100',
        captured_at: new Date('2026-08-24T05:59:30.000Z'),
        source_updated_at: new Date('2026-08-24T05:59:12.000Z'),
        raw: { id: 'holder' },
      }],
    }),
  };
  const fetchImpl = async (url) => {
    if (String(url).includes('/tokens/')) {
      return jsonResponse({
        data: [
          { id: 'solana_pool', attributes: { address: 'pool-dispute-1234567890', reserve_in_usd: '5000' } },
        ],
      });
    }
    return jsonResponse({
      data: {
        attributes: {
          ohlcv_list: [[1787551140, 1.03, 1.03, 1.03, 1.03, 10]],
        },
      },
    });
  };

  await assert.rejects(
    resolveSolanaTokenMcapOutcome({
      sql,
      marketId: 42,
      resolverConfig: {
        source: 'coingecko-token-mcap',
        coinId: 'holder',
        network: 'solana',
        tokenAddress: TOKEN,
        threshold: 125000,
        op: 'gt',
        yesOutcome: 0,
        closesAt: '2026-08-24T05:59:59.000Z',
        disputeBps: 200,
      },
      endTime: '2026-08-24T05:59:59.000Z',
      fetchImpl,
    }),
    (err) => {
      assert.equal(err.message, 'solana_mcap_dispute_manual_review');
      assert.equal(err.benign, true);
      assert.equal(err.info.divergenceBps, 300);
      return true;
    },
  );
});

test('parses GeckoTerminal OHLCV rows and divergence bps', () => {
  const candles = parseGeckoTerminalOhlcvCandles({
    data: { attributes: { ohlcv_list: [[1, 2, 3, 1, 2.5, 10], ['bad']] } },
  });
  assert.deepEqual(candles, [{
    startSec: 1,
    open: 2,
    high: 3,
    low: 1,
    close: 2.5,
    volume: 10,
  }]);
  assert.equal(Math.round(marketCapDivergenceBps(100, 102)), 200);
});
