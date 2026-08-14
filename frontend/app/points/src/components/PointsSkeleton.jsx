import React from 'react';

export function SkeletonBlock({ className = '', style = {} }) {
  return (
    <div
      aria-hidden="true"
      className={`points-skeleton-block ${className}`.trim()}
      style={style}
    />
  );
}

export function MarketCardSkeleton() {
  return (
    <article className="points-market-card-skeleton" aria-hidden="true">
      <div className="points-market-card-skeleton-top">
        <SkeletonBlock style={{ width: 92, height: 14 }} />
        <SkeletonBlock style={{ width: 52, height: 18, borderRadius: 999 }} />
      </div>
      <SkeletonBlock style={{ width: '84%', height: 24, borderRadius: 8, marginTop: 22 }} />
      <div style={{ display: 'grid', gap: 12, marginTop: 28 }}>
        <SkeletonBlock style={{ width: '100%', height: 52, borderRadius: 12 }} />
        <SkeletonBlock style={{ width: '100%', height: 52, borderRadius: 12 }} />
      </div>
    </article>
  );
}

export function MarketGridSkeleton({ count = 6 }) {
  return (
    <div className="markets-grid" aria-label="Cargando mercados">
      {Array.from({ length: count }, (_, idx) => (
        <MarketCardSkeleton key={idx} />
      ))}
    </div>
  );
}

/**
 * Placeholder for the activity carousel. It sits above the hero, so
 * without it the whole page shifts down by the carousel's height the
 * moment the data lands — the reader loses their place mid-sentence.
 * Matches the real slide's two-column shape and height.
 */
export function ActivityCarouselSkeleton({ isMobile = false }) {
  return (
    <section
      aria-hidden="true"
      style={{
        padding: isMobile ? '24px 16px 8px' : '32px 48px 8px',
        maxWidth: 1280,
        margin: '0 auto',
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <SkeletonBlock style={{ width: 140, height: 11, borderRadius: 4, marginBottom: 8 }} />
        <SkeletonBlock style={{ width: 280, height: isMobile ? 26 : 32, borderRadius: 6 }} />
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1.45fr) minmax(260px,1fr)',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        overflow: 'hidden',
      }}>
        <div style={{ padding: isMobile ? 18 : 24 }}>
          <SkeletonBlock style={{ width: 190, height: 20, borderRadius: 999, marginBottom: 14 }} />
          <SkeletonBlock style={{ width: '88%', height: 22, borderRadius: 6, marginBottom: 18 }} />
          <SkeletonBlock style={{ width: '100%', height: isMobile ? 110 : 148, borderRadius: 10 }} />
          <SkeletonBlock style={{ width: 220, height: 24, borderRadius: 999, marginTop: 14 }} />
        </div>
        <div style={{
          background: 'var(--surface2)',
          padding: isMobile ? 18 : 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <SkeletonBlock style={{ width: '100%', height: 14, borderRadius: 4, marginBottom: 8 }} />
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonBlock key={i} style={{ width: '100%', height: 28, borderRadius: 7 }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 14 }}>
        {Array.from({ length: 5 }, (_, i) => (
          <SkeletonBlock key={i} style={{ width: i === 0 ? 22 : 8, height: 8, borderRadius: 999 }} />
        ))}
      </div>
    </section>
  );
}

export function LeaderboardSkeleton({ rows = 5 }) {
  return (
    <div className="points-skeleton-list" aria-label="Cargando leaderboard">
      {Array.from({ length: rows }, (_, idx) => (
        <div className="points-skeleton-row" key={idx} aria-hidden="true">
          <SkeletonBlock style={{ width: 24, height: 14 }} />
          <SkeletonBlock style={{ flex: 1, minWidth: 0, height: 16, borderRadius: 7 }} />
          <SkeletonBlock style={{ width: 92, height: 16, borderRadius: 7 }} />
        </div>
      ))}
    </div>
  );
}

export function PositionSkeleton({ count = 2 }) {
  return (
    <div className="points-skeleton-list" aria-label="Cargando posiciones">
      {Array.from({ length: count }, (_, idx) => (
        <div className="points-position-skeleton" key={idx} aria-hidden="true">
          <SkeletonBlock style={{ width: '44%', height: 20, borderRadius: 8 }} />
          <div className="points-position-skeleton-grid">
            <SkeletonBlock style={{ height: 16, borderRadius: 7 }} />
            <SkeletonBlock style={{ height: 16, borderRadius: 7 }} />
            <SkeletonBlock style={{ height: 16, borderRadius: 7 }} />
          </div>
          <SkeletonBlock style={{ width: 140, height: 38, borderRadius: 10, marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

export function HistorySkeleton({ count = 4 }) {
  return (
    <div className="points-skeleton-list" aria-label="Cargando historial">
      {Array.from({ length: count }, (_, idx) => (
        <div className="points-history-skeleton" key={idx} aria-hidden="true">
          <SkeletonBlock style={{ width: '58%', height: 18, borderRadius: 8 }} />
          <SkeletonBlock style={{ width: '38%', height: 12, borderRadius: 6 }} />
          <SkeletonBlock style={{ width: '100%', height: 1, borderRadius: 1, opacity: 0.45 }} />
        </div>
      ))}
    </div>
  );
}
