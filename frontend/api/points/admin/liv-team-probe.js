/**
 * GET /api/points/admin/liv-team-probe?eventId=<id>
 * GET /api/points/admin/liv-team-probe              (no id → recent events)
 *
 * Diagnostic for LIV Golf team-result auto-resolution. ESPN's public
 * /scoreboard endpoint only exposes individual player scores; this
 * probe checks whether the per-event /summary endpoint carries the
 * team-leaderboard data we'd need to flip the team market from
 * manual resolution to sports_api auto-resolve.
 *
 * Two modes:
 *   1. No eventId      → lists recent LIV events (60-day window)
 *                        with state + name so we can pick a finished
 *                        one to probe.
 *   2. eventId=<id>    → fetches the /summary doc, surfaces the
 *                        fields most likely to carry team scores,
 *                        and reports whether team data is present
 *                        with confidence guesses for each candidate
 *                        location.
 *
 * Once we know whether ESPN ships team data anywhere in /summary,
 * we either:
 *   - flip the team market in market-gen/liv.js to resolver_type=
 *     'sports_api' and add a sports-results.js dispatcher → no
 *     scraping needed; OR
 *   - drop this probe + build a livgolf.com __NEXT_DATA__ scraper
 *     instead.
 */
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/golf/liv/scoreboard';
const SUMMARY    = 'https://site.api.espn.com/apis/site/v2/sports/golf/liv/summary';

function compactDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

