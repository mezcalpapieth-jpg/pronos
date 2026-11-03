// Preserve auth and risk cookies when either is issued or rotated in one response.
export function appendResponseCookie(res, cookie) {
  const previous = res.getHeader?.('Set-Cookie') ?? res.headers?.['Set-Cookie'];
  const name = cookie.slice(0, cookie.indexOf('='));
  const existing = (Array.isArray(previous) ? previous : previous ? [previous] : [])
    .filter(value => !String(value).startsWith(`${name}=`));
  res.setHeader('Set-Cookie', existing.length ? [...existing, cookie] : cookie);
}
