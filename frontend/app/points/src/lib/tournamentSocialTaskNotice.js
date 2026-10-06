const STORAGE_KEY = 'points:tournament-social-task-seen:v1';
export const TOURNAMENT_SOCIAL_TASK_SEEN_EVENT = 'points:tournament-social-task-seen';

export function tournamentSocialTaskNoticeId(task) {
  const id = task?.key || task?.taskKey || task?.id;
  return id == null ? null : String(id);
}

export function readTournamentSocialTaskSeenIds() {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(value => String(value)).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function isTournamentSocialTaskSeen(task) {
  const id = tournamentSocialTaskNoticeId(task);
  return Boolean(id && readTournamentSocialTaskSeenIds().has(id));
}

export function markTournamentSocialTaskSeen(task) {
  const id = tournamentSocialTaskNoticeId(task);
  if (!id || typeof window === 'undefined') return false;
  const seen = readTournamentSocialTaskSeenIds();
  const alreadySeen = seen.has(id);
  seen.add(id);
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // Non-critical: the current tab still receives the acknowledgement event.
  }
  try {
    window.dispatchEvent(new CustomEvent(TOURNAMENT_SOCIAL_TASK_SEEN_EVENT, {
      detail: { id, alreadySeen },
    }));
  } catch {
    // Older embedded browsers can ignore the live notification refresh.
  }
  return true;
}

export function onTournamentSocialTaskSeen(handler) {
  if (typeof window === 'undefined' || typeof handler !== 'function') {
    return () => {};
  }
  const listener = event => handler(event?.detail || {});
  window.addEventListener(TOURNAMENT_SOCIAL_TASK_SEEN_EVENT, listener);
  return () => window.removeEventListener(TOURNAMENT_SOCIAL_TASK_SEEN_EVENT, listener);
}
