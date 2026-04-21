/**
 * 2026 FIFA World Cup — static fixture + bracket data.
 *
 * Shared by the WC market generator (creates one market per match)
 * and the /c/world-cup frontend page (hero + group grid + bracket).
 *
 * 48 teams, 12 groups (A–L) of 4, hosts Mexico / USA / Canada.
 * Group stage: Jun 11 – Jun 27, 2026. Opening at Azteca, final at
 * MetLife Stadium Jul 19, 2026.
 *
 * Groups and fixtures follow the official FIFA draw held at the
 * Kennedy Center on 2025-12-05 and the schedule FIFA published
 * afterwards. Match dates below are calendar-local; kickoff times
 * vary by match and are left at 18:00 UTC as a single-slot
 * approximation (the UI shows date-only).
 *
 * ISO country codes follow the flagcdn.com convention, so the UI
 * can drop in `https://flagcdn.com/w80/{code}.png` without extra
 * mapping. Non-standard codes: gb-eng / gb-sct (England/Scotland).
 */

// ── Teams ────────────────────────────────────────────────────────────────
export const TEAMS = {
  // Group A
  mx: { code: 'mx',     name: 'México' },
  za: { code: 'za',     name: 'Sudáfrica' },
  kr: { code: 'kr',     name: 'Corea del Sur' },
  cz: { code: 'cz',     name: 'Chequia' },
  // Group B
  ca: { code: 'ca',     name: 'Canadá' },
  ba: { code: 'ba',     name: 'Bosnia y H.' },
  qa: { code: 'qa',     name: 'Catar' },
  ch: { code: 'ch',     name: 'Suiza' },
  // Group C
  br: { code: 'br',     name: 'Brasil' },
  ma: { code: 'ma',     name: 'Marruecos' },
  ht: { code: 'ht',     name: 'Haití' },
  sct: { code: 'gb-sct', name: 'Escocia' },
  // Group D
  us: { code: 'us',     name: 'Estados Unidos' },
  py: { code: 'py',     name: 'Paraguay' },
  au: { code: 'au',     name: 'Australia' },
  tr: { code: 'tr',     name: 'Turquía' },
  // Group E
  de: { code: 'de',     name: 'Alemania' },
  ci: { code: 'ci',     name: 'Costa de Marfil' },
  ec: { code: 'ec',     name: 'Ecuador' },
  cw: { code: 'cw',     name: 'Curazao' },
  // Group F
  nl: { code: 'nl',     name: 'Países Bajos' },
  se: { code: 'se',     name: 'Suecia' },
  tn: { code: 'tn',     name: 'Túnez' },
  jp: { code: 'jp',     name: 'Japón' },
  // Group G
  be: { code: 'be',     name: 'Bélgica' },
  eg: { code: 'eg',     name: 'Egipto' },
  ir: { code: 'ir',     name: 'Irán' },
  nz: { code: 'nz',     name: 'Nueva Zelanda' },
  // Group H
  es: { code: 'es',     name: 'España' },
  cv: { code: 'cv',     name: 'Cabo Verde' },
  sa: { code: 'sa',     name: 'Arabia Saudí' },
  uy: { code: 'uy',     name: 'Uruguay' },
  // Group I
  fr: { code: 'fr',     name: 'Francia' },
  sn: { code: 'sn',     name: 'Senegal' },
  iq: { code: 'iq',     name: 'Irak' },
  no: { code: 'no',     name: 'Noruega' },
  // Group J
  ar: { code: 'ar',     name: 'Argentina' },
  dz: { code: 'dz',     name: 'Argelia' },
  at: { code: 'at',     name: 'Austria' },
  jo: { code: 'jo',     name: 'Jordania' },
  // Group K
  pt: { code: 'pt',     name: 'Portugal' },
  cd: { code: 'cd',     name: 'RD Congo' },
  uz: { code: 'uz',     name: 'Uzbekistán' },
  co: { code: 'co',     name: 'Colombia' },
  // Group L
  eng: { code: 'gb-eng', name: 'Inglaterra' },
  hr: { code: 'hr',     name: 'Croacia' },
  gh: { code: 'gh',     name: 'Ghana' },
  pa: { code: 'pa',     name: 'Panamá' },
};

