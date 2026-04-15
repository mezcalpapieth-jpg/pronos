/**
 * FeaturedStrip — sticky horizontal carousel of trending markets.
 * Sits just below the Nav (top: 64px) and stays visible as the user
 * scrolls down through the markets grid.
 */
import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import MARKETS from '../lib/markets.js';
import { fetchApprovedPolymarket } from '../lib/polymarketApproved.js';
import { fetchProtocolMarkets } from '../lib/protocolMarkets.js';
import { isExpired } from '../lib/deadline.js';
import { useLang, localizedTitle } from '../lib/i18n.js';

const CARD_W = 210; // px, including gap

export default function FeaturedStrip() {
  const lang = useLang();
  const navigate = useNavigate();
  const trackRef = useRef(null);
  const [markets, setMarkets] = useState([]);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  // Build featured list from hardcoded + protocol markets
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchApprovedPolymarket().catch(() => []),
      fetchProtocolMarkets().catch(() => []),
    ]).then(([approved, protocolMkts]) => {
      if (cancelled) return;
      const approvedSlugs = new Set((approved || []).map(a => a.slug));
      const local = MARKETS.filter(m => {
        if (!m.trending || isExpired(m)) return false;
        if (m._source === 'polymarket' && m._polyId) return approvedSlugs.has(m.id);
        return true;
      });
      const proto = (protocolMkts || []).filter(m => !isExpired(m)).slice(0, 3);
      setMarkets([...proto, ...local].slice(0, 12));
    });
    return () => { cancelled = true; };
  }, []);

  // Track scroll to update arrow visibility
  function updateArrows() {
    const t = trackRef.current;
    if (!t) return;
    setCanLeft(t.scrollLeft > 10);
    setCanRight(t.scrollLeft < t.scrollWidth - t.clientWidth - 10);
  }

  function scrollBy(dir) {
    const t = trackRef.current;
    if (!t) return;
    t.scrollBy({ left: dir * CARD_W * 2, behavior: 'smooth' });
  }

  if (markets.length === 0) return null;

  return (
    <div className="featured-strip-outer">
      {/* Left arrow */}
      {canLeft && (
        <button className="featured-strip-arrow left" onClick={() => scrollBy(-1)} aria-label="Anterior">
          ‹
        </button>
      )}

      {/* Scrollable track */}
      <div
        ref={trackRef}
        className="featured-strip-track"
        onScroll={updateArrows}
      >
        {markets.map((m) => {
          const title = localizedTitle(m, lang);
          const opts  = Array.isArray(m.options) ? m.options.slice(0, 2) : [];
          return (
            <div
              key={m.id}
              className="featured-strip-card"
              onClick={() => navigate(`/market?id=${m.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && navigate(`/market?id=${m.id}`)}
            >
              {/* Category */}
              <div className="fsc-cat">
                {m.icon && <span>{m.icon} </span>}
                {m.categoryLabel || m.category || ''}
              </div>

              {/* Title */}
              <p className="fsc-title">
                {title.length > 52 ? title.slice(0, 50) + '…' : title}
              </p>

              {/* Options */}
              {opts.length > 0 && (
                <div className="fsc-opts">
                  {opts.map((opt, i) => (
                    <div key={i} className={`fsc-opt ${i === 0 ? 'yes' : 'no'}`}>
                      <span className="fsc-opt-pct">{opt.pct ?? '—'}%</span>
                      <span className="fsc-opt-label">{opt.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right arrow */}
      {canRight && (
        <button className="featured-strip-arrow right" onClick={() => scrollBy(1)} aria-label="Siguiente">
          ›
        </button>
      )}
    </div>
  );
}
