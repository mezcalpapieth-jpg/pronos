---
description: Quick row counts and recent rows from points_markets and other Pronos tables
---

You are inspecting the Pronos Neon database to verify state.

**Preferred path: Postgres MCP**

If the `postgres` MCP server is connected (check via the loaded tools list — look for `mcp__postgres__*`), run direct read-only queries:

```sql
-- Markets by status + mode
SELECT status, COALESCE(mode, 'NULL') AS mode, COUNT(*) AS n
FROM points_markets
WHERE archived_at IS NULL AND parent_id IS NULL
GROUP BY status, mode
ORDER BY status, mode;

-- Recently resolved (sanity-check the ORDER BY resolved_at DESC fix)
SELECT id, question, status, resolved_at, end_time
FROM points_markets
WHERE status = 'resolved' AND archived_at IS NULL
ORDER BY resolved_at DESC NULLS LAST
LIMIT 10;

-- Stuck markets (active but past end_time — should auto-resolve eventually)
SELECT id, question, end_time, NOW() - end_time AS overdue
FROM points_markets
WHERE status = 'active'
  AND end_time < NOW() - INTERVAL '6 hours'
  AND archived_at IS NULL
ORDER BY end_time ASC
LIMIT 20;

-- Schema version
SELECT * FROM points_schema_migrations ORDER BY applied_at DESC LIMIT 5;
```

Use the `DATABASE_READ_URL` (which is what the MCP should be wired to) — never run UPDATE/DELETE/INSERT from this skill.

**Fallback: admin diagnostic endpoint**

If the postgres MCP is not available, hit the existing diagnostic:

```bash
curl -s "https://pronos.io/api/points/admin/resolve-diagnostic?key=$MIGRATE_KEY" | head -c 4000
```

Report the table of counts + any anomalies. If the user asked about a specific question (e.g. "did my market actually resolve?"), filter to that market id.
