const migrations = [
  `CREATE TABLE IF NOT EXISTS deck_invites (
    id BIGSERIAL PRIMARY KEY,
    code_hash TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    email_hint TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_deck_invites_active ON deck_invites(active, revoked_at)`,

  `CREATE TABLE IF NOT EXISTS deck_sessions (
    id TEXT PRIMARY KEY,
    invite_id BIGINT REFERENCES deck_invites(id),
    viewer_email TEXT NOT NULL,
    deck_language TEXT NOT NULL DEFAULT 'en',
    user_agent TEXT,
    ip_hash TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE deck_sessions ALTER COLUMN deck_language SET DEFAULT 'en'`,
  `CREATE INDEX IF NOT EXISTS idx_deck_sessions_invite ON deck_sessions(invite_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deck_sessions_email ON deck_sessions(LOWER(viewer_email))`,
  `CREATE INDEX IF NOT EXISTS idx_deck_sessions_last_seen ON deck_sessions(last_seen_at DESC)`,

  `CREATE TABLE IF NOT EXISTS deck_slide_events (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT REFERENCES deck_sessions(id) ON DELETE CASCADE,
    invite_id BIGINT REFERENCES deck_invites(id),
    viewer_email TEXT,
    deck_language TEXT NOT NULL DEFAULT 'en',
    slide_number INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE deck_slide_events ALTER COLUMN deck_language SET DEFAULT 'en'`,
  `CREATE INDEX IF NOT EXISTS idx_deck_slide_events_session ON deck_slide_events(session_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_deck_slide_events_slide ON deck_slide_events(deck_language, slide_number)`,
  `CREATE INDEX IF NOT EXISTS idx_deck_slide_events_invite ON deck_slide_events(invite_id)`,

  `CREATE TABLE IF NOT EXISTS deck_questions (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT REFERENCES deck_sessions(id) ON DELETE SET NULL,
    invite_id BIGINT REFERENCES deck_invites(id),
    viewer_email TEXT,
    deck_language TEXT NOT NULL DEFAULT 'en',
    slide_number INTEGER,
    question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE deck_questions ALTER COLUMN deck_language SET DEFAULT 'en'`,
  `CREATE INDEX IF NOT EXISTS idx_deck_questions_created ON deck_questions(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_deck_questions_status ON deck_questions(status)`,
];

let ensured = false;

export async function ensureDeckSchema(sql) {
  if (ensured) return;
  for (const migration of migrations) {
    await sql.query(migration);
  }
  ensured = true;
}

export { migrations as deckSchemaMigrations };
