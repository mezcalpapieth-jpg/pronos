/**
 * LIV Golf generator — emits TWO parallel markets per upcoming
 * event, sharing the same ESPN eventId but distinct
 * (source, source_event_id) so the (UNIQUE) constraint on
 * points_pending_markets keeps re-runs idempotent:
 *
 *   1. Individual winner — "¿Quién gana el <Event>?"
 *      source='espn-liv'           source_event_id='liv:<id>'
 *      Auto-resolves via /sports/golf/liv/scoreboard (order=1).
 *
 *   2. Team winner — "¿Qué equipo gana el <Event>?"
 *      source='espn-liv-teams'     source_event_id='livteam:<id>'
 *      Manual resolution (admin picks). ESPN's public scoreboard
 *      doesn't expose the LIV team leaderboard — only individual
 *      scores — so we can't auto-derive the team winner. Admin
 *      checks livgolf.com after the event and selects the leg.
 *
 * Why hardcoded legs in both: LIV's individual entry list isn't
 * exposed in the pre-event ESPN response, and the 13 LIV teams are
 * stable across the 2026 season.
 */

const LIV = 'https://site.api.espn.com/apis/site/v2/sports/golf/liv/scoreboard';

// ESPN headshot CDN — same path as PGA. IDs verified by mapping
// completed-event leaderboards back to athlete display names
// (see git history for the verification pass).
function headshot(id) {
  return id ? `https://a.espncdn.com/i/headshots/golf/players/full/${id}.png` : null;
}

// Top-tier individual LIV roster. IDs verified against LIV
// scoreboard responses for 2025-2026 events. Kept narrow enough
// that the field covers realistic winners without drowning the UI
// in 50 options.
const FIELD = [
  { id: '10046', name: 'Bryson DeChambeau' },
  { id: '9780',  name: 'Jon Rahm' },
  { id: '9131',  name: 'Cameron Smith' },
  { id: '3448',  name: 'Dustin Johnson' },
  { id: '11099', name: 'Joaquín Niemann' },
  { id: '5553',  name: 'Tyrrell Hatton' },
  { id: '9513',  name: 'Talor Gooch' },
  { id: '308',   name: 'Phil Mickelson' },
  { id: '158',   name: 'Sergio García' },
  { id: '9261',  name: 'Abraham Ancer' },
  { id: '5532',  name: 'Carlos Ortiz' },
  { id: '9031',  name: 'Thomas Pieters' },
];

// 13 LIV Golf teams for 2026 — confirmed against livgolf.com/teams.
// `id` is a stable internal slug; `logo` is the squared-logo
// Cloudinary URL surfaced by the LIV site (CSP allows
// images.livgolf.com via the *.cloudfront.net wildcard isn't
// enough — we whitelist images.livgolf.com explicitly in
// frontend/vercel.json).
//
// Note on rebrands: "Iron Heads" was renamed "Korean GC" and
// "Stinger GC" became "Southern Guards GC". OKGC (Oklahoma) is the
// 2026 expansion team. We use 2026 names to match what a user
// browsing pronos.io after a tournament would see on livgolf.com.
const TEAMS = [
  { id: 'crushers',   name: 'Crushers GC',         logo: 'https://images.livgolf.com/image/private/t_q_good/v1737134379/prd/assets/teams/squared-logos/logo-Crushers_GC.svg' },
  { id: 'legion',     name: 'Legion XIII',          logo: 'https://images.livgolf.com/image/private/t_q_good/v1737134387/prd/assets/teams/squared-logos/logo-Legion_XIII.svg' },
  { id: 'ripper',     name: 'Ripper GC',            logo: 'https://images.livgolf.com/image/private/t_q_good/v1737450713/prd/assets/teams/squared-logos/logo-Ripper_GC_bdiyaz.svg' },
  { id: 'rangegoats', name: 'RangeGoats GC',        logo: 'https://images.livgolf.com/image/private/t_q_good/v1737134367/prd/assets/teams/squared-logos/logo-RangeGoats_GC.svg' },
  { id: 'torque',     name: 'Torque GC',            logo: 'https://images.livgolf.com/image/private/t_q_good/v1737134374/prd/assets/teams/squared-logos/logo-Torque_GC.svg' },
  { id: 'fourAces',   name: '4Aces GC',             logo: 'https://images.livgolf.com/image/private/t_q_good/v1737134376/prd/assets/teams/squared-logos/logo-4Aces_GC.svg' },
  { id: 'cleeks',     name: 'Cleeks GC',            logo: 'https://images.livgolf.com/image/private/t_q_good/v1737134377/prd/assets/teams/squared-logos/logo-Cleeks_GC.svg' },
  { id: 'hyflyers',   name: 'HyFlyers GC',          logo: 'https://images.livgolf.com/image/private/t_q_good/v1737134383/prd/assets/teams/squared-logos/logo-HyFlyers_GC.svg' },
  { id: 'fireballs',  name: 'Fireballs GC',         logo: 'https://images.livgolf.com/image/private/t_q_good/v1768499672/prd/assets/teams/squared-logos/icon_fireballs_SVG_e6m4v2.svg' },
  { id: 'majesticks', name: 'Majesticks GC',        logo: 'https://images.livgolf.com/image/private/t_q_good/v1768500575/prd/assets/teams/squared-logos/Majesticks_icon_SVG1_kiarhj.svg' },
  { id: 'koreanGc',   name: 'Korean GC',            logo: 'https://images.livgolf.com/image/private/t_q_good/v1768425525/prd/assets/teams/squared-logos/KGC_icon_SVG_a4mnyd.svg' },
  { id: 'southernGuards', name: 'Southern Guards GC', logo: 'https://images.livgolf.com/image/private/t_q_good/v1768425607/prd/assets/teams/squared-logos/SG_icon_SVG_bdjiun.svg' },
  { id: 'okgc',       name: 'OKGC',                 logo: 'https://images.livgolf.com/image/private/t_q_good/v1776365560/prd/assets/teams/team-websites/Logo_-_OKGC_fedvlb.svg' },
];

