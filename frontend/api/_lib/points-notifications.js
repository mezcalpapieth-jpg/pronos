export function notificationId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) return null;
  return BigInt(value) <= 9_223_372_036_854_775_807n ? value : null;
}

export async function readNotificationFeed(sql, { userId, beforeId, countOnly }) {
  const limit = 20;
  const unreadRows = await sql`
    SELECT COUNT(*)::int AS unread FROM points_notifications WHERE user_id = ${userId} AND read_at IS NULL
  `;
  const unread = unreadRows[0]?.unread || 0;
  if (countOnly) return { unread };

  const rows = await sql`
    SELECT n.id, n.kind, n.market_id, m.question, n.amount, n.created_at, n.read_at
    FROM points_notifications n
    LEFT JOIN points_markets m ON m.id = n.market_id
    WHERE n.user_id = ${userId} AND (${beforeId}::bigint IS NULL OR n.id < ${beforeId})
    ORDER BY n.id DESC LIMIT ${limit + 1}
  `;
  const page = rows.slice(0, limit);
  return {
    unread,
    items: page.map(row => ({
      id: String(row.id),
      kind: row.kind,
      marketId: row.market_id,
      question: row.question,
      amount: row.amount == null ? null : Number(row.amount),
      createdAt: row.created_at,
      readAt: row.read_at,
    })),
    nextBeforeId: rows.length > limit ? String(page.at(-1).id) : null,
  };
}

export async function markNotificationsRead(sql, { userId, id, throughId }) {
  await sql`
    UPDATE points_notifications SET read_at = NOW()
    WHERE user_id = ${userId} AND read_at IS NULL
      AND ((${id}::bigint IS NOT NULL AND id = ${id}) OR (${throughId}::bigint IS NOT NULL AND id <= ${throughId}))
  `;
}

export async function saveNotificationSettings(sql, { userId, resolutionEmail, language }) {
  const rows = await sql`
    INSERT INTO points_notification_settings (user_id, resolution_email_consent, language)
    VALUES (${userId}, CASE WHEN ${resolutionEmail}::boolean THEN gen_random_uuid() ELSE NULL END, ${language})
    ON CONFLICT (user_id) DO UPDATE
      SET resolution_email_consent = CASE
        WHEN EXCLUDED.resolution_email_consent IS NULL THEN NULL
        ELSE COALESCE(points_notification_settings.resolution_email_consent, EXCLUDED.resolution_email_consent)
      END,
      language = EXCLUDED.language
    RETURNING resolution_email_consent IS NOT NULL AS enabled
  `;
  return rows[0].enabled;
}
