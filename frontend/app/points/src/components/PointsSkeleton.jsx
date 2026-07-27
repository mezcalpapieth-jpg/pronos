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
