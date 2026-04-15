let userSchemaReady = false;

const USER_SCHEMA_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS users (
    id         SERIAL PRIMARY KEY,
    privy_id   TEXT NOT NULL UNIQUE,
    username   TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS privy_id TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
  `WITH ranked AS (
    SELECT ctid,
           ROW_NUMBER() OVER (
             PARTITION BY privy_id
             ORDER BY
               CASE WHEN username IS NOT NULL AND username <> '' THEN 0 ELSE 1 END,
               created_at DESC NULLS LAST,
               ctid DESC
           ) AS rn
    FROM users
    WHERE privy_id IS NOT NULL
  )
  DELETE FROM users u
  USING ranked r
  WHERE u.ctid = r.ctid
    AND r.rn > 1`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_privy_id ON users (privy_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_username_lookup ON users (LOWER(username))`,
];

export async function ensureUserSchema(sql) {
  if (userSchemaReady) return;
  for (const migration of USER_SCHEMA_MIGRATIONS) {
    await sql.query(migration);
  }
  userSchemaReady = true;
}
