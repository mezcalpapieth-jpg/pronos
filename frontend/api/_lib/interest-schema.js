const INTEREST_SCHEMA_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS interest_daily_counts (
    surface       TEXT NOT NULL,
    object_type   TEXT NOT NULL,
    object_id     TEXT NOT NULL,
    action        TEXT NOT NULL,
    day           DATE NOT NULL DEFAULT CURRENT_DATE,
    count         INTEGER NOT NULL DEFAULT 0,
    unique_count  INTEGER NOT NULL DEFAULT 0,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (surface, object_type, object_id, action, day)
  )`,
  `CREATE TABLE IF NOT EXISTS interest_daily_visitors (
    visitor_key TEXT NOT NULL,
    surface     TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id   TEXT NOT NULL,
    action      TEXT NOT NULL,
    day         DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (visitor_key, surface, object_type, object_id, action, day)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_interest_counts_object_day
     ON interest_daily_counts(object_type, day DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_interest_counts_day
     ON interest_daily_counts(day DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_interest_counts_surface_day
     ON interest_daily_counts(surface, day DESC)`,
];

let interestSchemaReady = false;

const IDEMPOTENT_ERROR_CODES = new Set([
  '42P06',
  '42P07',
  '42710',
  '42701',
  '42P16',
]);

function isIdempotentError(err) {
  if (!err) return false;
  if (IDEMPOTENT_ERROR_CODES.has(err.code)) return true;
  return String(err.message || '').toLowerCase().includes('already exists');
}

export async function ensureInterestSchema(sql) {
  if (interestSchemaReady) return;
  for (const migration of INTEREST_SCHEMA_MIGRATIONS) {
    try {
      await sql.query(migration);
    } catch (err) {
      if (isIdempotentError(err)) continue;
      throw err;
    }
  }
  interestSchemaReady = true;
}