// ── Groups (12 × 4) — official draw, 2025-12-05 ─────────────────────────
export const GROUPS = [
  { key: 'A', teams: ['mx', 'za', 'kr', 'cz'] },
  { key: 'B', teams: ['ca', 'ba', 'qa', 'ch'] },
  { key: 'C', teams: ['br', 'ma', 'ht', 'sct'] },
  { key: 'D', teams: ['us', 'py', 'au', 'tr'] },
  { key: 'E', teams: ['de', 'ci', 'ec', 'cw'] },
  { key: 'F', teams: ['nl', 'se', 'tn', 'jp'] },
  { key: 'G', teams: ['be', 'eg', 'ir', 'nz'] },
  { key: 'H', teams: ['es', 'cv', 'sa', 'uy'] },
  { key: 'I', teams: ['fr', 'sn', 'iq', 'no'] },
  { key: 'J', teams: ['ar', 'dz', 'at', 'jo'] },
  { key: 'K', teams: ['pt', 'cd', 'uz', 'co'] },
  { key: 'L', teams: ['eng', 'hr', 'gh', 'pa'] },
];

export function teamsInGroup(groupKey) {
  const g = GROUPS.find(x => x.key === groupKey);
  return g ? g.teams.map(code => TEAMS[code]).filter(Boolean) : [];
}

// ── Group-stage fixtures — published FIFA schedule ───────────────────────
// 72 matches, 6 per group. Each entry: { matchId, group, matchday,
// homeCode, awayCode, kickoffIso, venue }.
// matchId is stable per match so generator re-runs are idempotent.
function mk(group, md, idx, home, away, date, venue) {
  return {
    matchId: `wc26-${group}-MD${md}-${idx}`,
    group,
    round: 'group',
    matchday: `MD${md}`,
    homeCode: home,
    awayCode: away,
    kickoffIso: `${date}T18:00:00Z`,
    venue,
  };
}

