import {
  configuredCycleWindowFromRow,
  tournamentScoringStartsAt,
} from './points-tournament-config.js';

async function queryRows(db, text, params = []) {
  const result = await db.query(text, params);
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.rows) ? result.rows : [];
}

function hydrateCycleWindow(row, scope) {
  if (!row) return null;
  const configured = configuredCycleWindowFromRow(row);
  const base = configured || {
    id: row.id ?? null,
    label: row.label || null,
    startsAt: row.started_at,
    scoringStartsAt: row.started_at,
    operationCloseAt: row.ends_at,
    rankingCutoffAt: row.ends_at,
    endsAt: row.ends_at,
  };

  return {
    ...base,
    scope,
    id: base.id ?? row.id ?? null,
    label: base.label || row.label || null,
    status: row.status || null,
    closedAt: row.closed_at || null,
    scoringStartIso: tournamentScoringStartsAt(base),
  };
}

export async function readActiveCycleWindow(db) {
  const rows = await queryRows(db, `
    SELECT id, label, started_at, ends_at, status, closed_at
    FROM points_cycles
    WHERE status = 'active'
    ORDER BY ends_at DESC
    LIMIT 1
  `);
  return hydrateCycleWindow(rows[0], 'current');
}

export async function readPreviousCycleWindow(db) {
  const rows = await queryRows(db, `
    SELECT id, label, started_at, ends_at, status, closed_at
    FROM points_cycles
    WHERE status = 'closed'
    ORDER BY closed_at DESC NULLS LAST, ends_at DESC
    LIMIT 1
  `);
  return hydrateCycleWindow(rows[0], 'previous');
}

export async function readCycleWindowForScope(db, scope = 'current') {
  if (scope === 'previous') return readPreviousCycleWindow(db);
  if (scope === 'current') return readActiveCycleWindow(db);
  return null;
}

export function scoringStartIsoForWindow(window) {
  return window?.scoringStartIso || (window ? tournamentScoringStartsAt(window) : null);
}
