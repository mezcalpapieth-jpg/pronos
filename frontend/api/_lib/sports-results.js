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

// ─── ESPN PGA Tour winner ──────────────────────────────────────────────
// Reads the post-tournament leaderboard from ESPN's golf scoreboard
// and returns position-1 (the winner). Uses the parallel-shape
// dispatch in the cron, so the return shape mirrors readJolpicaF1Result
// — winnerDriverId / winnerDriverLabel — and the same matching logic
// (id-first, then label, then "Otro" fallback) applies.
//
// Notes:
//   - The PGA scoreboard endpoint covers ~60 days forward from the
//     query date; we widen by 7 days back so a tournament that just
//     ended is still in the window when the cron polls.
//   - ESPN sets status.type.completed=true once the final round is
//     official. Sunday-evening cron ticks find the winner the same
//     night.
//   - Leaderboard players appear under competitions[0].competitors
//     with status.position.id ranking. Position "1" is the winner.

const ESPN_PGA = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

export async function readEspnPgaWinner({ eventId }) {
  if (!eventId) throw new Error('espn-pga: missing eventId');
  // Wide date window so tournaments mid-week or just-finished are
  // still found (PGA events span Thu→Sun, weather can extend to Mon).
  const now = new Date();
  const back = new Date(now.getTime() - 7 * 86_400_000);
  const fwd  = new Date(now.getTime() + 60 * 86_400_000);
  const fmt = (x) => `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, '0')}${String(x.getUTCDate()).padStart(2, '0')}`;
  const range = `${fmt(back)}-${fmt(fwd)}`;
  const res = await fetch(`${ESPN_PGA}?dates=${range}&limit=50`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`espn-pga: HTTP ${res.status}`);
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
  // Pull position-1 from the leaderboard. ESPN nests competitors in
  // competitions[0].competitors; each competitor has athlete.id and
  // status.position.id (string "1" / "2" / ... or "T2" for ties).
  const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
  const ctors = Array.isArray(comp?.competitors) ? comp.competitors : [];
  const p1 = ctors.find(c => {
    const pos = c?.status?.position?.id ?? c?.status?.position;
    return String(pos) === '1';
  });
  if (!p1) {
    // Tournament reported completed but no clear position 1 — could
    // be a tie that resolved to a playoff still in flight. Treat as
    // "not done" so the cron retries.
    return { completed: false, winner: null, state: 'no_p1' };
  }
  const ath = p1?.athlete || p1?.competitor?.athlete || {};
  const fullName = ath.displayName
    || `${ath.firstName || ''} ${ath.lastName || ''}`.trim()
    || null;
  return {
    completed: true,
    winner: 'p1',
    // Reuse F1's field names so the cron's parallel-shape dispatch
    // and buildFinalScore can match by id then label without a
    // golf-specific code path.
    winnerDriverId: ath.id ? String(ath.id) : null,
    winnerDriverLabel: fullName,
  };
}

// ─── Jolpica F1 results ────────────────────────────────────────────────
// Race is settled once /{season}/{round}/results.json has position 1.

const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1';

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
