---
description: Diagnose news feed health — per-outlet count, sample timestamps, classifier coverage, fallback usage
---

You are diagnosing the news feed. Pull the live feed and produce a structured health report.

```bash
curl -s 'https://pronos.io/api/points/news?category=featured&limit=60' > /tmp/pronos-news.json
```

Then parse `/tmp/pronos-news.json` (use `jq` if available, otherwise inline node) and report:

**Per-outlet count**
- Group items by `sourceId`, count each
- Flag any outlet with 0 items as BROKEN (likely fetch failure in `news-mexico.js`)

**Timestamp health**
- Oldest publishedAt
- Newest publishedAt
- How many items have `publishedAtSource: 'first-seen'` (fallback) vs real dates
- If >70% are 'first-seen', the URL-date extractor + first-seen tracker is doing too much work; investigate why outlet HTML/URL extraction is failing

**Category coverage**
- Iterate `item.categories[]`, count per category
- Flag if `general` > 30% of items (classifier is leaking too many to "Otras")
- Flag if any category has 0 items

**Sample titles**
- 3 example titles per outlet, with their `categories` array

**Per-outlet contribution to top 60**
- After round-robin in news-mexico.js, every outlet should have at least 1 item if it has any items in the cache. If an outlet has 0 in the response but >0 in the cache (per the per-outlet stats endpoint if available), the round-robin logic is broken.

End with a one-paragraph diagnosis: "Healthy" / "Outlet X stopped fetching" / "Classifier needs tuning for Y" / etc.
