/**
 * Sports-result readers for the sports_api resolver family.
 *
 * Each function fetches the post-game state from its respective public
 * endpoint and returns a normalized result:
 *
 *   { completed: boolean, winner: 'home'|'away'|'draw'|null,
 *     homeScore?: number, awayScore?: number,
 *     // for F1:
 *     winnerDriverId?: string, winnerDriverLabel?: string }
 *
 * Callers should treat `completed=false` as "not done yet, try again
 * next cron tick" (benign skip). `winner=null` on completed games
 * means abandoned / awarded / weird edge case — surface to admin.
 */

// ─── ESPN scoreboard (MLB / NBA / soccer) ───────────────────────────────
// ESPN's per-event endpoint is /summary?event=<id>, but the /scoreboard
// endpoint filtered by dates returns the same event with winner flags
// and is consistent across sports. Using dates+eventId lookup keeps the
// URL pattern identical across MLB / NBA / soccer / Liga MX / MLS.

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

function ymdToDateRange(ymd) {
  // scoreboard ?dates=YYYYMMDD returns events scheduled THAT day (UTC).
  // Cover ±1 day so a game that kicks off near a UTC boundary is still
  // found — cheap insurance.
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  const start = new Date(Date.UTC(y, m - 1, d - 1));
  const end   = new Date(Date.UTC(y, m - 1, d + 1));
  const fmt = (x) => `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, '0')}${String(x.getUTCDate()).padStart(2, '0')}`;
  return `${fmt(start)}-${fmt(end)}`;
}

