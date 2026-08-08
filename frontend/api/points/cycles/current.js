/**
 * GET /api/points/cycles/current
 *
 * Returns the currently-active competition cycle when public cycles are open.
 * The launch tournament window is configured in code so the public page can
 * count down even while the old admin pause flag remains set. Admin can still
 * close and reopen future cycles from /api/points/admin/cycles.
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

function tournamentPayload(window = getTournamentWindow()) {
  return {
    paused: false,
    label: window.label,
    window,
    rules: tournamentRulesPayload(),
    cycle: {
      id: null,
      label: window.label,
      status: window.status,
      paused: false,
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

export default async function handler(req, res) {
  const timer = createApiTimer(res, 'points/cycles/current');
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    setCacheHeaders(res, { scope: 'public', maxAge: 10, sMaxage: 30, staleWhileRevalidate: 120 });
    const { value: payload, hit } = await cachedJson('points:cycles:current:v2', 20_000, async () => {
      await timer.time('schema', () => ensurePointsSchema(sql));
      const window = getTournamentWindow();
      const paused = await timer.time('db_pause', () => cyclesArePaused());
      if (paused && window.status === 'closed') {
        return pausedPayload();
      }

      if (window.status !== 'closed') {
        return tournamentPayload(window);
      }

      const row = await timer.time('db_current', () => getCurrent());
      if (!row) {
        return tournamentPayload(window);
      }

      const endsAtMs = new Date(row.ends_at).getTime();
      const secondsRemaining = Math.max(0, Math.floor((endsAtMs - Date.now()) / 1000));

      return {
        paused: false,
        label: row.label || window.label,
        window,
        rules: tournamentRulesPayload(),
        cycle: {
          id: row.id,
          label: row.label || window.label,
          startedAt: row.started_at,
          startsAt: row.started_at,
          operationCloseAt: window.operationCloseAt,
          rankingCutoffAt: window.rankingCutoffAt,
          endsAt: row.ends_at,
          status: row.status,
          createdAt: row.created_at,
          closedAt: row.closed_at,
          secondsUntilStart: window.secondsUntilStart,
          secondsUntilOperationClose: window.secondsUntilOperationClose,
          secondsRemaining,
          // Flag the UI can use to show "pendiente de cierre" once the
          // deadline passes but before an admin rolls over.
          pastDeadline: secondsRemaining === 0,
        },
      };
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
