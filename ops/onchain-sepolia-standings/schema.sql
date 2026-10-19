-- Apply separately as schema owner, ONLY on the isolated preview database,
-- after the future-tournament migration. Create the restricted login separately.
GRANT USAGE ON SCHEMA public TO sepolia_standings;
GRANT SELECT ON sepolia_tournament_cycles, sepolia_tournament_closures,
  sepolia_tournament_standings, sepolia_standings_checkpoints, sepolia_standings_jobs,
  indexer_factory_state, points_markets TO sepolia_standings;
GRANT SELECT (username, created_at) ON points_users TO sepolia_standings;
GRANT SELECT (approved_market_id, source_data) ON points_pending_markets TO sepolia_standings;
GRANT SELECT (cycle_id, batch_index, tx_hash, status) ON sepolia_tournament_mints TO sepolia_standings;
GRANT SELECT (cycle_id, plan_hash, username, wallet_address, suborg_id, tx_hash, status, amount_units)
  ON sepolia_tournament_joins TO sepolia_standings;
GRANT INSERT ON sepolia_tournament_standings TO sepolia_standings;
GRANT INSERT, DELETE ON sepolia_standings_checkpoints TO sepolia_standings;
GRANT INSERT, UPDATE ON sepolia_standings_jobs TO sepolia_standings;
GRANT SELECT, INSERT, UPDATE ON sepolia_tournament_lock TO sepolia_standings;
-- No balances, Points trades, signed transactions, reward decisions, closures,
-- cycle mutation, DDL, role membership or signing authority is granted.
-- DELETE is limited to disposable capture checkpoints, never published results.