export const GROUP_FIXTURES = [
  // Group A
  mk('A', 1, 1, 'mx',  'za',  '2026-06-11', 'Ciudad de México'),
  mk('A', 1, 2, 'kr',  'cz',  '2026-06-11', 'Zapopan'),
  mk('A', 2, 1, 'cz',  'za',  '2026-06-18', 'Atlanta'),
  mk('A', 2, 2, 'mx',  'kr',  '2026-06-18', 'Zapopan'),
  mk('A', 3, 1, 'cz',  'mx',  '2026-06-24', 'Ciudad de México'),
  mk('A', 3, 2, 'za',  'kr',  '2026-06-24', 'Guadalupe'),
  // Group B
  mk('B', 1, 1, 'ca',  'ba',  '2026-06-12', 'Toronto'),
  mk('B', 1, 2, 'qa',  'ch',  '2026-06-13', 'Santa Clara'),
  mk('B', 2, 1, 'ch',  'ba',  '2026-06-18', 'Inglewood'),
  mk('B', 2, 2, 'ca',  'qa',  '2026-06-18', 'Vancouver'),
  mk('B', 3, 1, 'ch',  'ca',  '2026-06-24', 'Vancouver'),
  mk('B', 3, 2, 'ba',  'qa',  '2026-06-24', 'Seattle'),
  // Group C
  mk('C', 1, 1, 'br',  'ma',  '2026-06-13', 'East Rutherford'),
  mk('C', 1, 2, 'ht',  'sct', '2026-06-13', 'Foxborough'),
  mk('C', 2, 1, 'sct', 'ma',  '2026-06-19', 'Foxborough'),
  mk('C', 2, 2, 'br',  'ht',  '2026-06-19', 'Philadelphia'),
  mk('C', 3, 1, 'sct', 'br',  '2026-06-24', 'Miami Gardens'),
  mk('C', 3, 2, 'ma',  'ht',  '2026-06-24', 'Atlanta'),
  // Group D
  mk('D', 1, 1, 'us',  'py',  '2026-06-12', 'Inglewood'),
  mk('D', 1, 2, 'au',  'tr',  '2026-06-13', 'Vancouver'),
  mk('D', 2, 1, 'us',  'au',  '2026-06-19', 'Seattle'),
  mk('D', 2, 2, 'tr',  'py',  '2026-06-19', 'Santa Clara'),
  mk('D', 3, 1, 'tr',  'us',  '2026-06-25', 'Inglewood'),
  mk('D', 3, 2, 'py',  'au',  '2026-06-25', 'Santa Clara'),
  // Group E
  mk('E', 1, 1, 'de',  'cw',  '2026-06-14', 'Houston'),
  mk('E', 1, 2, 'ci',  'ec',  '2026-06-14', 'Philadelphia'),
  mk('E', 2, 1, 'de',  'ci',  '2026-06-20', 'Toronto'),
  mk('E', 2, 2, 'ec',  'cw',  '2026-06-20', 'Kansas City'),
  mk('E', 3, 1, 'ec',  'de',  '2026-06-25', 'East Rutherford'),
  mk('E', 3, 2, 'cw',  'ci',  '2026-06-25', 'Philadelphia'),
  // Group F
  mk('F', 1, 1, 'nl',  'jp',  '2026-06-14', 'Arlington'),
  mk('F', 1, 2, 'se',  'tn',  '2026-06-14', 'Guadalupe'),
  mk('F', 2, 1, 'nl',  'se',  '2026-06-20', 'Houston'),
  mk('F', 2, 2, 'tn',  'jp',  '2026-06-20', 'Guadalupe'),
  mk('F', 3, 1, 'jp',  'se',  '2026-06-25', 'Arlington'),
  mk('F', 3, 2, 'tn',  'nl',  '2026-06-25', 'Kansas City'),
  // Group G
  mk('G', 1, 1, 'be',  'eg',  '2026-06-15', 'Seattle'),
  mk('G', 1, 2, 'ir',  'nz',  '2026-06-15', 'Inglewood'),
  mk('G', 2, 1, 'be',  'ir',  '2026-06-21', 'Inglewood'),
  mk('G', 2, 2, 'nz',  'eg',  '2026-06-21', 'Vancouver'),
  mk('G', 3, 1, 'eg',  'ir',  '2026-06-26', 'Seattle'),
  mk('G', 3, 2, 'nz',  'be',  '2026-06-26', 'Vancouver'),
  // Group H
  mk('H', 1, 1, 'es',  'cv',  '2026-06-15', 'Atlanta'),
  mk('H', 1, 2, 'sa',  'uy',  '2026-06-15', 'Miami Gardens'),
  mk('H', 2, 1, 'es',  'sa',  '2026-06-21', 'Atlanta'),
  mk('H', 2, 2, 'uy',  'cv',  '2026-06-21', 'Miami Gardens'),
  mk('H', 3, 1, 'cv',  'sa',  '2026-06-26', 'Houston'),
  mk('H', 3, 2, 'uy',  'es',  '2026-06-26', 'Guadalupe'),
  // Group I
  mk('I', 1, 1, 'fr',  'sn',  '2026-06-16', 'East Rutherford'),
  mk('I', 1, 2, 'iq',  'no',  '2026-06-16', 'Foxborough'),
  mk('I', 2, 1, 'fr',  'iq',  '2026-06-22', 'Philadelphia'),
  mk('I', 2, 2, 'no',  'sn',  '2026-06-22', 'East Rutherford'),
  mk('I', 3, 1, 'no',  'fr',  '2026-06-26', 'Foxborough'),
  mk('I', 3, 2, 'sn',  'iq',  '2026-06-26', 'Toronto'),
  // Group J
  mk('J', 1, 1, 'ar',  'dz',  '2026-06-16', 'Kansas City'),
  mk('J', 1, 2, 'at',  'jo',  '2026-06-16', 'Santa Clara'),
  mk('J', 2, 1, 'ar',  'at',  '2026-06-22', 'Arlington'),
  mk('J', 2, 2, 'jo',  'dz',  '2026-06-22', 'Santa Clara'),
  mk('J', 3, 1, 'dz',  'at',  '2026-06-27', 'Kansas City'),
  mk('J', 3, 2, 'jo',  'ar',  '2026-06-27', 'Arlington'),
  // Group K
  mk('K', 1, 1, 'pt',  'cd',  '2026-06-17', 'Houston'),
  mk('K', 1, 2, 'uz',  'co',  '2026-06-17', 'Ciudad de México'),
  mk('K', 2, 1, 'pt',  'uz',  '2026-06-23', 'Houston'),
  mk('K', 2, 2, 'co',  'cd',  '2026-06-23', 'Zapopan'),
  mk('K', 3, 1, 'co',  'pt',  '2026-06-27', 'Miami Gardens'),
  mk('K', 3, 2, 'cd',  'uz',  '2026-06-27', 'Atlanta'),
  // Group L
  mk('L', 1, 1, 'eng', 'hr',  '2026-06-17', 'Arlington'),
  mk('L', 1, 2, 'gh',  'pa',  '2026-06-17', 'Toronto'),
  mk('L', 2, 1, 'eng', 'gh',  '2026-06-23', 'Foxborough'),
  mk('L', 2, 2, 'pa',  'hr',  '2026-06-23', 'Toronto'),
  mk('L', 3, 1, 'pa',  'eng', '2026-06-27', 'East Rutherford'),
  mk('L', 3, 2, 'hr',  'gh',  '2026-06-27', 'Philadelphia'),
];

