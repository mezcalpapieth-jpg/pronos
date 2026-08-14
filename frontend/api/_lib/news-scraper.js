/**
 * Per-outlet homepage scraper for Mexican news sites.
 *
 * Fallback to Google News (no images) was leaving 8 of 9 outlets
 * imageless. Most outlets render their homepage as static HTML
 * with `<article>` blocks containing href + image + headline, so a
 * regex-heavy scraper can extract real items + images for them.
 *
 * Per-outlet config in OUTLET_SCRAPERS below. The generic
 * extractItemFromBlock() handles the common cases:
 *   - title:  first <h1..h4> with non-trivial text
 *   - href:   first <a href> in the block (relative URLs resolved
 *             against outlet.host)
 *   - image:  in priority order: <source srcset>, <img srcset>,
 *             <img src> with whitespace-tolerant regex,
 *             <img data-src> for lazy-loaded, and a Next.js image
 *             wrapper (/_next/image/?url=…) decoded.
 *   - summary: first <p> with >40 chars OR first text in
 *             itemProp="description"
 *
 * Per-outlet overrides can supply custom selectors / image
 * resolvers when the generic parser misses too many cards.
 */

import { canonicalizeUrl } from './news-mexico.js';

// HTML utilities — minimal, matches the ones in news-mexico.js so the
// scraper is self-contained.
function unwrapCdata(s) {
  return String(s || '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#x2F;/g, '/');
}
function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function cleanText(s) {
  return stripHtml(unwrapCdata(decodeEntities(s)));
}

function resolveUrl(maybeRelative, host) {
  if (!maybeRelative) return null;
  const s = String(maybeRelative).trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('//')) return 'https:' + s;
  if (s.startsWith('/')) return `https://www.${host}${s}`;
  return `https://www.${host}/${s}`;
}

