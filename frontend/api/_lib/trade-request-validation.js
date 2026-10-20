import { assertTournamentTradingOpen } from './sepolia-tournament-season.js';
import { tradeError } from './trade-requests.js';

// Called immediately before every new signature, including the trade after a
// recovered approval. Never changes the saved amount/minimum output/identity.
export async function validateTradePlan({ sql, action, plan, seriesLock }) {
  if (action !== 'redeem') await assertTournamentTradingOpen();
  const rows = await sql`SELECT * FROM protocol_markets WHERE id = ${plan.protocolMarketId} LIMIT 1`;
  const market = rows[0];
  if (!market || Number(market.chain_id) !== 421614 || plan.chainId !== 421614
    || market.pool_address?.toLowerCase() !== plan.market.chain_address.toLowerCase()) {
    throw tradeError('trade_market_changed');
  }
  if (action === 'redeem') {
    if (market.status !== 'resolved') throw tradeError('market_not_resolved', 400);
  } else {
    if (market.status !== 'active' || (market.end_time && new Date(market.end_time) <= new Date())) {
      throw tradeError('market_closed', 400);
    }
    if (seriesLock && (await seriesLock(market))?.locked) throw tradeError('series_game_pending', 400);
  }
}
