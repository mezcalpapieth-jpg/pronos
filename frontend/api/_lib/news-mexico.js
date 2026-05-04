/**
 * Mexican news RSS aggregator.
 *
 * Pulls RSS feeds from a curated list of Mexican news outlets, parses
 * them into a normalized item shape, classifies into sub-categories
 * (política / economía / seguridad / internacional / cultura / deportes /
 * farándula / general), dedupes near-duplicate headlines that ran across
 * multiple outlets, sorts by publication date, and returns the top N.
 *
 * No new dependency: the parser is regex-based, which is fine for RSS
 * 2.0 / Atom (the structures we care about — title, link, description,
 * pubDate, category, image) are simple enough that pulling in a full
 * XML library would be overkill. Per-outlet quirks (different image
 * field names, CDATA wrapping, summary in description vs content:encoded)
 * are handled by the permissive extractors below.
 *
 * Cache:
 *   - In-memory module-level cache, 5-minute TTL.
 *   - Stale-while-revalidate: if cache is stale we serve the stale
 *     copy AND kick off a refresh in the background. Rare-cold-cache
 *     callers (first hit after deploy) wait for a fresh fetch.
 *
 * Image strategy ("the easy way"):
 *   - Hotlink from each outlet's CDN. CSP `img-src` allows `https:` so
 *     any HTTPS image source loads. Some sites block hotlinking and
 *     will return 403 — those broken images will be reported back so we
 *     can decide on a proxy / specific allowlist later.
 */

const SOURCES = [
  { id: 'el-universal',      name: 'El Universal',      rss: 'https://www.eluniversal.com.mx/rss.xml',                         lean: 'center'         },
  { id: 'animal-politico',   name: 'Animal Político',   rss: 'https://www.animalpolitico.com/feed/',                            lean: 'left'           },
  { id: 'aristegui',         name: 'Aristegui Noticias',rss: 'https://aristeguinoticias.com/feed/',                             lean: 'independent'    },
  { id: 'milenio',           name: 'Milenio',           rss: 'https://www.milenio.com/rss',                                     lean: 'center'         },
  { id: 'el-financiero',     name: 'El Financiero',     rss: 'https://www.elfinanciero.com.mx/rss/',                            lean: 'center-right'   },
  { id: 'sin-embargo',       name: 'Sin Embargo',       rss: 'https://www.sinembargo.mx/feed',                                  lean: 'left'           },
  { id: 'proceso',           name: 'Proceso',           rss: 'https://www.proceso.com.mx/rss',                                  lean: 'investigative'  },
  { id: 'noroeste',          name: 'Noroeste',          rss: 'https://www.noroeste.com.mx/rss/',                                lean: 'regional'       },
  { id: 'debate',            name: 'El Debate',         rss: 'https://www.debate.com.mx/rss/portada.xml',                       lean: 'regional'       },
];

// Total cap — we only ever return this many items even if the dedup
// pass leaves more. Keeps the page light.
const MAX_ITEMS = 60;
// Drop items older than this — old news is dead news.
const MAX_AGE_HOURS = 36;
const CACHE_TTL_MS = 5 * 60_000;
// Per-feed fetch timeout — slow feeds shouldn't block the whole batch.
const FEED_TIMEOUT_MS = 6_000;

// ─── Categories ─────────────────────────────────────────────────────────────
// Sub-tab values used by the frontend — order matters (= UI order).
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