// Decode Next.js image-optimization wrapper paths like
// /_next/image/?url=https%3A%2F%2Fcdn.example.com%2Fimg.jpg&w=750&q=75
function decodeNextImageUrl(src) {
  if (!src) return src;
  const m = src.match(/[/?&]url=([^&"']+)/);
  if (!m) return src;
  try { return decodeURIComponent(m[1]); } catch { return src; }
}

function extractFirstHref(block) {
  const m = block.match(/<a\b[^>]*\bhref=["']([^"'#]+)["']/i);
  return m ? m[1] : null;
}

function extractFirstImage(block) {
  // Priority 1: <source srcset="..."> within <picture>. First entry
  // before space/comma is the lowest-density variant.
  const srcset = block.match(/<source\b[^>]*\bsrcset=["']([^"',]+)/i);
  if (srcset && srcset[1]) {
    return decodeNextImageUrl(srcset[1].trim().split(/\s+/)[0]);
  }
  // Priority 2: <img srcset="..."> directly
  const imgSrcset = block.match(/<img\b[\s\S]{0,400}?\bsrcset=["']([^"',]+)/i);
  if (imgSrcset && imgSrcset[1]) {
    return decodeNextImageUrl(imgSrcset[1].trim().split(/\s+/)[0]);
  }
  // Priority 3: data-src (lazy-loaded). Must come BEFORE plain src
  // because lazy-load images often have a placeholder gif on src=.
  const dataSrc = block.match(/<img\b[\s\S]{0,400}?\bdata-src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i)
    || block.match(/<img\b[\s\S]{0,400}?\bdata-lazy-src=["']([^"']+)["']/i)
    || block.match(/<img\b[\s\S]{0,400}?\bdata-original=["']([^"']+)["']/i);
  if (dataSrc && dataSrc[1]) return decodeNextImageUrl(dataSrc[1]);
  // Priority 4: <img src="...">, multi-line whitespace tolerant.
  // Limit the [\s\S] to 400 chars so we don't accidentally grab an
  // image from a sibling block.
  const src = block.match(/<img\b[\s\S]{0,400}?\bsrc=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
  if (src && src[1]) return decodeNextImageUrl(src[1]);
  // Priority 5: Next.js image wrapper without an explicit extension
  const nextWrap = block.match(/\bsrc=["'](\/_next\/image\/\?url=[^"']+)["']/i);
  if (nextWrap && nextWrap[1]) return decodeNextImageUrl(nextWrap[1]);
  return null;
}

function extractFirstHeadline(block) {
  // Prefer schema.org headline when present.
  const itemProp = block.match(/itemProp=["']headline["'][^>]*>[\s\S]{0,200}?(?:<a[^>]*>)?([\s\S]{12,200}?)(?:<\/a>|<\/[a-z]+>)/i);
  if (itemProp && itemProp[1]) return cleanText(itemProp[1]);
  // h1-h4
  const h = block.match(/<h[1-4][^>]*>([\s\S]{10,300}?)<\/h[1-4]>/i);
  if (h && h[1]) return cleanText(h[1]);
  // Some outlets use anchor text as the title
  const a = block.match(/<a\b[^>]*>([\s\S]{12,200}?)<\/a>/i);
  if (a && a[1]) return cleanText(a[1]);
  return null;
}

function extractFirstSummary(block) {
  const desc = block.match(/itemProp=["']description["'][^>]*>([\s\S]{0,400}?)<\//i);
  if (desc && desc[1]) return cleanText(desc[1]).slice(0, 280);
  const p = block.match(/<p\b[^>]*>([\s\S]{40,400}?)<\/p>/i);
  if (p && p[1]) return cleanText(p[1]).slice(0, 280);
  return '';
}

// Try to recover a real publication date from the article card. Many
// outlets expose schema.org or OG metadata even on homepage cards; some
// also include a <time datetime="..."> tag near the headline. We try
// each in priority order and return an ISO string, or null if none of
// them parsed.
//
// Returning null (instead of "now") matters: news-mexico.js falls back
// to a per-URL first-seen timestamp, which keeps an item's apparent
// age stable across refreshes. Stamping "now" on every refresh was the
// bug that made every scraped story say "1m ago" forever and kept the
// hot-publishing outlets glued to the top of the feed.
function extractFirstDate(block) {
  // Strict ISO/RFC date inside common metadata attributes.
  const meta =
       block.match(/<meta\b[^>]*\bitemProp=["']datePublished["'][^>]*\bcontent=["']([^"']+)["']/i)
    || block.match(/<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bitemProp=["']datePublished["']/i)
    || block.match(/<meta\b[^>]*\bproperty=["']article:published_time["'][^>]*\bcontent=["']([^"']+)["']/i)
    || block.match(/<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bproperty=["']article:published_time["']/i)
    || block.match(/<meta\b[^>]*\bname=["']date["'][^>]*\bcontent=["']([^"']+)["']/i);
  if (meta && meta[1]) {
    const d = new Date(meta[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  // <time datetime="...">.
  const t = block.match(/<time\b[^>]*\bdatetime=["']([^"']+)["']/i);
  if (t && t[1]) {
    const d = new Date(t[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  // data-publish-date / data-date attributes.
  const dataAttr = block.match(/\bdata-(?:publish-date|date|published)=["']([^"']+)["']/i);
  if (dataAttr && dataAttr[1]) {
    const d = new Date(dataAttr[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

// Several Mexican outlets bake YYYY/MM/DD into the article URL slug:
//   eluniversal.com.mx/nacion/2026/05/05/slug
//   proceso.com.mx/nacional/2026/5/5/slug-NNNN.html
//   noroeste.com.mx/sinaloa/2026/05/05/slug
//   latinus.us/mexico/2026/05/05/slug
// For those, the URL is a more reliable date source than the
// homepage card markup (which usually shows a relative-time string
// we'd need to parse). We accept both /YYYY/MM/DD/ and /YYYY-MM-DD/
// separators, validate the resulting date is sensible (within the
// last ~5 years, not in the future), and return at midnight local
// of that day so it slots into the date sort the same way as the
// real publish time would.
function extractDateFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\/|$|[-_])/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)); // noon UTC ≈ noon-ish locally
  if (Number.isNaN(dt.getTime())) return null;
  const now = Date.now();
  if (dt.getTime() > now + 24 * 60 * 60 * 1000) return null; // future
  if (dt.getTime() < now - 5 * 365 * 24 * 60 * 60 * 1000) return null; // ancient
  return dt.toISOString();
}

function extractItemFromBlock(block, outlet) {
  const href = extractFirstHref(block);
  const title = extractFirstHeadline(block);
  if (!href || !title || title.length < 12) return null;

  // Drop section/category links (no slashes deep enough to be an
  // article URL).
  const slashCount = href.replace(/^https?:\/\/[^/]+/, '').split('/').filter(Boolean).length;
  if (slashCount < 2) return null;

  const image = extractFirstImage(block);
  const summary = extractFirstSummary(block);
  const resolvedUrl = canonicalizeUrl(resolveUrl(href, outlet.host));
  // Date priority: structured markup on the card → date in URL slug
  // → null (lets news-mexico.js fall back to first-seen tracker).
  // URL date matters because most Mexican outlet homepages don't
  // expose datePublished on the card, but their article URLs do
  // contain /YYYY/MM/DD/ — that's what avoids "hace un momento"
  // showing on every refresh after a fresh serverless instance
  // boots with an empty first-seen map.
  const publishedAt = extractFirstDate(block) || extractDateFromUrl(resolvedUrl);

  return {
    title,
    url: resolvedUrl,
    image: image ? resolveUrl(image, outlet.host) : null,
    summary,
    sourceName: outlet.name,
    sourceId: outlet.id,
    publishedAt,
    sourceChannel: 'scrape',
  };
}

// Per-outlet config. Each entry can override the homepage URL or
// the article-block selector. Generic parser handles the common case.
const OUTLET_SCRAPERS = {
  'el-universal':    { homepage: 'https://www.eluniversal.com.mx/' },
  'aristegui':       { homepage: 'https://aristeguinoticias.com/' },
  'milenio':         { homepage: 'https://www.milenio.com/' },
  'proceso':         { homepage: 'https://www.proceso.com.mx/' },
  'noroeste':        { homepage: 'https://www.noroeste.com.mx/' },
  'latinus':         { homepage: 'https://latinus.us/' },
  // animal-politico, sin-embargo, debate are blocked / SPA-rendered
  // — they fall through to Google News in the fetchOneOutlet chain.
};

export function getScraperConfig(outletId) {
  return OUTLET_SCRAPERS[outletId] || null;
}

export async function fetchHomepageScrape(outlet, { timeoutMs = 8_000, userAgent } = {}) {
  const cfg = OUTLET_SCRAPERS[outlet.id];
  if (!cfg) return null;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.homepage, {
      headers: {
        'User-Agent': userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.7',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const blocks = html.match(/<article\b[\s\S]{0,4000}?<\/article>/gi) || [];

    const items = [];
    const seenUrls = new Set();
    for (const block of blocks) {
      const item = extractItemFromBlock(block, outlet);
      if (!item) continue;
      if (seenUrls.has(item.url)) continue;
      seenUrls.add(item.url);
      items.push(item);
    }
    return items;
  } catch (e) {
    console.warn('[news-scraper] homepage fetch failed', { outletId: outlet.id, error: e?.message });
    return null;
  } finally {
    clearTimeout(t);
  }
}