// ── Bracket structure (teams TBD until groups finish) ───────────────────
// 48-team format: top 2 of each group + 8 best 3rd-place → 32.
// Slots are placeholders like "1A" (winner A), "2B" (runner-up B),
// "3C/E/F/H" (best 3rd from this pool). Real fixture generation for
// knockout markets happens once groups are decided — out of scope here.
export const BRACKET = {
  r32: [
    { id: 'R32-1',  home: '1A', away: '3C/E/F/H', date: '2026-06-28' },
    { id: 'R32-2',  home: '1B', away: '3A/D/E/F', date: '2026-06-28' },
    { id: 'R32-3',  home: '1C', away: '3D/E/F/G', date: '2026-06-28' },
    { id: 'R32-4',  home: '1D', away: '3B/E/F/H', date: '2026-06-29' },
    { id: 'R32-5',  home: '1E', away: '2F',       date: '2026-06-29' },
    { id: 'R32-6',  home: '1F', away: '2E',       date: '2026-06-29' },
    { id: 'R32-7',  home: '1G', away: '3H/I/J/L', date: '2026-06-30' },
    { id: 'R32-8',  home: '1H', away: '3A/B/F/I', date: '2026-06-30' },
    { id: 'R32-9',  home: '1I', away: '3B/E/H/I', date: '2026-07-01' },
    { id: 'R32-10', home: '1J', away: '3A/G/H/I', date: '2026-07-01' },
    { id: 'R32-11', home: '1K', away: '2L',       date: '2026-07-02' },
    { id: 'R32-12', home: '1L', away: '2K',       date: '2026-07-02' },
    { id: 'R32-13', home: '2A', away: '2C',       date: '2026-07-02' },
    { id: 'R32-14', home: '2B', away: '2D',       date: '2026-07-03' },
    { id: 'R32-15', home: '2G', away: '2I',       date: '2026-07-03' },
    { id: 'R32-16', home: '2H', away: '2J',       date: '2026-07-03' },
  ],
  r16: Array.from({ length: 8 }, (_, i) => ({
    id: `R16-${i + 1}`,
    home: `W-R32-${2 * i + 1}`,
    away: `W-R32-${2 * i + 2}`,
    date: i < 4 ? '2026-07-04' : '2026-07-05',
  })),
  qf: Array.from({ length: 4 }, (_, i) => ({
    id: `QF-${i + 1}`,
    home: `W-R16-${2 * i + 1}`,
    away: `W-R16-${2 * i + 2}`,
    date: i < 2 ? '2026-07-09' : '2026-07-10',
  })),
  sf: [
    { id: 'SF-1', home: 'W-QF-1', away: 'W-QF-2', date: '2026-07-14' },
    { id: 'SF-2', home: 'W-QF-3', away: 'W-QF-4', date: '2026-07-15' },
  ],
  third: { id: 'THIRD', home: 'L-SF-1', away: 'L-SF-2', date: '2026-07-18' },
  final: { id: 'FINAL', home: 'W-SF-1', away: 'W-SF-2', date: '2026-07-19' },
};

export const OPENING_KICKOFF_ISO = '2026-06-11T18:00:00Z';
