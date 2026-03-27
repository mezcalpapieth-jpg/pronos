import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function ScrollToHash() {
  const location = useLocation();

  useEffect(() => {
    const scrollTarget = () => {
      if (location.hash) {
        const target = document.getElementById(location.hash.slice(1));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }

      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    };

    window.requestAnimationFrame(scrollTarget);
  }, [location.pathname, location.hash]);

  return null;
}
