export const POINTS_NOTIFICATION_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS points_notification_settings (
    user_id INTEGER PRIMARY KEY REFERENCES points_users(id) ON DELETE CASCADE,
    resolution_email_consent UUID,
    language TEXT NOT NULL DEFAULT 'es' CHECK (language IN ('es', 'en'))
  )`,
  `CREATE TABLE IF NOT EXISTS points_notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES points_users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('market_resolved', 'winnings_credited', 'limit_order_filled', 'comment_reply')),
    source_id INTEGER NOT NULL,
    market_id INTEGER REFERENCES points_markets(id) ON DELETE SET NULL,
    amount NUMERIC(20,6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    UNIQUE (user_id, kind, source_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_notifications_user_feed
    ON points_notifications(user_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_points_notifications_unread
    ON points_notifications(user_id, id DESC) WHERE read_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS points_notification_emails (
    notification_id BIGINT PRIMARY KEY REFERENCES points_notifications(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    consent UUID NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('es', 'en')),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_notification_emails_pending
    ON points_notification_emails(available_at, notification_id) WHERE sent_at IS NULL`,
  // Notifications commit with the source event. Triggers cover UI, signed
  // API and cron paths without adding another network call to trade requests.
  `CREATE OR REPLACE FUNCTION points_notify_market_resolution() RETURNS TRIGGER
     LANGUAGE plpgsql AS $$
     BEGIN
       -- Full parallel resolution writes the parent first, then its active
       -- legs. An independently resolved leg still alerts its own holders.
       IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM points_markets parent WHERE parent.id = NEW.parent_id
           AND parent.status = 'active' AND parent.mode = 'points' AND parent.is_test_market IS NOT TRUE
       ) THEN
         RETURN NEW;
       END IF;

       WITH affected AS (
         SELECT DISTINCT u.id
         FROM points_markets m
         JOIN points_positions p ON p.market_id = m.id AND p.shares > 0.000001
         JOIN points_users u ON u.username = p.username
         WHERE m.id = NEW.id OR (
           m.parent_id = NEW.id AND m.status = 'active' AND m.mode = 'points' AND m.is_test_market IS NOT TRUE
         )
       ),
       created AS (
         INSERT INTO points_notifications (user_id, kind, source_id, market_id, created_at)
         SELECT id, 'market_resolved', NEW.id, COALESCE(NEW.parent_id, NEW.id), clock_timestamp() FROM affected
         ON CONFLICT (user_id, kind, source_id) DO NOTHING
         RETURNING id, user_id
       )
       INSERT INTO points_notification_emails (notification_id, email, consent, language)
       SELECT n.id, u.email, pref.resolution_email_consent, pref.language FROM created n
       JOIN points_notification_settings pref ON pref.user_id = n.user_id
       JOIN points_users u ON u.id = n.user_id
       WHERE pref.resolution_email_consent IS NOT NULL AND NULLIF(u.email, '') IS NOT NULL;
       RETURN NEW;
     END;
     $$`,
  `CREATE OR REPLACE TRIGGER points_notify_market_resolution_trigger
     AFTER UPDATE OF status ON points_markets
     FOR EACH ROW
     WHEN (OLD.status IS DISTINCT FROM 'resolved' AND NEW.status = 'resolved'
       AND NEW.mode = 'points' AND NEW.is_test_market IS NOT TRUE)
     EXECUTE FUNCTION points_notify_market_resolution()`,
  `CREATE OR REPLACE FUNCTION points_notify_winnings_credit() RETURNS TRIGGER
     LANGUAGE plpgsql AS $$
     BEGIN
       INSERT INTO points_notifications (user_id, kind, source_id, market_id, amount)
       SELECT u.id, 'winnings_credited', NEW.id, COALESCE(m.parent_id, m.id), NEW.amount
       FROM points_users u
       LEFT JOIN points_markets m ON m.id = NEW.reference_id AND NEW.kind = 'redemption'
       WHERE u.username = NEW.username
         AND (NEW.kind = 'parlay_payout' OR (m.mode = 'points' AND m.is_test_market IS NOT TRUE))
       ON CONFLICT (user_id, kind, source_id) DO NOTHING;
       RETURN NEW;
     END;
     $$`,
  `CREATE OR REPLACE TRIGGER points_notify_winnings_credit_trigger
     AFTER INSERT ON points_distributions
     FOR EACH ROW
     WHEN (NEW.amount > 0 AND NEW.kind IN ('redemption', 'parlay_payout'))
     EXECUTE FUNCTION points_notify_winnings_credit()`,
  `CREATE OR REPLACE FUNCTION points_notify_limit_fill() RETURNS TRIGGER
     LANGUAGE plpgsql AS $$
     BEGIN
       INSERT INTO points_notifications (user_id, kind, source_id, market_id)
       SELECT u.id, 'limit_order_filled', NEW.id, COALESCE(m.parent_id, m.id)
       FROM points_users u JOIN points_markets m ON m.id = NEW.market_id
       WHERE u.username = NEW.username AND m.mode = 'points' AND m.is_test_market IS NOT TRUE
       ON CONFLICT (user_id, kind, source_id) DO NOTHING;
       RETURN NEW;
     END;
     $$`,
  `CREATE OR REPLACE TRIGGER points_notify_limit_fill_trigger
     AFTER UPDATE OF status ON points_limit_orders
     FOR EACH ROW
     WHEN (OLD.status IS DISTINCT FROM 'filled' AND NEW.status = 'filled' AND NEW.filled_shares > 0)
     EXECUTE FUNCTION points_notify_limit_fill()`,
  `CREATE OR REPLACE FUNCTION points_notify_comment_reply() RETURNS TRIGGER
     LANGUAGE plpgsql AS $$
     BEGIN
       INSERT INTO points_notifications (user_id, kind, source_id, market_id)
       SELECT u.id, 'comment_reply', NEW.id, NEW.market_id
       FROM points_comments parent JOIN points_users u ON u.username = parent.username
       WHERE parent.id = NEW.parent_id AND parent.username <> NEW.username AND parent.deleted_at IS NULL
       ON CONFLICT (user_id, kind, source_id) DO NOTHING;
       RETURN NEW;
     END;
     $$`,
  `CREATE OR REPLACE TRIGGER points_notify_comment_reply_trigger
     AFTER INSERT ON points_comments
     FOR EACH ROW
     WHEN (NEW.parent_id IS NOT NULL)
     EXECUTE FUNCTION points_notify_comment_reply()`,
];