export async function readEspnEvent({ leaguePath, eventId, dateYmd }) {
  if (!leaguePath || !eventId) throw new Error('espn: missing leaguePath/eventId');
  const dateRange = ymdToDateRange(dateYmd);
  const q = dateRange ? `?dates=${dateRange}&limit=500` : `?limit=500`;
  const url = `${ESPN_BASE}/${leaguePath}/scoreboard${q}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`espn: HTTP ${res.status}`);
  const data = await res.json();
  const events = Array.isArray(data?.events) ? data.events : [];
  const ev = events.find(e => String(e.id) === String(eventId));
  if (!ev) {
    // Event not in the scoreboard window — either not started yet or
    // date drift. Treat as "not done", retry next tick.
    return { completed: false, winner: null, notFound: true };
  }
  const state     = ev?.status?.type?.state;
  const completed = Boolean(ev?.status?.type?.completed);
  const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
  const ctors = Array.isArray(comp?.competitors) ? comp.competitors : [];
  const home = ctors.find(c => c.homeAway === 'home');
  const away = ctors.find(c => c.homeAway === 'away');
  const homeScore = Number(home?.score);
  const awayScore = Number(away?.score);

  if (!completed) return { completed: false, winner: null, state };

  // Winner extraction: prefer the `winner: true` flag ESPN sets on the
  // victorious competitor. Fall back to score comparison.
  let winner = null;
  if (home?.winner) winner = 'home';
  else if (away?.winner) winner = 'away';
  else if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
    if (homeScore > awayScore) winner = 'home';
    else if (awayScore > homeScore) winner = 'away';
    else winner = 'draw';
  }
  return {
    completed: true,
    winner,
    homeScore: Number.isFinite(homeScore) ? homeScore : null,
    awayScore: Number.isFinite(awayScore) ? awayScore : null,
    // Team names for the final-score strip on resolved cards. Prefer
    // shortDisplayName ("México") over displayName ("Mexico National
    // Team") when available; null when ESPN doesn't ship team metadata.
    homeTeam: home?.team?.shortDisplayName || home?.team?.displayName || home?.team?.name || null,
    awayTeam: away?.team?.shortDisplayName || away?.team?.displayName || away?.team?.name || null,
    state,
  };
}

// ─── football-data.org match ───────────────────────────────────────────
// Needs FOOTBALL_DATA_API_KEY (already set for the soccer generator).
// Clean result schema: score.winner ∈ {HOME_TEAM, AWAY_TEAM, DRAW}.

const FD_BASE = 'https://api.football-data.org/v4';

export async function readFootballDataMatch(matchId) {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) throw new Error('football-data: FOOTBALL_DATA_API_KEY not set');
  if (!matchId) throw new Error('football-data: missing matchId');
  const res = await fetch(`${FD_BASE}/matches/${encodeURIComponent(matchId)}`, {
    headers: { 'X-Auth-Token': key, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`football-data: HTTP ${res.status}`);
  const match = await res.json();
  const status = String(match?.status || '').toUpperCase();
  if (status !== 'FINISHED') {
    // SCHEDULED / TIMED / IN_PLAY / PAUSED / POSTPONED / CANCELLED / AWARDED
    return { completed: false, winner: null, status };
  }
  const raw = String(match?.score?.winner || '').toUpperCase();
  const winner =
    raw === 'HOME_TEAM' ? 'home' :
    raw === 'AWAY_TEAM' ? 'away' :
    raw === 'DRAW'      ? 'draw' : null;
  const homeScore = Number(match?.score?.fullTime?.home);
  const awayScore = Number(match?.score?.fullTime?.away);
  return {
    completed: true,
    winner,
    homeScore: Number.isFinite(homeScore) ? homeScore : null,
    awayScore: Number.isFinite(awayScore) ? awayScore : null,
    homeTeam: match?.homeTeam?.shortName || match?.homeTeam?.name || null,
    awayTeam: match?.awayTeam?.shortName || match?.awayTeam?.name || null,
    status,
  };
}

// ─── ESPN tennis (ATP) result ──────────────────────────────────────────
// Reuses readEspnEvent under the hood — ATP matches expose the same
// competitor.winner / score shape as other ESPN sports, so the
// sports_api 'binary' shape handles them without a separate reader.
// Kept as its own named export for symmetry / future ESPN tennis
// quirks (retirements, walkovers).
export async function readEspnTennisMatch({ eventId, dateYmd }) {
  return readEspnEvent({ leaguePath: 'tennis/atp', eventId, dateYmd });
}

// ─── ESPN ATP tournament winner ────────────────────────────────────────
// For tournament-level markets (replacing the old per-match H2H
// generator). ESPN's atp/scoreboard returns one event per
// tournament with a `groupings` array — Men's Singles, Women's
// Singles, Men's Doubles, Women's Doubles. We pull the Men's
// Singles grouping, find the Final (round.id='7'), and read the
// competitor with winner=true.
//
// Returns the same winnerDriverId / winnerDriverLabel envelope as
// the F1 / golf readers so the cron's parallel-shape leg matcher
// works unchanged. competitor.id mirrors the ESPN athlete id, which
// matches what the tennis generator stores in cfg.legs[i].driverId.

const ESPN_ATP_BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp';

export async function readEspnAtpTournamentWinner({ eventId }) {
  if (!eventId) throw new Error('espn-atp-tournament: missing eventId');
  // Wide date window — tournaments span 1-2 weeks and we may poll
  // a few days post-final. -7 / +60 covers in-progress and just-
  // completed events at the same query.
  const now = new Date();
  const back = new Date(now.getTime() - 7 * 86_400_000);
  const fwd  = new Date(now.getTime() + 60 * 86_400_000);
  const fmt = (x) => `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, '0')}${String(x.getUTCDate()).padStart(2, '0')}`;
  const range = `${fmt(back)}-${fmt(fwd)}`;
  const res = await fetch(`${ESPN_ATP_BASE}/scoreboard?dates=${range}&limit=500`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`espn-atp-tournament: HTTP ${res.status}`);
  const data = await res.json();
  const events = Array.isArray(data?.events) ? data.events : [];
  const ev = events.find(e => String(e.id) === String(eventId));
  if (!ev) {
    return { completed: false, winner: null, notFound: true };
  }
  const completed = Boolean(ev?.status?.type?.completed)
    || ev?.status?.type?.state === 'post';
  if (!completed) {
    return { completed: false, winner: null, state: ev?.status?.type?.state || null };
  }
  // Pull Men's Singles draw.
  const groupings = Array.isArray(ev.groupings) ? ev.groupings : [];
  const mens = groupings.find(g => g?.grouping?.slug === 'mens-singles');
  if (!mens) {
    return { completed: false, winner: null, state: 'no_mens_singles' };
  }
  // Round id '7' is the Final on ESPN. There can be multiple comps
  // with that round id across years/groupings, so within Men's
  // Singles the latest-by-date Final is the right one.
  const comps = Array.isArray(mens.competitions) ? mens.competitions : [];
  const finals = comps.filter(c => c?.round?.id === '7');
  if (finals.length === 0) {
    return { completed: false, winner: null, state: 'no_final_match' };
  }
  finals.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
  const final = finals[finals.length - 1];
  const ctors = Array.isArray(final?.competitors) ? final.competitors : [];
  const winnerC = ctors.find(c => c?.winner === true);
  if (!winnerC) {
    // Final scheduled but result not in yet (TBD competitors, etc.)
    // — let cron retry next tick.
    return { completed: false, winner: null, state: 'final_pending' };
  }
  const ath = winnerC?.athlete || {};
  const athleteId = winnerC?.id ? String(winnerC.id) : null;
  const fullName = ath.displayName
    || ath.fullName
    || `${ath.firstName || ''} ${ath.lastName || ''}`.trim()
    || null;
  return {
    completed: true,
    winner: 'p1',
    winnerDriverId: athleteId,
    winnerDriverLabel: fullName,
  };
}

// ─── ESPN golf scoreboard winner (PGA + LIV) ───────────────────────────
// Reads the post-tournament leaderboard from ESPN's golf scoreboard
// and returns the winner. Uses the parallel-shape dispatch in the
// cron, so the return shape mirrors readJolpicaF1Result —
// winnerDriverId / winnerDriverLabel — and the same matching logic
// (id-first, then label, then "Otro" fallback) applies.
//
// Notes:
//   - leaguePath: 'pga' (PGA Tour) or 'liv' (LIV Golf). ESPN exposes
//     both at the same scoreboard endpoint shape, so a single reader
//     handles them. Add new tours here when needed.
//   - The scoreboard endpoint covers ~60 days forward from the query
//     date; we widen by 7 days back so a tournament that just ended
//     is still in the window when the cron polls.
//   - ESPN sets status.type.completed=true once the final round is
//     official. Sunday-evening cron ticks find the winner the same
//     night.
//   - Winner lookup uses competitor.order === 1, NOT
//     status.position. ESPN doesn't populate status.position on
//     completed events (verified empirically across 2026 majors,
//     LIV events, and the PGA Zurich Classic).
//   - Two competitor shapes ESPN ships:
//       individual (Masters, every LIV event, etc.): { type:
//         'athlete', id: <athleteId>, athlete: { displayName, ... } }
//       team (PGA Zurich Classic, Presidents Cup): { type: 'team',
//         id: <teamId>, team: { displayName: 'Smalley/Springer', ... } }
//     Team events have no individual athlete to match against the
//     hardcoded FIELD, so the cron's parallel-shape leg matcher
//     falls through to "Otro". That's the correct outcome — the
//     FIELD lists individual players, none of whom can "win" a team
//     event by themselves.

const ESPN_GOLF_BASE = 'https://site.api.espn.com/apis/site/v2/sports/golf';

async function readEspnGolfWinnerImpl({ leaguePath, eventId }) {
  if (!leaguePath) throw new Error('espn-golf: missing leaguePath');
  if (!eventId) throw new Error('espn-golf: missing eventId');
  // Wide date window so tournaments mid-week or just-finished are
  // still found (PGA events span Thu→Sun, weather can extend to Mon;
  // LIV is Fri→Sun shotgun-start).
  const now = new Date();
  const back = new Date(now.getTime() - 7 * 86_400_000);
  const fwd  = new Date(now.getTime() + 60 * 86_400_000);
  const fmt = (x) => `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, '0')}${String(x.getUTCDate()).padStart(2, '0')}`;
  const range = `${fmt(back)}-${fmt(fwd)}`;
  const res = await fetch(`${ESPN_GOLF_BASE}/${leaguePath}/scoreboard?dates=${range}&limit=50`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`espn-${leaguePath}: HTTP ${res.status}`);
  const data = await res.json();
  const events = Array.isArray(data?.events) ? data.events : [];
  const ev = events.find(e => String(e.id) === String(eventId));
  if (!ev) {
    return { completed: false, winner: null, notFound: true };
  }
  const completed = Boolean(ev?.status?.type?.completed);
  if (!completed) {
    return { completed: false, winner: null, state: ev?.status?.type?.state || null };
  }
  // Find the order=1 competitor. Both individual and team events
  // expose `order: 1` on the leader; status.position is not reliable
  // (it's null on completed events as of 2026).
  const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
  const ctors = Array.isArray(comp?.competitors) ? comp.competitors : [];
  const winnerC = ctors.find(c => c?.order === 1);
  if (!winnerC) {
    // No order=1 — could be an unresolved playoff or unusual data.
    // Treat as "not done" so the cron retries.
    return { completed: false, winner: null, state: 'no_order_1' };
  }
  const isTeam = winnerC?.type === 'team';
  if (isTeam) {
    // Team events: surface the team's displayName as the label so
    // the resolved-card final-score still says something useful, but
    // pass null id so the leg matcher can't accidentally match a
    // FIELD player whose id happens to collide with the team id.
    // Falls through to "Otro" as expected.
    const teamName = winnerC?.team?.displayName
      || winnerC?.team?.shortDisplayName
      || winnerC?.team?.name
      || null;
    return {
      completed: true,
      winner: 'p1',
      winnerDriverId: null,
      winnerDriverLabel: teamName,
    };
  }
  // Individual event — pull athlete.id from `competitor.id` (which
  // mirrors athlete.id in the API) and the display name from
  // competitor.athlete.
  const ath = winnerC?.athlete || {};
  const athleteId = winnerC?.id ? String(winnerC.id) : null;
  const fullName = ath.displayName
    || ath.fullName
    || ath.shortName
    || `${ath.firstName || ''} ${ath.lastName || ''}`.trim()
    || null;
  return {
    completed: true,
    winner: 'p1',
    // Reuse F1's field names so the cron's parallel-shape dispatch
    // and buildFinalScore can match by id then label without a
    // golf-specific code path.
    winnerDriverId: athleteId,
    winnerDriverLabel: fullName,
  };
}

export const readEspnPgaWinner = ({ eventId }) =>
  readEspnGolfWinnerImpl({ leaguePath: 'pga', eventId });

export const readEspnLivWinner = ({ eventId }) =>
  readEspnGolfWinnerImpl({ leaguePath: 'liv', eventId });

// ─── LIV Golf team-leaderboard reader (livgolf.com scrape) ───────────
//
// ESPN's `golf/liv` API only ships individual scores — their /teams
// endpoint literally responds "Teams are not currently supported for
// golf/liv", and /summary returns 502 on LIV events. So we scrape
// livgolf.com/leaderboard, which renders via Next.js App Router with
// the team standings embedded in the RSC stream
// (self.__next_f.push([...]) blocks).
//
// Match strategy: parse the events list inside the RSC payload, find
// the event whose displayName/startDate matches the market's
// tournamentName/startDateIso, then read the displayed
// `initialTeamConfig.playoff.teams[]` array (which always reflects
// the currently-displayed event). If the page is showing a different
// event than the one we're trying to resolve, we return
// {completed:false} so the cron retries later (livgolf swaps the
// displayed event in the days after each tournament ends).
//
// Returns the same envelope as the individual ESPN readers
// (winnerDriverId / winnerDriverLabel) so the cron's parallel-shape
// matcher picks it up unchanged.

const LIVGOLF_LEADERBOARD = 'https://www.livgolf.com/leaderboard';

// livgolf.com team slug → market_gen/liv.js TEAMS.{id, name}.
// Verified against an actual rendered RSC payload (LIV Virginia,
// 2026-05). Add new teams here as LIV expands.
const LIV_TEAM_BY_SLUG = {
  '4-aces':           { id: 'fourAces',       name: '4Aces GC' },
  'fireballs':        { id: 'fireballs',      name: 'Fireballs GC' },
  'legion':           { id: 'legion',         name: 'Legion XIII' },
  'crushers':         { id: 'crushers',       name: 'Crushers GC' },
  'ripper':           { id: 'ripper',         name: 'Ripper GC' },
  'southern-guards':  { id: 'southernGuards', name: 'Southern Guards GC' },
  'cleeks':           { id: 'cleeks',         name: 'Cleeks GC' },
  'torque':           { id: 'torque',         name: 'Torque GC' },
  'hy-flyers':        { id: 'hyflyers',       name: 'HyFlyers GC' },
  'okgc':             { id: 'okgc',           name: 'OKGC' },
  'majesticks':       { id: 'majesticks',     name: 'Majesticks GC' },
  'range-goats':      { id: 'rangegoats',     name: 'RangeGoats GC' },
  'korean-golf-club': { id: 'koreanGc',       name: 'Korean GC' },
};

function decodeRscStream(html) {
  const re = /self\.__next_f\.push\(\[\s*1\s*,\s*"([\s\S]*?)"\s*\]\)/g;
  let m, all = '';
  while ((m = re.exec(html)) !== null) {
    all += m[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\');
  }
  return all;
}

// Match livgolf's event-list entry to our market. Two anchors:
//   - displayName loosely contains the market's tournamentName
//     (livgolf prefixes "MAADEN " etc.; we compare loosely)
//   - startDate's YYYY-MM-DD equals the market's startDateIso prefix
// Either anchor counts as a match. If neither hits we bail.
function findDisplayedEvent(rsc, { tournamentName, startDateIso }) {
  // Event entries look like:
  //   {"id":"10058","event":"virginia","displayName":"MAADEN LIV Golf Virginia",
  //    "time":"May 7, 2026","location":"...","disabled":...,"isLive":false,
  //    "statusLabel":"Round 4","startDate":"2026-05-07T17:05:00.000Z",...}
  const re = /\{"id":"\d+","event":"[^"]+","displayName":"([^"]+)","time":"[^"]+","location":"[^"]+","disabled":[^,]+,"isLive":[^,]+,"statusLabel":"[^"]+","startDate":"([^"]+)"/g;
  const wantDate = typeof startDateIso === 'string' ? startDateIso.slice(0, 10) : null;
  const wantName = String(tournamentName || '').toLowerCase();
  let m;
  while ((m = re.exec(rsc)) !== null) {
    const display = m[1];
    const startISO = m[2];
    const dateOk = wantDate && startISO.slice(0, 10) === wantDate;
    const nameOk = wantName
      && (display.toLowerCase().includes(wantName)
       || wantName.includes(display.toLowerCase()));
    if (dateOk || nameOk) {
      return { displayName: display, startDate: startISO };
    }
  }
  return null;
}

export async function readLivTeamWinner({ tournamentName, startDateIso }) {
  // The page is React Server Components rendered HTML — we need a
  // browser-ish UA so the CDN doesn't serve a bot-blocked variant.
  const res = await fetch(LIVGOLF_LEADERBOARD, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 PronosLivBot/1.0',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`livgolf: HTTP ${res.status}`);
  const html = await res.text();
  const rsc = decodeRscStream(html);
  if (!rsc) {
    return { completed: false, winner: null, state: 'no_rsc_stream' };
  }

  // Make sure the displayed event is the one we want — livgolf swaps
  // the active event after Monday or so. If it shows a different one,
  // bail and let the cron retry later.
  const matched = findDisplayedEvent(rsc, { tournamentName, startDateIso });
  if (!matched) {
    return { completed: false, winner: null, state: 'event_not_displayed' };
  }

  // Pull the team rankings. Order in the array == final ranking, but
  // we explicitly key on position="1" so a rendering quirk can't
  // mislead us.
  const teamRe = /"teamId":\d+,"team":"([^"]+)","position":"([^"]+)","eventPositionText":"([^"]+)"/g;
  let t;
  let winnerSlug = null;
  while ((t = teamRe.exec(rsc)) !== null) {
    if (t[2] === '1' || t[3] === '1') {
      winnerSlug = t[1];
      break;
    }
  }
  if (!winnerSlug) {
    return { completed: false, winner: null, state: 'no_position_1' };
  }

  const mapped = LIV_TEAM_BY_SLUG[winnerSlug];
  if (!mapped) {
    // Unknown slug — log + return label so the cron can still resolve
    // via label-match. id=null prevents an accidental driver-id
    // collision with the individual market.
    console.warn('[livgolf-team] unknown slug', { slug: winnerSlug, tournamentName });
    return {
      completed: true,
      winner: 'p1',
      winnerDriverId: null,
      winnerDriverLabel: winnerSlug,
    };
  }
  return {
    completed: true,
    winner: 'p1',
    winnerDriverId: mapped.id,
    winnerDriverLabel: mapped.name,
  };
}

// ─── Jolpica F1 season-standings (championship resolver) ─────────────
// Reads /{season}/{constructorStandings,driverStandings}.json and
// returns position-1 in the same envelope as the per-race resolver
// (winnerDriverId / winnerDriverLabel) so the cron's parallel-shape
// matcher handles championship markets unchanged.
//
// Idempotent: standings keep being recomputed after every race, but
// the cron only auto-resolves markets whose end_time has passed.
// We set season markets' end_time to ~3 days after the season
// finale (Abu Dhabi GP), so by the time this is queried the
// standings are mathematically final.
//
// kind: 'drivers' | 'constructors'

const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1';

export async function readJolpicaF1Standings({ season, kind }) {
  if (!season) throw new Error('jolpica: missing season');
  const path = kind === 'constructors' ? 'constructorStandings' : 'driverStandings';
  const res = await fetch(
    `${JOLPICA_BASE}/${encodeURIComponent(season)}/${path}.json`,
    { headers: { 'Accept': 'application/json' } },
  );
  if (!res.ok) throw new Error(`jolpica: HTTP ${res.status}`);
  const data = await res.json();
  const lists = data?.MRData?.StandingsTable?.StandingsLists;
  if (!Array.isArray(lists) || lists.length === 0) {
    return { completed: false, winner: null };
  }
  const items = kind === 'constructors'
    ? (lists[0].ConstructorStandings || [])
    : (lists[0].DriverStandings || []);
  const p1 = items.find(s => String(s.position) === '1');
  if (!p1) return { completed: false, winner: null };
  if (kind === 'constructors') {
    const c = p1.Constructor || {};
    return {
      completed: true,
      winner: 'p1',
      winnerDriverId: c.constructorId || null,
      winnerDriverLabel: c.name || null,
    };
  }
  const drv = p1.Driver || {};
  const label = `${drv.givenName || ''} ${drv.familyName || ''}`.trim();
  return {
    completed: true,
    winner: 'p1',
    winnerDriverId: drv.driverId || null,
    winnerDriverLabel: label || null,
  };
}

// ─── Jolpica F1 results ────────────────────────────────────────────────
// Race is settled once /{season}/{round}/results.json has position 1.
// (JOLPICA_BASE declared above near the season-standings reader.)

export async function readJolpicaF1Result({ season, round }) {
  if (!season || !round) throw new Error('jolpica: missing season/round');
  const res = await fetch(`${JOLPICA_BASE}/${encodeURIComponent(season)}/${encodeURIComponent(round)}/results.json`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`jolpica: HTTP ${res.status}`);
  const data = await res.json();
  const races = data?.MRData?.RaceTable?.Races || [];
  const race = races[0];
  const results = race?.Results || [];
  const p1 = results.find(r => String(r.position) === '1');
  if (!p1) return { completed: false, winner: null };
  const drv = p1.Driver || {};
  const label = `${drv.givenName || ''} ${drv.familyName || ''}`.trim();
  return {
    completed: true,
    winner: 'p1',
    winnerDriverId: drv.driverId || null,
    winnerDriverLabel: label,
  };
}
