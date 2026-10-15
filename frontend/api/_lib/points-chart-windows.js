import { marketChartClock } from './points-chart-clock.js';

export function chartWindowsFromRows(rows, windowHours, now = Date.now()) {
  return rows.map(row => {
    const parent = row.parent_id == null ? row : {
      status: row.parent_status, end_time: row.parent_end_time,
      resolved_at: row.parent_resolved_at, created_at: row.parent_created_at,
    };
    const clock = marketChartClock(parent, now);
    const ownClock = marketChartClock(row, now);
    return {
      id: Number(row.id), frozen: clock.frozen,
      start: new Date(clock.endMs - windowHours * 3600000).toISOString(),
      end: new Date(clock.endMs).toISOString(),
      dataEnd: new Date(Math.min(clock.endMs, ownClock.endMs)).toISOString(),
    };
  });
}

export async function loadChartWindows(sql, ids, windowHours) {
  const rows = await sql`
    SELECT m.id, m.parent_id, m.status, m.end_time, m.resolved_at, m.created_at,
           p.status AS parent_status, p.end_time AS parent_end_time,
           p.resolved_at AS parent_resolved_at, p.created_at AS parent_created_at
      FROM points_markets m
      LEFT JOIN points_markets p ON p.id = m.parent_id
     WHERE m.id = ANY(${ids}::int[])
  `;
  const windows = chartWindowsFromRows(rows, windowHours);
  return {
    windows,
    ids: windows.map(row => row.id),
    starts: windows.map(row => row.start),
    ends: windows.map(row => row.dataEnd),
    frozen: windows.length > 0 && windows.every(row => row.frozen),
  };
}
