export function espnEventStatus(status = {}) {
  const type = status?.type || {};
  const name = String(type.name || '').toUpperCase();
  const state = String(type.state || '').toLowerCase();
  const interrupted = /CANCEL|POSTPON|SUSPEND|DELAY|ABANDON|FORFEIT/.test(name);
  const completed = type.completed === true && state !== 'in' && state !== 'pre' && !interrupted;
  return { state, completed, interrupted, name };
}
