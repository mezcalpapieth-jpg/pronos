export function shouldRunMinuteInterval({ now = new Date(), intervalMinutes, force = false } = {}) {
  if (force) return true;
  const interval = Number(intervalMinutes);
  if (!Number.isInteger(interval) || interval <= 0 || interval > 60) return false;
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) return false;
  return d.getUTCMinutes() % interval === 0;
}