function formatDateCompact(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

async function fetchNextTournament() {
  const now = new Date();
  const horizon = new Date(now.getTime() + 60 * 86_400_000); // 60 days
  const dates = `${formatDateCompact(now)}-${formatDateCompact(horizon)}`;
  try {
    const res = await fetch(`${LIV}?dates=${dates}&limit=50`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const events = Array.isArray(data?.events) ? data.events : [];
    const upcoming = events
      .filter(e => e?.status?.type?.state === 'pre')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return upcoming[0] || null;
  } catch (e) {
    console.error('[market-gen/liv] fetch failed', { message: e?.message });
    return null;
  }
}

export async function generateLivMarkets() {
  const ev = await fetchNextTournament();
  if (!ev) return [];

  // LIV events are shotgun-start 3-rounders Fri-Sun. ev.date is
  // Friday tee-off UTC; final round wraps Sunday. Pad 4 days past
  // start so weather/Monday-finish doesn't strand the market.
  const startMs = new Date(ev.date).getTime();
  if (!Number.isFinite(startMs)) return [];
  const startTime = new Date(startMs).toISOString();
  const endTime = new Date(startMs + 4 * 86_400_000).toISOString();

  // ── Individual winner market (auto-resolved) ─────────────────────────
  const indivLegs = [
    ...FIELD.map(p => ({ label: p.name, driverId: p.id })),
    { label: 'Otro', driverId: null },
  ];
  const indivMarket = {
    source: 'espn-liv',
    source_event_id: `liv:${ev.id}`,
    sport: 'golf',
    league: 'liv',
    question: `¿Quién gana el ${ev.name}?`,
    category: 'deportes',
    icon: '⛳',
    outcomes: indivLegs.map(l => l.label),
    outcome_images: [
      ...FIELD.map(p => headshot(p.id)),
      null, // Otro
    ],
    seed_liquidity: 1000,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'parallel',
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'espn-liv',
      shape: 'parallel',
      eventId: ev.id,
      legs: indivLegs,
    },
    source_data: {
      eventId: ev.id,
      tournamentName: ev.name,
      startDateIso: ev.date,
      field: FIELD,
    },
  };

  // ── Team winner market (manual resolution) ───────────────────────────
  // ESPN's public LIV scoreboard exposes individual scores only —
  // no team-level leaderboard. So this market resolves manually:
  // admin picks the winning team after the event from livgolf.com.
  // The full 13-team field is closed (no "Otro") since one of these
  // teams will always win.
  const teamLegs = TEAMS.map(t => ({ label: t.name, driverId: t.id }));
  const teamMarket = {
    source: 'espn-liv-teams',
    source_event_id: `livteam:${ev.id}`,
    sport: 'golf',
    league: 'liv',
    question: `¿Qué equipo gana el ${ev.name}?`,
    category: 'deportes',
    icon: '🏆',
    outcomes: teamLegs.map(l => l.label),
    outcome_images: TEAMS.map(t => t.logo),
    seed_liquidity: 1000,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'parallel',
    // Manual — admin resolves from livgolf.com once team scores
    // are official. A future espn-liv-teams reader could
    // auto-derive team scores by summing best-3-of-4 player rounds
    // (LIV's team scoring rule), but that requires per-round per-
    // player data ESPN doesn't ship publicly.
    resolver_type: 'manual',
    resolver_config: {
      source: 'manual',
      shape: 'parallel',
      eventId: ev.id,
      kind: 'team',
      legs: teamLegs,
    },
    source_data: {
      eventId: ev.id,
      tournamentName: ev.name,
      startDateIso: ev.date,
      teams: TEAMS,
    },
  };

  return [indivMarket, teamMarket];
}
