export const REVIEWED_CREATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS protocol_reviewed_market_creations (
    pending_id INTEGER PRIMARY KEY REFERENCES points_pending_markets(id),
    rules_hash TEXT NOT NULL REFERENCES protocol_resolution_documents(hash),
    spec JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued', 'signed', 'listed', 'expired', 'reverted', 'needs_review')),
    signed_transaction TEXT,
    tx_hash TEXT UNIQUE,
    market_id INTEGER REFERENCES points_markets(id),
    last_error TEXT,
    attempted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((signed_transaction IS NULL) = (tx_hash IS NULL))
  );
`;

let ready = false;
export async function ensureReviewedCreationSchema(transaction) {
  if (ready) return;
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(42161, 8215)');
    const { rows: [{ present }] } = await client.query(
      "SELECT to_regclass('protocol_reviewed_market_creations') IS NOT NULL AS present",
    );
    if (!present) await client.query(REVIEWED_CREATION_SCHEMA);
  });
  ready = true;
}
