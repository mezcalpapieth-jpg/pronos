CREATE TABLE IF NOT EXISTS preview_indexer_lease (
  name TEXT PRIMARY KEY,
  owner UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS preview_indexer_runs (
  id UUID PRIMARY KEY,
  source_sha TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  report JSONB
);
CREATE INDEX IF NOT EXISTS preview_indexer_runs_started ON preview_indexer_runs (started_at DESC);

GRANT USAGE ON SCHEMA public TO sepolia_indexer;
GRANT SELECT, INSERT, UPDATE ON protocol_markets, trades, positions, outcome_positions,
  redemptions, price_snapshots, indexer_factory_state, indexer_state,
  preview_indexer_lease, preview_indexer_runs TO sepolia_indexer;
GRANT USAGE, SELECT ON SEQUENCE protocol_markets_id_seq, trades_id_seq, positions_id_seq,
  outcome_positions_id_seq, redemptions_id_seq, price_snapshots_id_seq TO sepolia_indexer;

-- The worker records public onchain flags without reading private objection details.
GRANT SELECT (market_id, proposal_id, source, source_key),
  INSERT (market_id, proposal_id, source, source_key, reporter_address, objection_hash, tx_hash)
  ON protocol_resolution_objections TO sepolia_indexer;
