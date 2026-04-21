/**
 * Wikipedia REST API helpers.
 *
 * We use Wikipedia's public summary endpoint to fetch driver / player
 * portrait thumbnails. The endpoint is keyless and very generous
 * (hundreds of req/s), so fetching during a daily generator cron
 * (20-ish drivers) is trivial.
 *
 * API: https://en.wikipedia.org/api/rest_v1/page/summary/{title}
 * Response shape (only fields we care about):
 *   { thumbnail: { source, width, height },
 *     originalimage: { source, width, height } }
 */

const REST_BASE = 'https://en.wikipedia.org/api/rest_v1/page/summary';

/**
 * Extract the title path segment from a canonical Wikipedia URL.
 * Handles both http:// and https://, and both en.wikipedia.org and
 * any language subdomain (we always hit en.wikipedia below, so the
 * source subdomain doesn't matter — we just need the title).
 *
 * Returns null when the URL doesn't look like a /wiki/<title> path.
 */
export function extractWikiTitle(wikiUrl) {
  if (!wikiUrl || typeof wikiUrl !== 'string') return null;
  const m = wikiUrl.match(/\/wiki\/([^/?#]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/**
 * Fetch a page summary and return the best-available thumbnail URL.
 *
 * Prefers `originalimage.source` (full-res Commons upload) so cards
 * and detail pages have sharp images on HiDPI displays. Falls back to
 * the 320px `thumbnail.source` when originalimage is missing.
 *
 * Returns null on any failure (missing page, network, no image on
 * the article). Callers should treat null as "no portrait available"
 * and render the label without an image.
 */
export async function fetchWikipediaImage(wikiUrl) {
  const title = extractWikiTitle(wikiUrl);
  if (!title) return null;
  try {
    const res = await fetch(
      `${REST_BASE}/${encodeURIComponent(title)}`,
      {
        headers: {
          'Accept': 'application/json',
          // Wikipedia asks for a contact-ID user-agent on the REST
          // API. A static UA string identifying the app is the
          // canonical form recommended in their docs.
          'User-Agent': 'PronosBot/1.0 (https://pronos.io; contact@pronos.io)',
        },
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.originalimage?.source
        || data?.thumbnail?.source
        || null;
  } catch {
    return null;
  }
}
