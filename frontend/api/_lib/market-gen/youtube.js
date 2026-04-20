/**
 * YouTube Trending México market generator (weekly parallel).
 *
 * Reads current Trending MX top 10 via YouTube Data API, extracts
 * distinct channels, proposes one parallel market per week:
 *   Parent: "¿Qué canal tendrá el video #1 en Tendencias México el
 *            próximo viernes?"
 *   Legs:   top channels + 'Otro'
 *
 * Skips gracefully (returns []) if YOUTUBE_API_KEY isn't set.
 * Resolver: api_chart with source='youtube-trending-mx'. At close the
 * resolver re-reads the trending list and matches the #1 channel.
 */
import { readYouTubeTrendingMx } from '../youtube.js';

const LEG_TARGET = 4;

function endOfWeekFriUtc(now = new Date()) {
  const d = new Date(now);
  const day = d.getUTCDay();
  const daysAhead = ((5 - day + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(21, 0, 0, 0);
  return d;
}
function isoWeekKey(d) {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  copy.setUTCDate(copy.getUTCDate() + 4 - (copy.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((copy - yearStart) / 86_400_000) + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
function formatDateEs(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function distinctTopChannels(entries, target) {
  const seen = new Map();
  for (const e of entries) {
    if (!e.channel) continue;
    const key = e.channel.trim();
    if (!seen.has(key)) {
      seen.set(key, { channel: key, channelId: e.channelId, topRank: e.rank });
    }
    if (seen.size >= target) break;
  }
  return Array.from(seen.values());
}

export async function generateYouTubeMarkets() {
  if (!process.env.YOUTUBE_API_KEY) {
    console.warn('[market-gen/youtube] YOUTUBE_API_KEY not set — skipping');
    return [];
  }

  let trending;
  try {
    trending = await readYouTubeTrendingMx({ max: 15 });
  } catch (e) {
    console.error('[market-gen/youtube] trending fetch failed', { message: e?.message });
    return [];
  }
  if (!Array.isArray(trending) || trending.length === 0) return [];

  const topChannels = distinctTopChannels(trending, LEG_TARGET);
  if (topChannels.length < 2) return [];

  const legs = [
    ...topChannels.map(c => ({ channel: c.channel, channelId: c.channelId, label: c.channel })),
    { channel: null, channelId: null, label: 'Otro' },
  ];

  const end = endOfWeekFriUtc();
  const weekKey = isoWeekKey(end);

  return [{
    source: 'youtube',
    source_event_id: `charts:youtube-trending-mx:${weekKey}`,
    question: `¿Qué canal tendrá el video #1 en Tendencias México el ${formatDateEs(end)}?`,
    category: 'musica',
    icon: '▶️',
    outcomes: legs.map(l => l.label),
    seed_liquidity: 1000,
    end_time: end.toISOString(),
    amm_mode: 'parallel',
    resolver_type: 'api_chart',
    resolver_config: {
      source: 'youtube-trending-mx',
      legs: legs.map(l => ({
        label: l.label,
        // Prefer channelId for a stable match — channel display names
        // can change but the ID is immutable.
        channelId: l.channelId,
        channel: l.channel,
      })),
    },
    source_data: {
      weekKey,
      generatedAt: new Date().toISOString(),
      snapshot: trending.slice(0, 10).map(e => ({
        rank: e.rank, channel: e.channel, title: e.title,
      })),
    },
  }];
}
