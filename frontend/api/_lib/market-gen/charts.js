/**
 * Music chart market generator (Mexico, weekly).
 *
 * Reads the current Apple Music MX "Top canciones" feed, pulls the
 * most-active artists from the top slots, and proposes one PARALLEL
 * market per week:
 *   Parent: "¿Quién tendrá la canción #1 en México este viernes?"
 *   Legs:   ['Fuerza Regida', 'Peso Pluma', 'Neton Vega', 'Otro']
 *
 * Why parallel: each artist gets their own binary Sí/No market, users
 * can pile into multiple favorites, and the parent question resolves
 * by picking the winning leg (same cascade as weather).
 *
 * Resolver: api_chart with source='apple-mx-songs'. At close we
 * re-read the chart, grab the #1 track's artist, and match against
 * each leg's `artist` in the parent's resolver_config.legs.
 *
 * Idempotent — one source_event_id per calendar week.
 */
import { readAppleMxSongs } from '../charts.js';

function endOfWeekFriUtc(now = new Date()) {
  // Roll to the next Friday 21:00 UTC. If today IS Friday, skip to the
  // next one so the market always has a full week of depth.
  const d = new Date(now);
  const day = d.getUTCDay();                // 5 = Fri
  const daysAhead = ((5 - day + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(21, 0, 0, 0);
  return d;
}

function isoWeekKey(d) {
  // Use ISO-ish week-of-year so the source_event_id is stable within a
  // given Monday-to-Sunday window regardless of when the generator runs.
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday in current week = ISO week owner.
  copy.setUTCDate(copy.getUTCDate() + 4 - (copy.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((copy - yearStart) / 86_400_000) + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function formatDateEs(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// How many distinct artists to include as legs. 4 real + 1 "Otro" =
// 5 legs total, which matches the ≥4 threshold where we've tested the
// parallel UI flow in the admin queue. If fewer than 4 distinct
// artists appear in the top 10 we use what's there.
const LEG_TARGET = 4;

function distinctTopArtists(entries, target) {
  const seen = new Map();
  for (const e of entries) {
    if (!e.artist) continue;
    // Use the first-listed artist only; collabs (e.g. "A & B" or
    // "A, B & C") could be split, but Apple Music already shows the
    // lead artist as the primary name field.
    const key = e.artist.trim();
    if (!seen.has(key)) seen.set(key, { artist: key, topRank: e.rank });
    if (seen.size >= target) break;
  }
  return Array.from(seen.values());
}

export async function generateChartsMarkets() {
  let chart;
  try {
    chart = await readAppleMxSongs();
  } catch (e) {
    console.error('[market-gen/charts] apple-music read failed', { message: e?.message });
    return [];
  }
  if (!Array.isArray(chart) || chart.length === 0) return [];

  const topArtists = distinctTopArtists(chart, LEG_TARGET);
  if (topArtists.length < 2) return [];

  // Always append an "Otro" leg so longshots have somewhere to bet.
  // Resolver treats any non-matching #1 as the Otro win.
  const legs = [
    ...topArtists.map(a => ({ artist: a.artist, label: a.artist })),
    { artist: null, label: 'Otro' },
  ];

  const end = endOfWeekFriUtc();
  const weekKey = isoWeekKey(end);

  return [{
    source: 'apple-music',
    source_event_id: `charts:apple-mx-songs:${weekKey}`,
    question: `¿Quién tendrá la canción #1 en México este viernes (${formatDateEs(end)})?`,
    category: 'musica',
    icon: '🎵',
    outcomes: legs.map(l => l.label),
    seed_liquidity: 1000,
    end_time: end.toISOString(),
    amm_mode: 'parallel',
    resolver_type: 'api_chart',
    resolver_config: {
      source: 'apple-mx-songs',
      // Per-leg match rule: case-insensitive exact-artist match on the
      // #1 entry. The "Otro" leg has artist=null and wins when no
      // listed artist matches.
      legs: legs.map(l => ({ label: l.label, artist: l.artist })),
    },
    source_data: {
      weekKey,
      generatedAt: new Date().toISOString(),
      snapshot: chart.slice(0, 10).map(e => ({ rank: e.rank, artist: e.artist, name: e.name })),
    },
  }];
}
