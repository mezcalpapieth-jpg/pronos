const COUNTRY_LABELS_ES = new Map([
  ['mexico', 'México'],
  ['argentina', 'Argentina'],
  ['brazil', 'Brasil'],
  ['brasil', 'Brasil'],
  ['chile', 'Chile'],
  ['colombia', 'Colombia'],
  ['peru', 'Perú'],
  ['uruguay', 'Uruguay'],
  ['paraguay', 'Paraguay'],
  ['bolivia', 'Bolivia'],
  ['ecuador', 'Ecuador'],
  ['venezuela', 'Venezuela'],
  ['panama', 'Panamá'],
  ['costa-rica', 'Costa Rica'],
  ['dominican-republic', 'República Dominicana'],
  ['republica-dominicana', 'República Dominicana'],
  ['puerto-rico', 'Puerto Rico'],
  ['cuba', 'Cuba'],
  ['guatemala', 'Guatemala'],
  ['honduras', 'Honduras'],
  ['el-salvador', 'El Salvador'],
  ['nicaragua', 'Nicaragua'],
  ['spain', 'España'],
]);

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeSlug(value) {
  return stripAccents(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeName(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMaybeJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function countryLabelFromFlag(flagAlt) {
  const key = normalizeSlug(flagAlt);
  return COUNTRY_LABELS_ES.get(key) || null;
}

function countryLabelFromParticipant(participant) {
  if (!participant || typeof participant !== 'object') return null;
  return countryLabelFromFlag(
    participant.country
    || participant.countryName
    || participant.nationality
    || participant.flag
    || participant.flagAlt
    || participant.flag_alt
    || participant.athlete?.flag?.alt
    || participant.athlete?.country?.displayName
  );
}

function sourceParticipants(sourceData) {
  if (!sourceData || typeof sourceData !== 'object') return [];
  for (const key of ['fighters', 'participants', 'competitors', 'athletes']) {
    if (Array.isArray(sourceData[key])) return sourceData[key];
  }
  return [];
}

function participantName(participant) {
  return participant?.name
    || participant?.displayName
    || participant?.fullName
    || participant?.athlete?.displayName
    || participant?.athlete?.fullName
    || '';
}

export function deriveOutcomeCountryLabels(row = {}) {
  const outcomes = parseMaybeJson(row.outcomes, []);
  if (!Array.isArray(outcomes) || outcomes.length === 0) return null;

  const sourceData = parseMaybeJson(row.source_data ?? row.sourceData ?? row.pending_source_data, {});
  const directCountries = Array.isArray(sourceData?.outcomeCountries)
    ? sourceData.outcomeCountries
    : Array.isArray(sourceData?.outcomeCountryLabels)
      ? sourceData.outcomeCountryLabels
      : null;

  if (directCountries?.length === outcomes.length) {
    const labels = directCountries.map(countryLabelFromFlag);
    return labels.some(Boolean) ? labels : null;
  }

  const participants = sourceParticipants(sourceData);
  if (participants.length === 0) return null;

  const participantByName = new Map();
  for (const participant of participants) {
    const name = normalizeName(participantName(participant));
    if (name) participantByName.set(name, participant);
  }

  const labels = outcomes.map((outcome, index) => {
    const byName = participantByName.get(normalizeName(outcome));
    if (byName) return countryLabelFromParticipant(byName);
    if (participants.length === outcomes.length) return countryLabelFromParticipant(participants[index]);
    return null;
  });

  return labels.some(Boolean) ? labels : null;
}
