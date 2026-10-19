export const SOCIAL_LINKS_CHANGED_EVENT = 'points:social-links-changed';

export function socialTaskProvider(task) {
  const network = String(task?.network || task?.platform || '').trim().toLowerCase();
  return network === 'twitter' ? 'x' : network;
}

export function hasSocialTaskAccount(task) {
  const handle = task?.socialAccount || task?.social_account;
  return typeof handle === 'string' && Boolean(handle.trim().replace(/^@+/, ''));
}

export function notifySocialLinksChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SOCIAL_LINKS_CHANGED_EVENT));
}
