/**
 * Music / chart readers.
 *
 * Primary source: Apple Music RSS feeds — public, keyless, updated
 * daily. Returns the top-N "most played" songs for a country as JSON.
 *
 * We pick Apple Music over Spotify because Spotify's per-country chart
 * endpoint (`charts-spotify-com-service.spotify.com/auth/v0/...`)
 * requires OAuth and a registered app, while Apple Music's RSS is
 * genuinely open. Chart composition tracks closely with Spotify's
 * regional top in practice — users care about "who's hot in MX",
 * not the specific service.
 *
 * Used by:
 *   - market-gen/charts.js       → pick top artists for this week's
 *                                   "¿quién tendrá la #1?" parallel market
 *   - cron/points-auto-resolve   → settle api_chart markets with
 *                                   source='apple-mx-songs' by
 *                                   re-reading the chart at close
 */

const APPLE_MX_SONGS_URL =
  'https://rss.marketingtools.apple.com/api/v2/mx/music/most-played/50/songs.json';

/**
 * Fetch the Apple Music MX "Top canciones" feed.
 * Returns an array of { rank, name, artist, id } sorted by current rank.
 */
export async function readAppleMxSongs() {
  const res = await fetch(APPLE_MX_SONGS_URL, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'pronos.io/1.0' },
  });
  if (!res.ok) throw new Error(`apple-music: HTTP ${res.status}`);
  const data = await res.json();
  const results = data?.feed?.results;
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('apple-music: empty results');
  }
  return results.map((r, i) => ({
    rank: i + 1,
    name: String(r.name || ''),
    artist: String(r.artistName || ''),
    id: String(r.id || ''),
    url: r.url || null,
    artwork: r.artworkUrl100 || null,
  }));
}

/**
 * Convenience: read just the current #1 entry from the Apple MX chart.
 * Used by the auto-resolver — we only care about who's at the top at
 * close time.
 */
export async function readAppleMxTopArtist() {
  const list = await readAppleMxSongs();
  const top = list[0];
  if (!top) throw new Error('apple-music: no #1 entry');
  return { artist: top.artist, trackName: top.name, trackId: top.id };
}