async function listRecentEvents() {
  const now = new Date();
  // 60 days back, 30 days forward — covers both finished events
  // (for probing) and upcoming (for context).
  const start = new Date(now.getTime() - 60 * 86_400_000);
  const end   = new Date(now.getTime() + 30 * 86_400_000);
  const url = `${SCOREBOARD}?dates=${compactDate(start)}-${compactDate(end)}&limit=50`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`scoreboard HTTP ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data?.events) ? data.events : []).map(e => ({
    id: e.id,
    name: e.name,
    state: e.status?.type?.state || null,
    detail: e.status?.type?.shortDetail || e.status?.type?.detail || null,
    date: e.date,
  }));
}

// Best-effort surface of where team data MIGHT live in the summary
// payload. We don't trust any single shape — ESPN's docs are silent
// on LIV — so we report on every candidate field with size + first
// row structure so the operator can eyeball it.
function summarizeShape(summary) {
  const result = {
    eventState: summary?.header?.competitions?.[0]?.status?.type?.state
            ?? summary?.header?.eventStatus?.type?.state
            ?? null,
    eventName: summary?.header?.competitions?.[0]?.competitors?.[0]?.athlete?.tournament?.name
            ?? summary?.header?.name
            ?? null,
    candidates: {},
    teamWinnerGuess: null,
  };

  // Candidate 1: header.groups (sometimes carries team summaries)
  const headerGroups = summary?.header?.competitions?.[0]?.groups;
  if (Array.isArray(headerGroups)) {
    result.candidates.headerGroups = {
      present: true,
      count: headerGroups.length,
      sampleKeys: Object.keys(headerGroups[0] || {}),
      sample: headerGroups[0] || null,
    };
  } else {
    result.candidates.headerGroups = { present: false };
  }

  // Candidate 2: leaderboard with type=team
  const leaderboards = summary?.leaderboards;
  if (Array.isArray(leaderboards)) {
    const teamLb = leaderboards.find(lb =>
         /team/i.test(lb?.id || '')
      || /team/i.test(lb?.name || '')
      || /team/i.test(lb?.label || '')
    );
    result.candidates.teamLeaderboard = {
      present: !!teamLb,
      allBoardIds: leaderboards.map(lb => lb?.id || lb?.name || lb?.label || '?'),
      sampleKeys: teamLb ? Object.keys(teamLb) : null,
      sampleEntry: teamLb?.entries?.[0] || teamLb?.competitors?.[0] || null,
      entryCount: (teamLb?.entries || teamLb?.competitors || []).length || 0,
    };
  } else {
    result.candidates.teamLeaderboard = { present: false };
  }

  // Candidate 3: competitions[0].competitors with team field
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  const withTeam = competitors.filter(c => c?.team || c?.type === 'team');
  result.candidates.competitorsWithTeam = {
    present: withTeam.length > 0,
    count: withTeam.length,
    totalCompetitors: competitors.length,
    sample: withTeam[0] || null,
  };

  // Candidate 4: top-level competitions array (some sports use this)
  const comps = summary?.competitions;
  if (Array.isArray(comps)) {
    result.candidates.topLevelCompetitions = {
      present: true,
      count: comps.length,
      sampleKeys: Object.keys(comps[0] || {}),
    };
  } else {
    result.candidates.topLevelCompetitions = { present: false };
  }

  // Candidate 5: header.competitions[0].competitors[].statistics —
  // some sports lift team affiliation via athlete.team.
  const sampleAthlete = competitors[0]?.athlete;
  if (sampleAthlete?.team) {
    result.candidates.athleteTeam = {
      present: true,
      sample: { name: sampleAthlete.displayName, team: sampleAthlete.team },
    };
  } else {
    result.candidates.athleteTeam = { present: false };
  }

  // Best-effort guess at the team winner if any candidate produced
  // ranked team rows.
  const teamLb = result.candidates.teamLeaderboard;
  if (teamLb?.present && teamLb.sampleEntry) {
    const winner = (teamLb.sampleEntry?.statistics || [])
      .find(s => s?.name === 'scoringPosition' || s?.name === 'position');
    result.teamWinnerGuess = {
      source: 'leaderboards[type=team].entries[0]',
      entry: teamLb.sampleEntry,
      derivedPosition: winner?.value || null,
    };
  }

  return result;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const eventId = typeof req.query.eventId === 'string' ? req.query.eventId.trim() : '';

  try {
    if (!eventId) {
      // Mode 1: list recent events so the operator can pick one to probe.
      const events = await listRecentEvents();
      return res.status(200).json({
        ok: true,
        mode: 'list',
        hint: 'Re-call with ?eventId=<id> on a finished event (state=post) to probe team data.',
        eventCount: events.length,
        events,
      });
    }

    // Mode 2: probe one event.
    const url = `${SUMMARY}?event=${encodeURIComponent(eventId)}`;
    const res2 = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res2.ok) {
      return res.status(res2.status).json({
        ok: false,
        error: `summary HTTP ${res2.status}`,
        url,
      });
    }
    const summary = await res2.json();
    const shape = summarizeShape(summary);

    return res.status(200).json({
      ok: true,
      mode: 'probe',
      eventId,
      url,
      payloadBytes: JSON.stringify(summary).length,
      topLevelKeys: Object.keys(summary),
      shape,
      // Verdict: did we find team data anywhere?
      teamDataFound: !!(
           shape.candidates.headerGroups?.present
        || shape.candidates.teamLeaderboard?.present
        || shape.candidates.competitorsWithTeam?.present
        || shape.candidates.athleteTeam?.present
      ),
      recommendation: (() => {
        if (shape.candidates.teamLeaderboard?.present) {
          return 'Team data found in leaderboards[type=team]. Wire sports-results.js to read this branch.';
        }
        if (shape.candidates.headerGroups?.present) {
          return 'Team data may be in header.competitions[0].groups. Inspect sample to confirm.';
        }
        if (shape.candidates.competitorsWithTeam?.present) {
          return 'Some competitors carry .team. Could derive team standings, but check if scores are present.';
        }
        if (shape.candidates.athleteTeam?.present) {
          return 'Athlete-team mapping exists — could compute team scores client-side from per-player rounds. Heavy but doable.';
        }
        return 'No team data surfaced in /summary. Recommend Option 2: livgolf.com __NEXT_DATA__ scraper.';
      })(),
    });
  } catch (e) {
    console.error('[admin/liv-team-probe] failed', { message: e?.message });
    return res.status(500).json({
      ok: false,
      error: 'probe_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
