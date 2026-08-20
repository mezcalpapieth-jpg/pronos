/**
 * Solana token market-cap generator.
 *
 * The resolver uses durable CoinGecko snapshots as the primary close-time
 * evidence and GeckoTerminal's most-liquid pool candle as a sanity check.
 */
import {
  COINGECKO_TOKEN_MCAP_SOURCE,
  readCoinGeckoTokenMarketCap,
} from '../solana-token-mcap.js';
import { MEXICO_CITY_TZ, dateAtMexicoCityTime, formatMexicoDateYmd } from './mexico-time.js';

export const DOGGY_TOKEN_MCAP_MARKET = {
  asset: 'DOGGY',
  coinId: 'holder',
  tokenName: 'HOLDER',
  network: 'solana',
  tokenAddress: 'BS7HxRitaY5ipGfbek1nmatWLbaS9yoWRSEQzCb3pump',
  thresholdUsd: 125000,
  close: { year: 2026, month: 8, day: 23, hour: 23, minute: 59, second: 59 },
};

function thresholdShort(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 1000 && n % 1000 === 0) return `${n / 1000}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export async function generateSolanaMcapMarkets({ now = new Date() } = {}) {
  const cfg = DOGGY_TOKEN_MCAP_MARKET;
  const end = dateAtMexicoCityTime(cfg.close);
  if (now.getTime() >= end.getTime()) return [];

  let spotSnapshot = null;
  let spotReadError = null;
  try {
    spotSnapshot = await readCoinGeckoTokenMarketCap({ coinId: cfg.coinId });
  } catch (e) {
    spotReadError = e?.message?.slice(0, 200) || 'coingecko_read_failed';
    console.error('[market-gen/solana-mcap] spot read failed', {
      coinId: cfg.coinId,
      message: spotReadError,
    });
  }

  const endYmd = formatMexicoDateYmd(end);
  const thresholdLabel = thresholdShort(cfg.thresholdUsd);

  return [{
    source: 'coingecko',
    source_event_id: `solana-mcap:${cfg.coinId}:${endYmd}:${cfg.thresholdUsd}`,
    question: `¿$${cfg.asset} cerrará arriba de $${thresholdLabel} de market cap el 23/08/2026?`,
    category: 'crypto',
    icon: '🐕',
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1000,
    end_time: end.toISOString(),
    amm_mode: 'unified',
    resolver_type: 'api_price',
    resolver_config: {
      source: COINGECKO_TOKEN_MCAP_SOURCE,
      coinId: cfg.coinId,
      network: cfg.network,
      tokenAddress: cfg.tokenAddress,
      symbol: cfg.asset,
      metric: 'market_cap_usd',
      threshold: cfg.thresholdUsd,
      op: 'gt',
      yesOutcome: 0,
      closesAt: end.toISOString(),
      timezone: MEXICO_CITY_TZ,
      snapshotToleranceSeconds: 300,
      disputeBps: 200,
      geckoTerminalVerification: true,
    },
    source_data: {
      asset: cfg.asset,
      tokenName: cfg.tokenName,
      coinId: cfg.coinId,
      network: cfg.network,
      tokenAddress: cfg.tokenAddress,
      metric: 'market_cap_usd',
      strike: cfg.thresholdUsd,
      op: 'gt',
      closeLocal: '2026-08-23 23:59:59 America/Mexico_City',
      closeUtc: end.toISOString(),
      resolutionCriteria: [
        `Primario: market cap USD de CoinGecko para ${cfg.coinId}, snapshot <= close y con tolerancia de 5 minutos.`,
        'Verificacion: candle de 1 minuto de GeckoTerminal del pool mas liquido, usando el ultimo cierre completo <= close.',
        'Si CoinGecko y GeckoTerminal difieren por 2% o mas, queda en revision manual.',
        'Exactamente $125,000 no cuenta como Si: la condicion es estrictamente mayor a $125,000.',
      ].join(' '),
      spotAtGeneration: spotSnapshot?.marketCap || null,
      spotPriceUsdAtGeneration: spotSnapshot?.priceUsd || null,
      spotCapturedAt: spotSnapshot?.capturedAt || null,
      spotReadError,
    },
  }];
}
