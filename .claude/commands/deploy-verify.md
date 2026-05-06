---
description: Smoke-test pronos.io after a Vercel deploy — checks home, gate, news, points markets endpoints
---

You are running a post-deploy smoke test. Hit the live site and report PASS/FAIL for each check. Run all curls in parallel where possible.

```bash
# 1. Home page returns 200
curl -sI https://pronos.io/ | head -1

# 2. Points markets list returns valid JSON (catches DB / module-load 500s)
curl -s 'https://pronos.io/api/points/markets?status=active&limit=5' | head -c 600

# 3. Resolved markets — verifies the resolved_at DESC sort fix is live
curl -s 'https://pronos.io/api/points/markets?status=resolved&featured=all&limit=5' | head -c 600

# 4. Gate endpoint exists (verifies MVP_ACCESS_PASSWORD wiring)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://pronos.io/api/gate \
  -H 'Content-Type: application/json' -d '{"password":"wrong"}'
# expect 401 (correct password rejection) or 500 (env var missing) — never 404

# 5. News endpoint returns >0 items
curl -s 'https://pronos.io/api/points/news?category=featured&limit=5' | head -c 600
```

For each:
- PASS: 2xx + valid JSON shape
- FAIL: 4xx/5xx, NOT_FOUND, or empty JSON
- Report the failing endpoint with status code + first 100 chars of response body
- If a 5xx appears, suggest checking Vercel function logs (use the vercel MCP if connected)

After running, give a one-line summary like `5/5 PASS` or `news endpoint returned 0 items — check news-mexico.js refreshCache logs in Vercel`.
