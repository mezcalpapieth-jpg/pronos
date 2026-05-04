/**
 * Mexican news aggregator — Google News RSS backend, per-outlet queries.
 *
 * Three iterations of evolution informed this design:
 *
 *  v1 — direct outlet RSS. Broke fast: 7 of 9 outlets dropped their
 *       public feeds or started 404/403'ing on bot User-Agents.
 *
 *  v2 — Google News with category-keyword queries
 *       (`?q=politica mexico`). Result: 99% El País, none of the
 *       intended Mexican outlets. Google's ranking algorithm doesn't
 *       favor specific outlets in keyword search.
 *
 *  v3 (current) — per-outlet `site:` queries via Google News. Each
 *       outlet gets its own request that returns ~100 of THAT
 *       outlet's recent stories. We classify into categories
 *       post-fetch via a keyword regex, then merge/dedupe/sort.
 *       Source attribution is tagged at fetch time (we know exactly
 *       which outlet each item came from), so the strict allowlist
 *       filter from v2 is unnecessary.
 *
 * Cache: in-memory module-level, 5-min TTL, stale-while-revalidate.
 *
 * ToS note: Google News RSS technically restricts commercial use.
 * Acceptable for MVP scale; swap to TheNewsAPI / NewsAPI.org if
 * scale or licensing concerns become real.
 */

// ─── Outlets ────────────────────────────────────────────────────────────────
// Each outlet maps to a `site:<host>` Google News query. The id +
// name + lean fields are kept for the API response and per-outlet
// debug. Add or drop outlets by editing this array — no other
// changes required.
const OUTLETS = [
  { id: 'el-universal',    name: 'El Universal',       host: 'eluniversal.com.mx',     lean: 'center',         priority: 1 },
  { id: 'animal-politico', name: 'Animal Político',    host: 'animalpolitico.com',     lean: 'left',           priority: 1 },
  { id: 'aristegui',       name: 'Aristegui Noticias', host: 'aristeguinoticias.com',  lean: 'independent',    priority: 1 },
  { id: 'milenio',         name: 'Milenio',            host: 'milenio.com',            lean: 'center',         priority: 1 },
  { id: 'el-financiero',   name: 'El Financiero',      host: 'elfinanciero.com.mx',    lean: 'center-right',   priority: 1 },
  { id: 'sin-embargo',     name: 'Sin Embargo',        host: 'sinembargo.mx',          lean: 'left',           priority: 2 },
  { id: 'proceso',         name: 'Proceso',            host: 'proceso.com.mx',         lean: 'investigative',  priority: 2 },
  { id: 'noroeste',        name: 'Noroeste',           host: 'noroeste.com.mx',        lean: 'regional',       priority: 2 },
  { id: 'debate',          name: 'El Debate',          host: 'debate.com.mx',          lean: 'regional',       priority: 2 },
];

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
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

