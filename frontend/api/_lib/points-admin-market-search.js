// Match the same combining-mark range in the SQL predicates after NFD.
export const ADMIN_SEARCH_MARKS = '[\u0300-\u036f]';

export function parseAdminMarketSearch(value) {
  const query = typeof value === 'string' ? value.trim().slice(0, 120) : '';
  const exactId = /^#(\d+)$/.exec(query);
  if (exactId) {
    const id = Number(exactId[1]);
    if (id > 0 && id <= 2147483647) return { id, text: null };
  }
  const text = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return { id: null, text: text || null };
}
