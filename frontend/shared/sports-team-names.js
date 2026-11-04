// Exact provider aliases only: translating every city name could match a
// different club. Keep both sports readers and card ordering consistent.
const TEAM_ALIASES = new Map([['slaviapraha', 'slaviaprague']]);

export function normalizeSportsTeamName(value) {
  const name = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|sc|cf|afc|ac|cd|club)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return TEAM_ALIASES.get(name) || name;
}

export function sportsTeamNamesMatch(a, b) {
  const left = normalizeSportsTeamName(a);
  const right = normalizeSportsTeamName(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}
