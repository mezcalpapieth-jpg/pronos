/**
 * useIsMobile — viewport-width media query hook for inline-styled layouts.
 *
 * Most of our layout responsiveness is handled by CSS media queries in
 * /css/sections.css etc. — but several pages compose layout via inline
 * `style={{...}}` prop with hardcoded grid templates / paddings, and
 * those can't be overridden from CSS without `!important` hacks. This
 * hook lets those components flip the inline values based on viewport.
 *
 * Returns `true` when viewport width < `breakpoint`. Default is 768
 * (matches our CSS @media (max-width: 768px) block).
 *
 * Live-updates on resize / orientation change.
 */
import { useEffect, useState } from 'react';

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e) => setIsMobile(e.matches);
    // addEventListener is the modern API; older Safari needs addListener.
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, [breakpoint]);

  return isMobile;
}