// Category classifier — applied to each item's title + summary
// AFTER fetching from per-outlet feeds. First matching pattern wins;
// items that don't match any pattern are tagged 'general'. Keywords
// are matched on the diacritic-stripped lowercase form.
const CATEGORY_KEYWORDS = {
  politica: [
    /\bsheinbaum\b/, /\bamlo\b/, /\bobrador\b/, /\bmorena\b/,
    /\bpan\b/, /\bpri\b/, /\bprd\b/, /\bmovimiento ciudadano\b/,
    /\bsenad\w+/, /\bdiputad\w+/, /\bcongres\w+/, /\bcamara\b/,
    /\belector\w+/, /\bvotacion\w+/, /\bgobern\w+/, /\bcandidat\w+/,
    /\bpresident\w+/, /\bsecretari\w+ de \w+/, /\bine\b/, /\bsuprema corte\b/,
    /\bconstituci\w+/, /\bdecreto\b/, /\breforma\b/, /\bpolitic\w+/,
  ],
  economia: [
    /\bpeso\b/, /\bdolar\b/, /\binflacion\b/, /\bbanxico\b/, /\btasas?\b/,
    /\bpib\b/, /\bcrecimiento economic\w+/, /\bremesa\w+/, /\bemple\w+/,
    /\bsalario\b/, /\bpemex\b/, /\bcfe\b/, /\binversion\w+/,
    /\bfinanzas\b/, /\bhacienda\b/, /\bsat\b/, /\baranc\w+/, /\btlcan\b/,
    /\bt-mec\b/, /\btmec\b/, /\bbolsa\b/, /\bbmv\b/, /\beconomi\w+/,
    /\bnegoci\w+/, /\bempresa\w+/,
  ],
  seguridad: [
    /\bnarco\w+/, /\bcartel\b/, /\bcjng\b/,
    /\bmatanza\b/, /\bhomicidi\w+/, /\bsicari\w+/, /\barmas?\b/,
    /\bdetenid\w+/, /\bdetenci\w+/, /\boperat\w+/, /\bguardia nacional\b/,
    /\bsedena\b/, /\bfgr\b/, /\bfiscal\w+/,
    /\bsecuestr\w+/, /\bdesapareci\w+/, /\bextorsion\w+/, /\bbloqu\w+/,
    /\bviolenc\w+/, /\bbalacer\w+/,
  ],
  internacional: [
    /\bestados unidos\b/, /\beeuu\b/, /\beua\b/, /\btrump\b/, /\bbiden\b/,
    /\bharris\b/, /\bisrael\b/, /\bgaza\b/, /\bpalestin\w+/,
    /\bucrania\b/, /\brusia\b/, /\bputin\b/, /\bzelensk\w+/,
    /\bchina\b/, /\bxi jinping\b/, /\bcorea\b/, /\bjapon\b/, /\beuropa\b/,
    /\bunion europea\b/, /\bonu\b/, /\botan\b/, /\bnaciones unidas\b/,
    /\bcanada\b/, /\bcumbre\b/, /\btratado\b/, /\bbritani\w+/,
    /\bargentina\b/, /\bbrasil\b/, /\bvenezuela\b/, /\bcuba\b/,
  ],
  cultura: [
    /\bmuseo\b/, /\bexposicion\w+/, /\bteatro\b/, /\bobra\b/,
    /\bnovela\b/, /\blibro\b/, /\bpoes\w+/, /\bescritor\w+/, /\bautor\w+/,
    /\bmusica\b/, /\bconcierto\b/, /\bdisco\b/, /\bfilm\b/, /\bcine\b/,
    /\bpelicula\b/, /\bdirector cinematogr\w+/, /\bestreno\b/,
    /\bbellas artes\b/, /\bunesco\b/, /\bpatrimonio\b/, /\barte\b/,
  ],
  deportes: [
    /\bfutbol\b/, /\bliga mx\b/, /\bseleccion mexican\w+/, /\bel tri\b/,
    /\bconcacaf\b/, /\bcopa\b/, /\bmundial\b/, /\bclasico\b/, /\bgol\b/,
    /\bnba\b/, /\bnfl\b/, /\bmlb\b/, /\bbox\w+/, /\bpelea\b/,
    /\bcanelo\b/, /\bf1\b/, /\bformula 1\b/, /\bgrand prix\b/, /\bgran premio\b/,
    /\bolimpic\w+/, /\bjuegos olim/, /\btenis\b/, /\bgolf\b/, /\bdeport\w+/,
    /\bbeisbol\b/, /\bbasquet\w+/,
  ],
  farandula: [
    /\bbelinda\b/, /\bdanna paola\b/, /\bgloria trevi\b/, /\bthalia\b/,
    /\beugenio derbez\b/, /\btelevisa\b/, /\baztec\w+ uno\b/,
    /\bla casa de los famosos\b/, /\bbig brother\b/,
    /\bmiss universo\b/, /\bmiss mexico\b/, /\bfarandul\w+/,
    /\bespectacul\w+/, /\bcantante\b/, /\bactor\b/, /\bactriz\b/,
  ],
};

function classify(item) {
  const text = normalize(`${item.title} ${item.summary || ''}`);
  for (const [cat, patterns] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const re of patterns) if (re.test(text)) return cat;
  }
  return 'general';
}

