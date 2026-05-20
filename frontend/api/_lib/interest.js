export const INTEREST_WINDOWS = [
  { key: 'day', label: 'Hoy' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'lifetime', label: 'Vida' },
];

const ALLOWED_SURFACES = new Set(['mvp', 'points']);
const ALLOWED_OBJECT_TYPES = new Set(['team', 'points_market', 'protocol_market']);
const ALLOWED_ACTIONS = new Set(['click', 'view']);
const METADATA_FIELDS = new Set([
  'label',
  'question',
  'sport',
  'league',
  'country',
  'category',
  'status',
  'source',
]);

function cleanToken(value, { max = 80 } = {}) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : '';
}

export function sanitizeInterestMetadata(metadata = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (!METADATA_FIELDS.has(key)) continue;
    const text = cleanToken(value, { max: key === 'question' ? 180 : 80 });
    if (text) clean[key] = text;
  }
  return clean;
}

export function normalizeInterestPayload(input = {}) {
  const surface = cleanToken(input.surface, { max: 24 }).toLowerCase();
  if (!ALLOWED_SURFACES.has(surface)) throw new Error('invalid_surface');

  const objectType = cleanToken(input.objectType, { max: 40 }).toLowerCase();
  if (!ALLOWED_OBJECT_TYPES.has(objectType)) throw new Error('invalid_object_type');

  const objectId = cleanToken(input.objectId, { max: 120 });
  if (!objectId) throw new Error('invalid_object_id');

  const action = cleanToken(input.action || 'click', { max: 24 }).toLowerCase();
  if (!ALLOWED_ACTIONS.has(action)) throw new Error('invalid_action');

  return {
    surface,
    objectType,
    objectId,
    action,
    metadata: sanitizeInterestMetadata(input.metadata || {}),
  };
}

export function formatInterestRow(row = {}) {
  const series = Array.isArray(row.series) ? row.series : [];
  return {
    surface: row.surface,
    objectType: row.object_type,
    objectId: row.object_id,
    label: row.label || row.question || row.object_id,
    question: row.question || null,
    sport: row.sport || null,
    league: row.league || null,
    category: row.category || null,
    status: row.status || null,
    counts: {
      day: Number(row.day_count || 0),
      week: Number(row.week_count || 0),
      month: Number(row.month_count || 0),
      lifetime: Number(row.lifetime_count || 0),
    },
    uniques: {
      day: Number(row.day_unique || 0),
      week: Number(row.week_unique || 0),
      month: Number(row.month_unique || 0),
      lifetime: Number(row.lifetime_unique || 0),
    },
    series: series.map(point => ({
      day: point.day,
      count: Number(point.count || 0),
      unique: Number(point.unique || 0),
    })),
    lastSeenAt: row.last_seen_at || null,
  };
}
