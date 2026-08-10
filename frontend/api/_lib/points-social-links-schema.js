let socialLinksSchemaReady = false;

const SOCIAL_LINKS_SCHEMA_READY_PROBE = `
  SELECT
    to_regclass('public.points_social_links') IS NOT NULL AS points_social_links,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'points_social_links'
        AND column_name = 'is_public'
    ) AS points_social_links_is_public,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'points_social_links'
        AND column_name = 'source'
    ) AS points_social_links_source,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'points_social_links'
        AND column_name = 'updated_at'
    ) AS points_social_links_updated_at
`;

const SOCIAL_LINKS_SCHEMA_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS points_social_links (
    id                SERIAL PRIMARY KEY,
    username          TEXT NOT NULL,
    provider          TEXT NOT NULL,
    provider_user_id  TEXT NOT NULL,
    handle            TEXT,
    profile_url       TEXT,
    reward_credited   BOOLEAN NOT NULL DEFAULT false,
    is_public         BOOLEAN NOT NULL DEFAULT false,
    source            TEXT NOT NULL DEFAULT 'oauth',
    linked_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (username, provider),
    UNIQUE (provider, provider_user_id)
  )`,
  `ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'oauth'`,
  `ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
  `CREATE INDEX IF NOT EXISTS idx_points_social_links_user ON points_social_links(username)`,
  `CREATE INDEX IF NOT EXISTS idx_points_social_links_public_user
    ON points_social_links(username, is_public)`,
];

function isIdempotentSchemaError(error) {
  const code = error?.code;
  if (code === '42P06' || code === '42P07' || code === '42710' || code === '42701' || code === '42P16') {
    return true;
  }
  return String(error?.message || '').toLowerCase().includes('already exists');
}

async function socialLinksSchemaLooksReady(sql) {
  const rows = await sql.query(SOCIAL_LINKS_SCHEMA_READY_PROBE);
  const row = rows?.[0];
  return !!row && Object.values(row).every(Boolean);
}

export async function ensurePointsSocialLinksSchema(sql) {
  if (socialLinksSchemaReady) return;
  if (await socialLinksSchemaLooksReady(sql).catch(() => false)) {
    socialLinksSchemaReady = true;
    return;
  }

  for (const migration of SOCIAL_LINKS_SCHEMA_MIGRATIONS) {
    try {
      await sql.query(migration);
    } catch (error) {
      if (!isIdempotentSchemaError(error)) throw error;
    }
  }
  socialLinksSchemaReady = true;
}
