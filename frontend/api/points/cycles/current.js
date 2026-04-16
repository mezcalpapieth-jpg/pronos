/**
 * GET /api/points/cycles/current
 *
 * Returns the currently-active competition cycle. If none exists, the
 * endpoint auto-creates one (cycle #1 starts now, ends 14 days out) so
 * the UI can always render a countdown without requiring admin setup.
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

const CYCLE_DAYS = 14;

function cycleLabel(startIsoDate) {
  // "Ciclo del 5 abr — 19 abr" — helps humans glance at which cycle is
  // running without pulling up the admin panel. Server-side formatting
  // so the label stays stable regardless of viewer locale.
  try {
    const start = new Date(startIsoDate);
    const end = new Date(start.getTime() + CYCLE_DAYS * 24 * 60 * 60 * 1000);
    const fmt = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' });
    return `Ciclo ${fmt.format(start)} — ${fmt.format(end)}`;
  } catch {
    return null;
  }
}

async function getOrCreateCurrent() {
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
  if (existing.length > 0) return existing[0];

  // No active cycle — bootstrap cycle #1 starting now.
  const now = new Date();
  const startedAt = now.toISOString();
  const endsAt = new Date(now.getTime() + CYCLE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const label = cycleLabel(startedAt);
  const inserted = await sql`
    INSERT INTO points_cycles (label, started_at, ends_at, status)
    VALUES (${label}, ${startedAt}, ${endsAt}, 'active')
    RETURNING id, label, started_at, ends_at, status, created_at, closed_at
  `;
  return inserted[0];
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    await ensurePointsSchema(sql);
    const row = await getOrCreateCurrent();
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