const GNEWS_BASE = 'https://news.google.com/rss/search';
const GNEWS_LOCALE = 'hl=es-MX&gl=MX&ceid=MX:es-419';
// Browser-like User-Agent — Google News RSS 302s when called with
// non-browser UAs.
const GNEWS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 PronosNewsBot/1.0';

// ─── Configuration ──────────────────────────────────────────────────────────
const ITEMS_PER_OUTLET = 20;       // top-N most-recent items per outlet
const MAX_TOTAL_ITEMS = 180;       // hard cap across all outlets
const MAX_AGE_HOURS = 48;
const CACHE_TTL_MS = 5 * 60_000;
const FEED_TIMEOUT_MS = 8_000;     // per-outlet timeout (independent)

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

// Fetch one outlet's feed via Google News' site:-scoped query.
// Each outlet gets its own AbortController so a slow outlet can't
// drag down the parallel batch. Returns up to ITEMS_PER_OUTLET
// recent items, all already tagged with the outlet's id/name.
async function fetchOneOutlet(outlet) {
  const q = `site:${outlet.host}`;
  const url = `${GNEWS_BASE}?q=${encodeURIComponent(q)}&${GNEWS_LOCALE}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': GNEWS_UA,
        'Accept': 'application/rss+xml, application/xml, */*',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const raw = parseGoogleNewsItems(xml);
    // Tag each item with the outlet metadata. The Google News-
    // extracted source name (from " - <Outlet>" suffix) is kept
    // around for display, but the canonical sourceId/Name come
    // from the OUTLETS config — that's what the frontend reads.
    return raw.slice(0, ITEMS_PER_OUTLET).map(it => ({
      ...it,
      sourceId: outlet.id,
      sourceName: outlet.name,
      sourceLean: outlet.lean,
      sourcePriority: outlet.priority,
      favicon: faviconForUrl(it.url),
    }));
  } catch (e) {
    console.warn('[news-mexico] outlet fetch failed', { outletId: outlet.id, error: e?.message });
    return { __error: e?.message || 'fetch_failed', outletId: outlet.id };
  } finally {
    clearTimeout(timer);
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
  const debug = {
    fetchedAt: new Date().toISOString(),
    perOutlet: {},
    categoryCounts: {},
  };
  try {
    // Each outlet gets its own AbortController inside fetchOneOutlet,
    // so one slow source doesn't kill the rest. Failed fetches return
    // an { __error, outletId } sentinel that we surface in `debug`.
    const results = await Promise.all(OUTLETS.map(o => fetchOneOutlet(o)));

    let items = [];
    for (let i = 0; i < OUTLETS.length; i++) {
      const outlet = OUTLETS[i];
      const r = results[i];
      if (Array.isArray(r)) {
        debug.perOutlet[outlet.id] = { ok: true, count: r.length };
        items = items.concat(r);
      } else {
        debug.perOutlet[outlet.id] = { ok: false, error: r?.__error || 'unknown' };
      }
    }
    debug.rawCount = items.length;

    // Drop too-old items.
    const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60_000;
    items = items.filter(i => i.publishedAt
      && new Date(i.publishedAt).getTime() >= cutoff);
    debug.recentCount = items.length;

    // Classify each item by keywords (politica / economia / etc.).
    for (const it of items) it.category = classify(it);

    // Sort newest first, then dedupe by URL + near-duplicate title.
    items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    items = dedupe(items);
    debug.dedupedCount = items.length;

    // Hard cap.
    items = items.slice(0, MAX_TOTAL_ITEMS);

    // Per-category counts for the debug response.
    for (const it of items) {
      debug.categoryCounts[it.category] = (debug.categoryCounts[it.category] || 0) + 1;
    }

    cache = { fetchedAt: Date.now(), items, debug };
  } catch (e) {
    console.error('[news-mexico] refresh failed', { message: e?.message });
    debug.fatalError = e?.message || 'unknown';
    cache = { ...cache, debug };
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
    sources: OUTLETS.map(o => ({ id: o.id, name: o.name, lean: o.lean })),
    debug: cache.debug,
  };
}

export const VALID_CATEGORIES = NEWS_CATEGORIES;
