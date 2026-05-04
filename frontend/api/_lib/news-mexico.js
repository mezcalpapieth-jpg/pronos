/**
 * Mexican news aggregator — Google News RSS backend.
 *
 * The first cut hit each outlet's own RSS feed directly. That broke
 * fast: 7 of 9 sources started returning 404/403 (URLs changed,
 * outlets dropped public RSS, or Cloudflare started blocking
 * non-browser User-Agents). We pivoted to Google News RSS, which:
 *
 *   - Aggregates ~100 articles per query, refreshed every few minutes
 *   - Uses stable redirector URLs (news.google.com/rss/articles/<id>)
 *     that are reliable for our news↔market linking persistence
 *   - Exposes source name via the trailing " - <Outlet>" suffix in
 *     the item title
 *   - Tolerates a regular browser User-Agent without blocking
 *
 * One query per category instead of one feed per outlet, then we
 * filter to a preferred-outlet allowlist so the feed stays curated
 * (you don't drown in random regional / aggregator results).
 *
 * Per-source RSS overrides remain supported via DIRECT_SOURCES if a
 * specific outlet ever ships a stable feed again — the merge logic
 * dedupes by canonical URL, so adding direct sources alongside
 * Google News is safe.
 *
 * Cache: in-memory module-level, 5-min TTL, stale-while-revalidate.
 */

// ─── Preferred outlets (curated allowlist) ──────────────────────────────────
// Items whose Google News-extracted source matches any of these labels
// (case-insensitive substring) survive the post-fetch filter. The
// `priority` field ranks results when multiple outlets cover the same
// story — lower = preferred. `id` is what the frontend reads.
const PREFERRED_SOURCES = [
  { id: 'el-universal',     match: ['el universal'],                priority: 1 },
  { id: 'animal-politico',  match: ['animal político', 'animal politico'], priority: 1 },
  { id: 'aristegui',        match: ['aristegui'],                   priority: 1 },
  { id: 'milenio',          match: ['milenio'],                     priority: 1 },
  { id: 'el-financiero',    match: ['el financiero'],               priority: 1 },
  { id: 'sin-embargo',      match: ['sinembargo', 'sin embargo'],   priority: 2 },
  { id: 'proceso',          match: ['proceso'],                     priority: 2 },
  { id: 'noroeste',         match: ['noroeste'],                    priority: 2 },
  { id: 'debate',           match: ['debate'],                      priority: 2 },
  // Tier-3: high-quality outlets that frequently appear in Google News
  // results and are common picks for Mexican reads. Kept lower priority
  // so the curated nine win when there's overlap.
  { id: 'jornada',          match: ['la jornada', 'jornada'],       priority: 3 },
  { id: 'reforma',          match: ['reforma'],                     priority: 3 },
  { id: 'expansion',        match: ['expansión', 'expansion'],      priority: 3 },
  { id: 'forbes-mx',        match: ['forbes méxico', 'forbes mexico'], priority: 3 },
  { id: 'infobae',          match: ['infobae'],                     priority: 3 },
];

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function matchSource(rawName) {
  const n = normalize(rawName);
  if (!n) return null;
  for (const src of PREFERRED_SOURCES) {
    if (src.match.some(m => n.includes(normalize(m)))) return src;
  }
  return null;
}

// ─── Categories + Google News queries ───────────────────────────────────────
// One Google News query per category. Spanish + Mexico locale filter
// (hl/gl/ceid) so we get Mexican-relevant results. Queries are tuned
// to surface mainstream stories without getting pure-keyword matches
// from random blogs.
export const NEWS_CATEGORIES = [
  'featured',
  'politica',
  'economia',
  'seguridad',
  'internacional',
  'cultura',
  'deportes',
  'farandula',
  'general',
];

const CATEGORY_QUERIES = {
  // 'featured' is composed at read time from items across all
  // categories — no separate query.
  politica:      'política mexico cuando:1d',
  economia:      'economia mexico empresas finanzas cuando:1d',
  seguridad:     'seguridad mexico narcotrafico cuando:1d',
  internacional: 'noticias internacionales mexico cuando:1d',
  cultura:       'cultura mexico arte cuando:2d',
  deportes:      'deportes mexico cuando:1d',
  farandula:     'farandula mexico espectaculos cuando:2d',
  general:       'noticias mexico cuando:1d',
};

const GNEWS_BASE = 'https://news.google.com/rss/search';
const GNEWS_LOCALE = 'hl=es-MX&gl=MX&ceid=MX:es-419';
// Browser-like User-Agent — Google News RSS 302s when called with
// non-browser UAs.
const GNEWS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 PronosNewsBot/1.0';

