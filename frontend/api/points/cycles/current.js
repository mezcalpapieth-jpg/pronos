/**
 * GET /api/points/cycles/current
 *
 * Returns the currently-active competition cycle when admin has opened one
 * with the reset/rollover control. The code-defined launch window is only a
 * paused preview; PnL scoring starts when a real points_cycles row exists.
 *
 * Response:
 *   {
 *     cycle: {
 *       id, label, startedAt, endsAt, status, createdAt,
 *       secondsRemaining   // convenience — server-computed so the UI
 *                           // doesn't drift if the client clock is off
 *     }
 *   }
 *
 * No auth required — this is a public read so the ticker/home countdown
 * works for logged-out visitors too.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { cachedJson, createApiTimer, setCacheHeaders } from '../../_lib/api-performance.js';
import {
  configuredCycleWindowFromRow,
  getTournamentWindow,
  tournamentRulesPayload,
} from '../../_lib/points-tournament-config.js';

const sql = neon(process.env.DATABASE_URL);

const CYCLES_PAUSED_KEY = 'points_cycles_paused';

function parseSettingBool(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && typeof value.paused === 'boolean') return value.paused;
  return fallback;
}

async function cyclesArePaused() {
  const rows = await sql`
    SELECT value
    FROM points_app_settings
    WHERE key = ${CYCLES_PAUSED_KEY}
    LIMIT 1
  `;
  return parseSettingBool(rows[0]?.value, true);
}

async function getCurrent() {
  // Look for an existing active cycle whose ends_at is in the future. We
  // don't auto-close expired cycles here — that's the admin rollover's
  // job, so there's always exactly one source of truth for closure.
  const existing = await sql`
    SELECT id, label, started_at, ends_at, status, created_at, closed_at
    FROM points_cycles
    WHERE status = 'active'
    ORDER BY ends_at DESC
    LIMIT 1
  `;
  return existing[0] || null;
}

function pausedPayload() {
  const window = getTournamentWindow();
  return {
    paused: true,
    label: window.label || 'Próximamente',
    window,
    rules: tournamentRulesPayload(),
    cycle: {
      id: null,
      label: window.label || 'Próximamente',
      status: window.status === 'scheduled' ? 'scheduled' : 'paused',
      paused: true,
      scheduled: window.scheduled,
      startedAt: window.startsAt,
      startsAt: window.startsAt,
      operationCloseAt: window.operationCloseAt,
      rankingCutoffAt: window.rankingCutoffAt,
      endsAt: window.endsAt,
      createdAt: null,
      closedAt: null,
      secondsUntilStart: window.secondsUntilStart,
      secondsUntilOperationClose: window.secondsUntilOperationClose,
      secondsRemaining: window.secondsRemaining,
      pastDeadline: window.pastDeadline,
    },
  };
}

function dbCyclePayload(row, window = getTournamentWindow()) {
  const now = Date.now();
  const cycleWindow = configuredCycleWindowFromRow(row) || {
    label: row.label || window.label,
    startsAt: row.started_at,
    operationCloseAt: row.ends_at,
    rankingCutoffAt: row.ends_at,
    endsAt: row.ends_at,
  };
  const startsAtMs = new Date(cycleWindow.startsAt).getTime();
  const operationCloseMs = new Date(cycleWindow.operationCloseAt || cycleWindow.endsAt).getTime();
  const endsAtMs = new Date(cycleWindow.rankingCutoffAt || cycleWindow.endsAt).getTime();
  const secondsUntilStart = Math.max(0, Math.floor((startsAtMs - now) / 1000));
  const secondsRemaining = Math.max(0, Math.floor((endsAtMs - now) / 1000));
  const secondsUntilOperationClose = Math.max(0, Math.floor((operationCloseMs - now) / 1000));
  const active = now >= startsAtMs && secondsRemaining > 0;
  const closing = active && secondsUntilOperationClose === 0;
  return {
    paused: false,
    label: cycleWindow.label || window.label,
    window,
    rules: tournamentRulesPayload(),
    cycle: {
      id: row.id,
      label: cycleWindow.label || window.label,
      startedAt: cycleWindow.startsAt,
      startsAt: cycleWindow.startsAt,
      operationCloseAt: cycleWindow.operationCloseAt || cycleWindow.endsAt,
      rankingCutoffAt: cycleWindow.rankingCutoffAt || cycleWindow.endsAt,
      endsAt: cycleWindow.endsAt,
      status: secondsRemaining === 0 ? 'closed' : closing ? 'closing' : active ? 'active' : 'scheduled',
      paused: false,
      scheduled: now < startsAtMs,
      createdAt: row.created_at,
      closedAt: row.closed_at,
      secondsUntilStart,
      secondsUntilOperationClose,
      secondsRemaining,
      pastDeadline: secondsRemaining === 0,
    },
  };
}

export default async function handler(req, res) {
  const timer = createApiTimer(res, 'points/cycles/current');
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    setCacheHeaders(res, { scope: 'public', maxAge: 10, sMaxage: 30, staleWhileRevalidate: 120 });
    const { value: payload, hit } = await cachedJson('points:cycles:current:v4', 20_000, async () => {
      await timer.time('schema', () => ensurePointsSchema(sql));
      const window = getTournamentWindow();
      const paused = await timer.time('db_pause', () => cyclesArePaused());
      if (paused) {
        return pausedPayload();
      }

      const row = await timer.time('db_current', () => getCurrent());
      if (row) {
        return dbCyclePayload(row, window);
      }

      return pausedPayload();
    });
    res.setHeader('X-Pronos-Cache', hit ? 'hit' : 'miss');
    timer.end({ cache: hit ? 'hit' : 'miss' });
    return res.status(200).json(payload);
  } catch (e) {
    timer.end({ error: 'cycles_current_failed' });
    console.error('[points/cycles/current] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'db_unavailable',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
