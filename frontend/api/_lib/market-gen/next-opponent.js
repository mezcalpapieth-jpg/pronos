/**
 * Next-opponent generator — one parallel-binary market per marquee
 * fighter asking "Who do they fight next?"
 *
 * Markets stay open for 6 months. Resolves when ESPN MMA (for UFC
 * fighters) OR the-odds-api boxing (for boxing fighters) lists the
 * fighter on an upcoming card — the opponent's name maps to a leg
 * and that leg resolves YES.
 *
 * The fighter roster is intentionally small (5 today, capped at 5-7)
 * so the home page doesn't drown in speculative markets. Add new
 * names below as the user identifies them.
 *
 * Each market is idempotent on (source, source_event_id):
 *   source           = 'next-opponent'
 *   source_event_id  = `next:<fighter-slug>`
 *
 * So the daily cron re-generating doesn't insert duplicates; it
 * updates the existing pending row.
 *
 * The opponent list per fighter is hand-curated below. Use the
 * top 5-6 most likely candidates + "Otro" — narrow enough to keep
 * the parallel grid readable, wide enough that "Otro" rarely wins.
 */

const FIGHTERS = [
  {
    slug: 'canelo',
    label: 'Saúl "Canelo" Álvarez',
    sport: 'combate',
    league: 'boxing',
    resolverSource: 'odds-api-boxing',
    image: null,  // can add a Sanity-hosted headshot here later
    icon: '🥊',
    candidates: [
      // The likely 2026 LATAM-marquee opponents at super-mid /
      // light-heavy. Edit as the boxing landscape shifts.
      { label: 'David Benavidez',      slug: 'benavidez' },
      { label: 'Dmitry Bivol',         slug: 'bivol' },
      { label: 'Jaime Munguía',        slug: 'munguia' },
      { label: 'Edgar Berlanga',       slug: 'berlanga' },
      { label: 'Christian Mbilli',     slug: 'mbilli' },
      { label: 'Terence Crawford',     slug: 'crawford' },
    ],
  },
  {
    slug: 'mcgregor',
    label: 'Conor McGregor',
    sport: 'combate',
    league: 'ufc',
    resolverSource: 'espn-mma-next',
    image: null,
    icon: '🥋',
    candidates: [
      { label: 'Michael Chandler',     slug: 'chandler' },
      { label: 'Justin Gaethje',       slug: 'gaethje' },
      { label: 'Dustin Poirier',       slug: 'poirier' },
      { label: 'Nate Diaz',            slug: 'nate-diaz' },
      { label: 'Paddy Pimblett',       slug: 'pimblett' },
      { label: 'Jake Paul',            slug: 'jake-paul' },
    ],
  },
  {
    slug: 'pitbull-cruz',
    label: 'Isaac "Pitbull" Cruz',
    sport: 'combate',
    league: 'boxing',
    resolverSource: 'odds-api-boxing',
    image: null,
    icon: '🥊',
    candidates: [
      { label: 'Gervonta Davis',       slug: 'tank-davis' },
      { label: 'Devin Haney',          slug: 'haney' },
      { label: 'Shakur Stevenson',     slug: 'shakur' },
      { label: 'Keyshawn Davis',       slug: 'keyshawn' },
      { label: 'William Zepeda',       slug: 'zepeda' },
      { label: 'Vasiliy Lomachenko',   slug: 'loma' },
    ],
  },
  {
    slug: 'brandon-moreno',
    label: 'Brandon Moreno',
    sport: 'combate',
    league: 'ufc',
    resolverSource: 'espn-mma-next',
    image: null,
    icon: '🥋',
    candidates: [
      { label: 'Alexandre Pantoja',    slug: 'pantoja' },
      { label: 'Brandon Royval',       slug: 'royval' },
      { label: 'Amir Albazi',          slug: 'albazi' },
      { label: 'Steve Erceg',          slug: 'erceg' },
      { label: 'Tatsuro Taira',        slug: 'taira' },
      { label: 'Manel Kape',           slug: 'kape' },
    ],
  },
  {
    slug: 'strickland',
    label: 'Sean Strickland',
    sport: 'combate',
    league: 'ufc',
    resolverSource: 'espn-mma-next',
    image: null,
    icon: '🥋',
    candidates: [
      { label: 'Dricus Du Plessis',    slug: 'dpp' },
      { label: 'Khamzat Chimaev',      slug: 'khamzat' },
      { label: 'Robert Whittaker',     slug: 'whittaker' },
      { label: 'Israel Adesanya',      slug: 'adesanya' },
      { label: 'Caio Borralho',        slug: 'borralho' },
      { label: 'Nassourdine Imavov',   slug: 'imavov' },
    ],
  },
];

export async function generateNextOpponentMarkets() {
  const now = new Date();
  // 180-day window — most fights are booked 6-12 weeks ahead, so
  // 6 months covers a comfortable resolution window. If a fighter
  // doesn't book inside that window, admin voids via the existing
  // /api/points/admin/void-market endpoint.
  const endTime = new Date(now.getTime() + 180 * 86_400_000).toISOString();
  // NB: do NOT set start_time. Next-opponent is an open-ended
  // prediction — there's no kickoff to count down to. The list/card
  // API treats `start_time != null AND start_time <= NOW < end_time`
  // as "live", so a start-of-creation timestamp here made every
  // next-opponent market render with a red "EN VIVO" pill for the
  // full 180-day window. Leaving start_time null keeps it static.

  const specs = [];
  for (const f of FIGHTERS) {
    const legs = [
      ...f.candidates.map(c => ({ label: c.label, driverId: c.slug })),
      { label: 'Otro', driverId: null },
    ];

    specs.push({
      source: 'next-opponent',
      source_event_id: `next:${f.slug}`,
      sport: f.sport,
      league: f.league,
      question: `¿Contra quién pelea ${f.label} a continuación?`,
      category: 'deportes',
      icon: f.icon,
      outcomes: legs.map(l => l.label),
      outcome_images: [...f.candidates.map(c => c.image || null), null],
      seed_liquidity: 800,
      start_time: null,
      end_time: endTime,
      amm_mode: 'parallel',
      resolver_type: 'sports_api',
      resolver_config: {
        source: 'next-opponent',
        shape: 'parallel',
        fighterSlug: f.slug,
        fighterLabel: f.label,
        resolverSource: f.resolverSource,
        legs,
      },
      source_data: {
        fighterSlug: f.slug,
        fighterLabel: f.label,
        resolverSource: f.resolverSource,
      },
    });
  }
  return specs;
}

// Exported so the cron's resolver can read the same candidate list
// (slug → label match) without duplicating the data.
export const NEXT_OPPONENT_FIGHTERS = FIGHTERS;