// Optional direct-RSS sources still working. Empty for now — added
// here when a specific outlet ships a stable feed we want to ingest
// alongside Google News. Same item shape as fetchGoogleCategory.
const DIRECT_SOURCES = [];

// ─── Configuration ──────────────────────────────────────────────────────────
const MAX_ITEMS_PER_CATEGORY = 40;
const MAX_TOTAL_ITEMS = 120;
const MAX_AGE_HOURS = 48;
const CACHE_TTL_MS = 5 * 60_000;
const FEED_TIMEOUT_MS = 8_000;

// ─── URL canonicalization ───────────────────────────────────────────────────
// Strip tracking params + trailing slash so stored news_url and
// looked-up news_url match across feed refreshes. Without this,
// "vincular" links disappear when the source URL gets a fresh utm_*.
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'igshid', '_ga', '_gl',
  'ref', 'ref_src', 'source', 'cmpid', 'spm', 'wt_zmc', 'oc',
]);

export function canonicalizeUrl(raw) {
  if (typeof raw !== 'string' || !raw) return raw;
  try {
    const u = new URL(raw);
    // Drop tracking params.
    const keep = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (!TRACKING_PARAMS.has(k.toLowerCase())) keep.push([k, v]);
    }
    u.search = '';
    for (const [k, v] of keep) u.searchParams.append(k, v);
    // Strip fragment + trailing slash on path.
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

// ─── RSS parser (regex-based, permissive) ───────────────────────────────────

function unwrapCdata(s) {
  if (!s) return '';
  return String(s).replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}
function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
}
function stripHtml(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? unwrapCdata(decodeEntities(m[1])) : '';
}
function extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*/?>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}
function firstImageFromHtml(html) {
  if (!html) return null;
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

// Extract the source name from a Google News title.
// Google News convention: "Headline - Source Name". Some titles
// embed the source mid-string before the trailing " - " — we always
// take the LAST segment after the final " - " separator.
function splitTitleSource(title) {
  if (!title) return { title: '', source: null };
  // Try em-dash first (rare), then hyphen+space.
  const sepIdx = Math.max(title.lastIndexOf(' — '), title.lastIndexOf(' - '));
  if (sepIdx <= 0) return { title: title.trim(), source: null };
  const headline = title.slice(0, sepIdx).trim();
  const source = title.slice(sepIdx + 3).trim();
  // Don't strip if the trailing segment looks like part of the
  // headline (long, has spaces with verbs etc).
  if (source.length > 60) return { title: title.trim(), source: null };
  return { title: headline, source };
}

// Favicon URL for a host name — used as a small visual identifier
// on cards when Google News doesn't include a thumbnail. Falls
// through `https:` in the CSP allowlist.
function faviconForUrl(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch { return null; }
}

function parseGoogleNewsItems(xml) {
  const items = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[0];
    const titleRaw = stripHtml(extractTag(block, 'title'));
    const link = stripHtml(extractTag(block, 'link'));
    if (!titleRaw || !link) continue;

    const { title, source } = splitTitleSource(titleRaw);
    const description = extractTag(block, 'description');
    const summary = stripHtml(description).slice(0, 280);
    const pubDateRaw = extractTag(block, 'pubDate');
    const publishedAt = pubDateRaw ? new Date(pubDateRaw) : null;
    const publishedAtIso = (publishedAt && !Number.isNaN(publishedAt.getTime()))
      ? publishedAt.toISOString() : null;

    // Google News rarely ships images, but check just in case.
    const image =
        extractAttr(block, 'enclosure', 'url')
      || extractAttr(block, 'media:thumbnail', 'url')
      || extractAttr(block, 'media:content', 'url')
      || firstImageFromHtml(description)
      || null;

    items.push({
      title,
      url: canonicalizeUrl(link),
      summary,
      image,
      sourceName: source,           // raw label from title (may be null)
      publishedAt: publishedAtIso,
    });
  }
  return items;
}

// ─── Fetch ──────────────────────────────────────────────────────────────────

