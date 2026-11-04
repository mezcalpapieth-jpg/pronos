import { useEffect, useRef, useState } from 'react';
import { cardLiveScoreUrl, cardScoreWindowOpen, compactCardScore, loadCardLiveScore } from './cardLiveScore.js';

export function useCardLiveScore(market) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [result, setResult] = useState(null);
  const configUrl = cardLiveScoreUrl(market.liveScoreConfig);
  const eligible = market.status === 'active' && Boolean(configUrl) && !market.seriesLocked;
  const url = visible && cardScoreWindowOpen(market, now) ? configUrl : null;

  useEffect(() => {
    if (!eligible) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined; }
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting === true), { rootMargin: '100px' });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [eligible]);

  useEffect(() => {
    if (!visible || !eligible) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [visible, eligible]);

  useEffect(() => {
    if (!url) return undefined;
    let canceled = false;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      const score = await loadCardLiveScore(url);
      if (!canceled) setResult({ url, score });
    };
    load();
    const timer = setInterval(load, 30_000);
    document.addEventListener('visibilitychange', load);
    return () => {
      canceled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [url]);

  return { ref, score: url && result?.url === url ? compactCardScore(market, result.score) : null };
}
