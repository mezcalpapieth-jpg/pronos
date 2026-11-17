export const POINTS_COMMENT_MIGRATIONS = [
  `ALTER TABLE points_comments ADD COLUMN IF NOT EXISTS parent_id INTEGER
    REFERENCES points_comments(id) ON DELETE CASCADE`,
  `CREATE INDEX IF NOT EXISTS idx_points_comments_live_replies
    ON points_comments(parent_id, id) WHERE deleted_at IS NULL AND parent_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS points_comment_likes (
    comment_id INTEGER NOT NULL REFERENCES points_comments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES points_users(id) ON DELETE CASCADE,
    PRIMARY KEY (comment_id, user_id)
  )`,
];

export function commentId(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

function serializeComment(row) {
  const deleted = row.deleted_at != null;
  return {
    id: row.id,
    marketId: row.market_id,
    parentId: row.parent_id,
    username: deleted ? null : row.username,
    body: deleted ? null : row.body,
    createdAt: row.created_at,
    deleted,
    likeCount: deleted ? 0 : Number(row.like_count || 0),
    liked: !deleted && row.liked === true,
    replyCount: Number(row.reply_count || 0),
  };
}

export async function listMarketComments(sql, { marketId, parentId, afterId, limit, viewerSub }) {
  const rows = await sql`
    WITH viewer AS (
      SELECT id FROM points_users WHERE turnkey_sub_org_id = ${viewerSub}
    ),
    page AS (
      SELECT c.id, c.market_id, c.parent_id, c.username, c.body, c.created_at, c.deleted_at,
        CASE WHEN c.parent_id IS NULL THEN (
          SELECT COUNT(*) FROM points_comments r WHERE r.parent_id = c.id AND r.deleted_at IS NULL
        ) ELSE 0 END AS reply_count
      FROM points_comments c
      WHERE c.market_id = ${marketId}
        AND ((${parentId}::integer IS NULL AND c.parent_id IS NULL) OR c.parent_id = ${parentId})
        AND (${afterId}::integer IS NULL OR c.id > ${afterId})
        AND (c.deleted_at IS NULL OR (c.parent_id IS NULL AND EXISTS (
          SELECT 1 FROM points_comments r WHERE r.parent_id = c.id AND r.deleted_at IS NULL
        )))
      ORDER BY CASE WHEN ${parentId}::integer IS NULL THEN c.created_at END DESC NULLS LAST,
        CASE WHEN ${parentId}::integer IS NULL THEN c.id END DESC, c.id ASC
      LIMIT ${limit + 1}
    )
    SELECT page.*, COUNT(l.comment_id) AS like_count,
      COALESCE(BOOL_OR(l.user_id = (SELECT id FROM viewer)), false) AS liked
    FROM page LEFT JOIN points_comment_likes l ON l.comment_id = page.id
    GROUP BY page.id, page.market_id, page.parent_id, page.username, page.body,
      page.created_at, page.deleted_at, page.reply_count
    ORDER BY CASE WHEN ${parentId}::integer IS NULL THEN page.created_at END DESC NULLS LAST,
      CASE WHEN ${parentId}::integer IS NULL THEN page.id END DESC, page.id ASC
  `;
  return {
    comments: rows.slice(0, limit).map(serializeComment),
    nextAfterId: parentId && rows.length > limit ? rows[limit - 1].id : null,
  };
}

export async function insertMarketComment(sql, { marketId, parentId, username, body }) {
  const rows = await sql`
    WITH reply_parent AS (
      SELECT id FROM points_comments
      WHERE id = ${parentId} AND market_id = ${marketId}
        AND parent_id IS NULL AND deleted_at IS NULL
      FOR UPDATE
    )
    INSERT INTO points_comments (market_id, parent_id, username, body)
    SELECT id, ${parentId}, ${username}, ${body} FROM points_markets
    WHERE id = ${marketId} AND (${parentId}::integer IS NULL OR EXISTS (SELECT 1 FROM reply_parent))
    RETURNING id, market_id, parent_id, username, body, created_at
  `;
  return rows[0] ? serializeComment(rows[0]) : null;
}

export async function setMarketCommentLike(sql, { id, viewerSub, liked }) {
  // The requested final state makes retries harmless on both actions.
  const rows = liked
    ? await sql`
      INSERT INTO points_comment_likes (comment_id, user_id)
      SELECT c.id, u.id FROM points_comments c CROSS JOIN points_users u
      WHERE c.id = ${id} AND c.deleted_at IS NULL AND u.turnkey_sub_org_id = ${viewerSub}
      ON CONFLICT (comment_id, user_id) DO NOTHING
      RETURNING comment_id
    `
    : await sql`
      DELETE FROM points_comment_likes l USING points_users u
      WHERE l.comment_id = ${id} AND l.user_id = u.id AND u.turnkey_sub_org_id = ${viewerSub}
      RETURNING l.comment_id
    `;
  if (!rows.length && liked) {
    const existing = await sql`
      SELECT 1 FROM points_comment_likes l
      JOIN points_users u ON u.id = l.user_id
      JOIN points_comments c ON c.id = l.comment_id
      WHERE c.id = ${id} AND c.deleted_at IS NULL AND u.turnkey_sub_org_id = ${viewerSub}
    `;
    if (!existing.length) return null;
  }
  return liked;
}
