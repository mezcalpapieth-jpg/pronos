/**
 * Presentation data for CoinGecko token market-cap markets.
 *
 * The market API exposes `tokenMeta` (symbol / coinId / network /
 * tokenAddress) straight from the resolver config. This maps the coinId
 * to the token art we ship under points/public and builds the token's
 * CoinGecko chart link.
 */
import { pointsPublicAssetSrc } from '@app/lib/publicAssets.js';

const TOKEN_IMAGES = {
  holder: pointsPublicAssetSrc('/tokens/doggy.webp'),
};

// Same view the market tracks: 7-day market-cap line.
const COINGECKO_CHART_QUERY = 'chart=type%3Dmarket_cap%26mode%3Dline%26timeframe%3Dd7';

export function tokenMarketMeta(market) {
  const meta = market?.tokenMeta;
  const coinId = meta?.coinId;
  if (!coinId) return null;
  return {
    symbol: meta.symbol || null,
    tokenAddress: meta.tokenAddress || null,
    imageUrl: TOKEN_IMAGES[coinId] || null,
    coingeckoUrl: `https://www.coingecko.com/en/coins/${encodeURIComponent(coinId)}?${COINGECKO_CHART_QUERY}`,
  };
}
