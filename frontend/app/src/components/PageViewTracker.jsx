import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '../lib/analytics.js';

export default function PageViewTracker() {
  const location = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    trackPageView(location.pathname + location.search);
  }, [location]);

  return null;
}
