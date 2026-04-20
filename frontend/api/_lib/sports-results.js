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
    status,
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
