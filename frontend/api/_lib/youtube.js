/**
 * YouTube Data API v3 reader.
 *
 * Free tier: 10,000 units/day. A `videos.list?chart=mostPopular` call
 * costs 1 unit, so we can hit this thousands of times without pressure.
 * Register a key at https://console.cloud.google.com/ → APIs & Services
 * → Credentials → Create API Key → restrict to YouTube Data API v3,
 * then set YOUTUBE_API_KEY on Vercel.
 *
 * Used by:
 *   - market-gen/youtube.js      → pick top MX-trending channels for
 *                                   the weekly "¿quién tiene el #1?"
 *   - cron/points-auto-resolve   → settle api_chart markets with
 *                                   source='youtube-trending-mx'
 */

const BASE = 'https://www.googleapis.com/youtube/v3/videos';

/**
 * Fetch the top N trending videos in Mexico.
 * Returns `[{ rank, id, title, channel, channelId }]`.
 */
export async function readYouTubeTrendingMx({ max = 10 } = {}) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('youtube: YOUTUBE_API_KEY not set');

  const url = `${BASE}?part=snippet&chart=mostPopular&regionCode=MX`
    + `&maxResults=${Math.min(50, Math.max(1, max))}`
    + `&key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`youtube: HTTP ${res.status} · ${body.slice(0, 160)}`);
  }
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((v, i) => ({
    rank: i + 1,
    id: v.id,
    title: v.snippet?.title || '',
    channel: v.snippet?.channelTitle || '',
    channelId: v.snippet?.channelId || '',
  }));
}

export async function readYouTubeTopMxChannel() {
  const list = await readYouTubeTrendingMx({ max: 1 });
  const top = list[0];
  if (!top) throw new Error('youtube: no trending #1');
  return { channel: top.channel, channelId: top.channelId, title: top.title, id: top.id };
}