async function fetchGoogleCategory(category, signal) {
  const query = CATEGORY_QUERIES[category];
  if (!query) return [];
  const url = `${GNEWS_BASE}?q=${encodeURIComponent(query)}&${GNEWS_LOCALE}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': GNEWS_UA,
        'Accept': 'application/rss+xml, application/xml, */*',
      },
      redirect: 'follow',
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const raw = parseGoogleNewsItems(xml);
    return raw.map(it => ({ ...it, category }));
  } catch (e) {
    console.warn('[news-mexico] gnews fetch failed', { category, error: e?.message });
    return [];
  }
}

// ─── Dedup ──────────────────────────────────────────────────────────────────
// Two passes:
//   1. URL-exact dedup (same canonical URL across categories — one
//      politica story might also surface in 'general')
//   2. Title-shingle Jaccard for cross-outlet near-duplicates ("AMLO
//      announces X" from El Universal + Milenio = same story)

function shingles(s, n = 4) {
  const out = new Set();
  const trimmed = normalize(s).replace(/[^a-z0-9 ]/g, '');
  for (let i = 0; i + n <= trimmed.length; i++) out.add(trimmed.slice(i, i + n));
  return out;
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  return inter / (a.size + b.size - inter);
}
const DEDUP_THRESHOLD = 0.55;

function dedupe(items) {
  // Stable: keep the FIRST item we see (already date-sorted desc).
  const seenUrl = new Set();
  const kept = [];
  const keptShingles = [];
  for (const it of items) {
    if (seenUrl.has(it.url)) continue;
    seenUrl.add(it.url);
    const sh = shingles(it.title, 4);
    let dupe = false;
    for (const ksh of keptShingles) {
      if (jaccard(sh, ksh) >= DEDUP_THRESHOLD) { dupe = true; break; }
    }
    if (dupe) continue;
    kept.push(it);
    keptShingles.push(sh);
  }
  return kept;
}

// ─── Cache + refresh ────────────────────────────────────────────────────────

let cache = { fetchedAt: 0, items: [], debug: {} };
let inFlight = null;

async function refreshCache() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  const debug = { categoryCounts: {}, fetchedAt: new Date().toISOString() };
  try {
    const categories = Object.keys(CATEGORY_QUERIES);
    const all = await Promise.all(
      categories.map(c => fetchGoogleCategory(c, controller.signal)),
    );
    let items = all.flat();
    debug.rawCount = items.length;

    // Filter to preferred outlets + tag with our outlet id.
    const filtered = [];
    for (const it of items) {
      const src = matchSource(it.sourceName);
      if (!src) continue;
      filtered.push({
        ...it,
        sourceId: src.id,
        sourceName: it.sourceName, // keep raw for display
        sourcePriority: src.priority,
        // Favicon serves as a lightweight visual identifier when the
        // article doesn't ship its own thumbnail (Google News usually
        // doesn't). Falls through `https:` in the CSP allowlist.
        favicon: faviconForUrl(it.url),
      });
    }
    debug.preferredCount = filtered.length;

    // Drop too-old items.
    const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60_000;
    let recent = filtered.filter(i => i.publishedAt
      && new Date(i.publishedAt).getTime() >= cutoff);
    debug.recentCount = recent.length;

    // Sort newest first, then dedupe.
    recent.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    let deduped = dedupe(recent);
    debug.dedupedCount = deduped.length;

    // Per-category trim so we have variety in 'featured'.
    const perCat = {};
    const balanced = [];
    for (const it of deduped) {
      const c = it.category || 'general';
      perCat[c] = (perCat[c] || 0) + 1;
      if (perCat[c] <= MAX_ITEMS_PER_CATEGORY) balanced.push(it);
    }
    debug.balancedCount = balanced.length;

    // Hard cap on total.
    const final = balanced.slice(0, MAX_TOTAL_ITEMS);

    // Per-category counts for the API debug response.
    for (const it of final) {
      debug.categoryCounts[it.category] = (debug.categoryCounts[it.category] || 0) + 1;
    }

    cache = { fetchedAt: Date.now(), items: final, debug };
  } catch (e) {
    console.error('[news-mexico] refresh failed', { message: e?.message });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Public: returns up to MAX_TOTAL_ITEMS news items, optionally filtered
 * by category. Featured = mixed across categories, sorted by date.
 */
export async function getMexicanNews({ category = 'featured', limit = MAX_TOTAL_ITEMS } = {}) {
  const now = Date.now();
  const cacheAge = now - (cache.fetchedAt || 0);
  const stale = cacheAge >= CACHE_TTL_MS;
  const empty = !cache.items?.length;

  if (empty) {
    if (!inFlight) inFlight = refreshCache().finally(() => { inFlight = null; });
    await inFlight;
  } else if (stale) {
    if (!inFlight) inFlight = refreshCache().finally(() => { inFlight = null; });
  }

  const counts = {};
  for (const it of cache.items) counts[it.category] = (counts[it.category] || 0) + 1;

  let filtered = cache.items;
  if (category && category !== 'featured') {
    filtered = cache.items.filter(it => it.category === category);
  }
  filtered = filtered.slice(0, limit);

  return {
    fetchedAt: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
    cacheAgeMs: cacheAge,
    cacheTtlMs: CACHE_TTL_MS,
    items: filtered,
    counts,
    totalCount: cache.items.length,
    sources: PREFERRED_SOURCES.map(s => ({ id: s.id, priority: s.priority })),
    debug: cache.debug,
  };
}

export const VALID_CATEGORIES = NEWS_CATEGORIES;