// Keyword classifier. Each rule maps a category → array of regex patterns
// (case-insensitive, accent-insensitive after we normalize). First match
// wins. If nothing matches, we use the RSS feed's own <category> tag if
// it looks like one of our buckets; otherwise 'general'.
const CATEGORY_KEYWORDS = {
  politica: [
    /\bsheinbaum\b/, /\bamlo\b/, /\bobrador\b/, /\bmorena\b/,
    /\bpan\b/, /\bpri\b/, /\bprd\b/, /\bmovimiento ciudadano\b/,
    /\bsenad\w+/, /\bdiputad\w+/, /\bcongres\w+/, /\bcamara\b/,
    /\belector\w+/, /\bvotacion\w+/, /\bgobern\w+/, /\bcandidat\w+/,
    /\bpresident\w+/, /\bsecretari\w+ de \w+/, /\binem\b/, /\bsuprema corte\b/,
    /\bconstituci\w+/, /\bley\b/, /\bdecreto\b/, /\breforma\b/,
  ],
  economia: [
    /\bpeso\b/, /\bdolar\b/, /\binflacion\b/, /\bbanxico\b/, /\btasas?\b/,
    /\bpib\b/, /\bcrecimiento economic\w+/, /\bremesa\w+/, /\bemple\w+/,
    /\bsalario\b/, /\bpemex\b/, /\bcfe\b/, /\binversion\w+/,
    /\bfinanzas\b/, /\bhacienda\b/, /\bsat\b/, /\baranc\w+/, /\btlcan\b/,
    /\bt-mec\b/, /\btmec\b/, /\bbolsa\b/, /\bibovespa\b/, /\bbmv\b/,
  ],
  seguridad: [
    /\bnarco\w+/, /\bcartel\b/, /\bcjng\b/, /\bsinaloa\b.*\bcartel/,
    /\bmatanza\b/, /\bhomicidi\w+/, /\bsicari\w+/, /\barmas?\b/,
    /\bdetenid\w+/, /\bdetenci\w+/, /\boperat\w+/, /\bguardia nacional\b/,
    /\bsedena\b/, /\bmarina\b.*armad/, /\bfgr\b/, /\bfiscal\w+/,
    /\bsecuestr\w+/, /\bdesapareci\w+/, /\bextorsion\w+/, /\bbloqu\w+/,
  ],
  internacional: [
    /\bestados unidos\b/, /\beeuu\b/, /\beua\b/, /\btrump\b/, /\bbiden\b/,
    /\bharris\b/, /\bsenado.*estad\w+/, /\bisrael\b/, /\bgaza\b/, /\bpalestin\w+/,
    /\bucrania\b/, /\brusia\b/, /\bputin\b/, /\bzelensk\w+/,
    /\bchina\b/, /\bxi jinping\b/, /\bcorea\b/, /\bjapon\b/, /\beuropa\b/,
    /\bunion europea\b/, /\bonu\b/, /\botan\b/, /\bnaciones unidas\b/,
    /\bcanada\b/, /\bcumbre\b/, /\btratado\b/,
  ],
  cultura: [
    /\bmuseo\b/, /\bexposicion\w+/, /\bteatro\b/, /\bobra\b/,
    /\bnovela\b/, /\blibro\b/, /\bpoes\w+/, /\bescritor\w+/, /\bautor\w+/,
    /\bmusica\b/, /\bconcierto\b/, /\bdisco\b/, /\bfilm\b/, /\bcine\b/,
    /\bpelicula\b/, /\bdirector cinematogr\w+/, /\bestreno\b/,
    /\bbellas artes\b/, /\bunesco\b/, /\bpatrimonio\b/,
  ],
  deportes: [
    /\bfutbol\b/, /\bliga mx\b/, /\bseleccion mexican\w+/, /\bel tri\b/,
    /\bconcacaf\b/, /\bcopa\b/, /\bmundial\b/, /\bclasico\b/, /\bgol\b/,
    /\bnba\b/, /\bnfl\b/, /\bmlb\b/, /\bbox\w+/, /\bpelea\b/,
    /\bcanelo\b/, /\bf1\b/, /\bformula 1\b/, /\bgrand prix\b/, /\bgran premio\b/,
    /\bolimpic\w+/, /\bjuegos olim/, /\btenis\b/, /\bgolf\b/,
  ],
  farandula: [
    /\bbelinda\b/, /\bdanna paola\b/, /\bgloria trevi\b/, /\bthalia\b/,
    /\bjuanga\b/, /\bjuan gabriel\b/, /\beugenio derbez\b/,
    /\bnovela\b.*\btelevisa\b/, /\btelevisa\b/, /\baztec\w+ uno\b/,
    /\bla casa de los famosos\b/, /\bbig brother\b/, /\binstagram\b/,
    /\btiktok\b/, /\bmiss universo\b/, /\bmiss mexico\b/,
    /\baeropuerto\b.*celebridad/, /\bex novi[ao]\b/, /\bhija de\b/,
  ],
};

