/**
 * GET /api/points/cycles/current
 *
 * Returns the currently-active competition cycle when public cycles are open.
 * If cycles are paused or no active cycle exists, the endpoint returns a
 * paused "Próximamente" state instead of auto-creating a new countdown. Admin
 * can restart cycles from /api/points/admin/cycles.
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
  return {
    paused: true,
    label: 'Próximamente',
    cycle: {
      id: null,
      label: 'Próximamente',
      status: 'paused',
      paused: true,
      startedAt: null,
      endsAt: null,
      createdAt: null,
      closedAt: null,
      secondsRemaining: null,
      pastDeadline: false,
    },
  };
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    await ensurePointsSchema(sql);
    if (await cyclesArePaused()) {
      return res.status(200).json(pausedPayload());
    }

    const row = await getCurrent();
    if (!row) {
      return res.status(200).json(pausedPayload());
    }

    const endsAtMs = new Date(row.ends_at).getTime();
    const secondsRemaining = Math.max(0, Math.floor((endsAtMs - Date.now()) / 1000));

    return res.status(200).json({
      cycle: {
        id: row.id,
        label: row.label,
        startedAt: row.started_at,
        endsAt: row.ends_at,
        status: row.status,
        createdAt: row.created_at,
        closedAt: row.closed_at,
        secondsRemaining,
        // Flag the UI can use to show "pendiente de cierre" once the
        // deadline passes but before an admin rolls over.
        pastDeadline: secondsRemaining === 0,
      },
    });
  } catch (e) {
    console.error('[points/cycles/current] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'db_unavailable',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