// Normalize text for keyword matching: lowercase + strip diacritics.
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Map a feed's own <category> tag to one of our buckets where the
// match is unambiguous. Returns null if unknown.
function mapFeedCategory(raw) {
  const n = normalize(raw);
  if (!n) return null;
  if (n.includes('politic'))            return 'politica';
  if (n.includes('econom') || n.includes('finanz') || n.includes('negoci')) return 'economia';
  if (n.includes('segurid') || n.includes('justicia') || n.includes('policiac')) return 'seguridad';
  if (n.includes('internacional') || n.includes('mundo')) return 'internacional';
  if (n.includes('cultur') || n.includes('arte') || n.includes('libro')) return 'cultura';
  if (n.includes('deporte'))            return 'deportes';
  if (n.includes('farandul') || n.includes('espectacul') || n.includes('gente')) return 'farandula';
  if (n.includes('estilo') || n.includes('tendenci'))   return 'farandula'; // best-fit bucket
  if (n.includes('tecnolog') || n.includes('cienci'))   return 'general';   // no dedicated bucket yet
  return null;
}

function classify(item) {
  const text = normalize(`${item.title} ${item.summary || ''}`);
  for (const [cat, patterns] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const re of patterns) {
      if (re.test(text)) return cat;
    }
  }
  // Fallback to feed's own <category> if it maps cleanly.
  for (const raw of (item.feedCategories || [])) {
    const mapped = mapFeedCategory(raw);
    if (mapped) return mapped;
  }
  return 'general';
}

// ─── RSS parser ─────────────────────────────────────────────────────────────
// Permissive regex-based extractor. Handles:
//   - Plain element values: <title>x</title>
//   - CDATA wrappers:       <title><![CDATA[x]]></title>
//   - Self-closing tags:    <enclosure url="..." />
//   - media:* and content:* namespaces
//
// Not built for: Atom 1.0 (most Mexican feeds are RSS 2.0), nested
// custom namespaces. If a source produces Atom, we'd see empty items
// and add a branch. So far the SOURCES list above is RSS 2.0.

function unwrapCdata(s) {
  if (!s) return '';
  return String(s)
    .replace(/^\s*<!\[CDATA\[/, '')
    .replace(/\]\]>\s*$/, '')
    .trim();
}

function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pull the FIRST <img src="..."> from an HTML blob (typical pattern in
// description / content:encoded for sites that don't ship media:thumbnail).
function firstImageFromHtml(html) {
  if (!html) return null;
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function extractTag(xml, tag) {
  // Match <tag>...</tag> non-greedily, with optional attributes.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? unwrapCdata(decodeEntities(m[1])) : '';
}

function extractAllTags(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push(unwrapCdata(decodeEntities(m[1])));
  }
  return out;
}

// Pull a self-closing or empty tag's attribute. e.g.
// extractAttr(xml, 'enclosure', 'url') → 'https://...'
function extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*/?>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

function parseItems(xml, source) {
  const items = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[0];
    const title = stripHtml(extractTag(block, 'title'));
    const link  = stripHtml(extractTag(block, 'link'));
    if (!title || !link) continue;

    // Description comes in two flavors: <description> (short) and
    // <content:encoded> (full HTML). Prefer description for the
    // summary; pull image from whichever has one.
    const description = extractTag(block, 'description');
    const contentEncoded = extractTag(block, 'content:encoded');
    const summaryHtml = description || contentEncoded || '';
    const summary = stripHtml(summaryHtml).slice(0, 280);

    // Image: enclosure → media:thumbnail → media:content → first <img>
    const image =
         extractAttr(block, 'enclosure', 'url')
      || extractAttr(block, 'media:thumbnail', 'url')
      || extractAttr(block, 'media:content', 'url')
      || firstImageFromHtml(contentEncoded || description)
      || null;

    const pubDateRaw = extractTag(block, 'pubDate') || extractTag(block, 'dc:date');
    const publishedAt = pubDateRaw ? new Date(pubDateRaw) : null;
    const publishedAtIso = (publishedAt && !Number.isNaN(publishedAt.getTime()))
      ? publishedAt.toISOString() : null;

    const feedCategories = extractAllTags(block, 'category')
      .map(c => stripHtml(c))
      .filter(Boolean);

    const guidRaw = extractTag(block, 'guid');
    const guid = stripHtml(guidRaw) || link;

    items.push({
      sourceId: source.id,
      sourceName: source.name,
      sourceLean: source.lean,
      title,
      url: link,
      summary,
      image,
      publishedAt: publishedAtIso,
      feedCategories,
      guid,
    });
  }
  return items;
}

// ─── Fetcher ────────────────────────────────────────────────────────────────

async function fetchOneSource(source, signal) {
  try {
    const res = await fetch(source.rss, {
      headers: {
        'User-Agent': 'PronosBot/1.0 (https://pronos.io; news aggregator)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return parseItems(xml, source);
  } catch (e) {
    console.warn('[news-mexico] feed fetch failed', { sourceId: source.id, error: e?.message });
    return [];
  }
}

// ─── Dedup ──────────────────────────────────────────────────────────────────
// Two items are considered the same story if their normalized titles
// are highly overlapping. We use a cheap shingle-based Jaccard
// approximation rather than full Levenshtein — fast for ~60 items.

function shingles(s, n = 3) {
  const out = new Set();
  const trimmed = normalize(s).replace(/[^a-z0-9 ]/g, '');
  for (let i = 0; i + n <= trimmed.length; i++) {
    out.add(trimmed.slice(i, i + n));
  }
  return out;
}

function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const v of setA) if (setB.has(v)) inter++;
  const union = setA.size + setB.size - inter;
  return inter / union;
}

const DEDUP_THRESHOLD = 0.55;

function dedupe(items) {
  // Stable: keep the FIRST item we see (already sorted by date descending
  // when called), drop later near-duplicates.
  const kept = [];
  const keptShingles = [];
  for (const item of items) {
    const sh = shingles(item.title, 4);
    let dupe = false;
    for (const ksh of keptShingles) {
      if (jaccard(sh, ksh) >= DEDUP_THRESHOLD) { dupe = true; break; }
    }
    if (!dupe) {
      kept.push(item);
      keptShingles.push(sh);
    }
  }
  return kept;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

let cache = { fetchedAt: 0, items: [] };
let inFlight = null;

async function refreshCache() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const all = await Promise.all(
      SOURCES.map(s => fetchOneSource(s, controller.signal)),
    );
    let items = all.flat();

    // Drop items without dates or older than MAX_AGE_HOURS.
    const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60_000;
    items = items.filter(i => i.publishedAt && new Date(i.publishedAt).getTime() >= cutoff);

    // Sort newest first BEFORE dedup so we keep the freshest copy of
    // any cross-outlet duplicate.
    items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    items = dedupe(items);

    // Classify each item once (cached on the row).
    for (const it of items) {
      it.category = classify(it);
    }

    cache = { fetchedAt: Date.now(), items: items.slice(0, MAX_ITEMS) };
  } catch (e) {
    console.error('[news-mexico] refresh failed', { message: e?.message });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Public: returns up to MAX_ITEMS news items, optionally filtered by
 * category. Featured = top items across all categories, sorted by date.
 *
 * Returns a structure ready to ship as JSON to the client:
 *   {
 *     fetchedAt: <ISO>,
 *     items: [...],
 *     counts: { politica: N, economia: N, ... },
 *     sources: [{ id, name, lean }, ...]
 *   }
 */
export async function getMexicanNews({ category = 'featured', limit = MAX_ITEMS } = {}) {
  const now = Date.now();
  const cacheAge = now - (cache.fetchedAt || 0);
  const stale = cacheAge >= CACHE_TTL_MS;
  const empty = !cache.items?.length;

  if (empty) {
    // Cold — wait for a fresh fetch.
    if (!inFlight) inFlight = refreshCache().finally(() => { inFlight = null; });
    await inFlight;
  } else if (stale) {
    // Stale-while-revalidate — serve current, kick a background refresh.
    if (!inFlight) inFlight = refreshCache().finally(() => { inFlight = null; });
  }

  const counts = {};
  for (const item of cache.items) {
    counts[item.category] = (counts[item.category] || 0) + 1;
  }

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
    sources: SOURCES.map(s => ({ id: s.id, name: s.name, lean: s.lean })),
  };
}

// Exposed for the API endpoint to validate `?category=` input.
export const VALID_CATEGORIES = NEWS_CATEGORIES;
