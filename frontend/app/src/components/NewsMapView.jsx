import React, { Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  extractMarketLocations,
  filterGeoMarkets,
  filterGeoItems,
  getNewsGeoRegions,
  normalizeGeoLocationToCountry,
  summarizeGeoLocations,
} from '../lib/newsGeo.js';

const NewsWorldGlobe = React.lazy(() => import('./NewsWorldGlobe.jsx'));

const WORLD_LANDMASSES = [
  {
    id: 'north-america',
    name: 'Norteamérica',
    points: [
      { lat: 70, lng: -165 }, { lat: 72, lng: -118 }, { lat: 58, lng: -86 },
      { lat: 50, lng: -60 }, { lat: 26, lng: -81 }, { lat: 8, lng: -82 },
      { lat: 16, lng: -99 }, { lat: 28, lng: -115 }, { lat: 52, lng: -132 },
    ],
  },
  {
    id: 'central-america',
    name: 'Centroamérica',
    points: [
      { lat: 24, lng: -112 }, { lat: 24, lng: -97 }, { lat: 15, lng: -88 },
      { lat: 8, lng: -77 }, { lat: 7, lng: -81 }, { lat: 15, lng: -96 },
    ],
  },
  {
    id: 'south-america',
    name: 'Sudamérica',
    points: [
      { lat: 12, lng: -81 }, { lat: 8, lng: -50 }, { lat: -8, lng: -35 },
      { lat: -24, lng: -45 }, { lat: -55, lng: -70 }, { lat: -18, lng: -79 },
    ],
  },
  {
    id: 'europe',
    name: 'Europa',
    points: [
      { lat: 71, lng: -10 }, { lat: 60, lng: 35 }, { lat: 43, lng: 42 },
      { lat: 35, lng: 20 }, { lat: 36, lng: -9 }, { lat: 52, lng: -12 },
    ],
  },
  {
    id: 'africa',
    name: 'África',
    points: [
      { lat: 35, lng: -17 }, { lat: 32, lng: 35 }, { lat: 8, lng: 51 },
      { lat: -34, lng: 20 }, { lat: -35, lng: 16 }, { lat: -5, lng: -17 },
    ],
  },
  {
    id: 'asia',
    name: 'Asia',
    points: [
      { lat: 72, lng: 40 }, { lat: 66, lng: 135 }, { lat: 50, lng: 158 },
      { lat: 20, lng: 122 }, { lat: 5, lng: 95 }, { lat: 22, lng: 70 },
      { lat: 37, lng: 42 },
    ],
  },
  {
    id: 'australia',
    name: 'Oceanía',
    points: [
      { lat: -10, lng: 113 }, { lat: -18, lng: 153 },
      { lat: -39, lng: 146 }, { lat: -35, lng: 115 },
    ],
  },
];

function projectLocation(location, region, options = {}) {
  const center = region?.center || { lat: 18, lng: -35 };
  const zoom = region?.zoom || 1;
  const rawX = 50 + ((Number(location.lng) - center.lng) * zoom) / 3.6;
  const rawY = 50 - ((Number(location.lat) - center.lat) * zoom) / 1.8;
  if (options.clamp === false) {
    return { x: rawX, y: rawY };
  }
  return {
    x: Math.max(8, Math.min(92, rawX)),
    y: Math.max(8, Math.min(92, rawY)),
  };
}

function marketTitle(market) {
  return market?.question || market?.title || market?.name || 'Mercado';
}

function marketUrl(market) {
  const id = market?.id ?? market?.marketId;
  return id ? `/market?id=${encodeURIComponent(id)}` : '/c/deportes';
}

function polygonPoints(points, region) {
  return points.map(point => {
    const projected = projectLocation(point, region, { clamp: false });
    return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
  }).join(' ');
}

export default function NewsMapView({
  items = [],
  markets = [],
  activeRegion = 'mexico',
  onRegionChange,
  showNewsPanel = true,
}) {
  const regions = getNewsGeoRegions();
  const selectedRegion = regions.find(r => r.key === activeRegion) || regions[0];
  const counts = summarizeGeoLocations(items, markets);
  const [selectedLocationId, setSelectedLocationId] = useState(null);

  const regionItems = useMemo(() => filterGeoItems(items, activeRegion), [items, activeRegion]);
  const locations = useMemo(() => {
    const byId = new Map();
    const addLocation = (location, kind) => {
      if (activeRegion !== 'all' && location.region !== activeRegion) return;
      const previous = byId.get(location.id) || {};
      byId.set(location.id, {
        ...location,
        count: (previous.count || 0) + 1,
        newsCount: (previous.newsCount || 0) + (kind === 'news' ? 1 : 0),
        marketCount: (previous.marketCount || 0) + (kind === 'market' ? 1 : 0),
      });
    };

    for (const item of regionItems) {
      for (const location of item.geoLocations || []) {
        addLocation(normalizeGeoLocationToCountry(location), 'news');
      }
    }

    for (const market of markets || []) {
      for (const location of extractMarketLocations(market)) {
        addLocation(normalizeGeoLocationToCountry(location), 'market');
      }
    }
    return Array.from(byId.values()).sort((a, b) => b.count - a.count);
  }, [regionItems, markets, activeRegion]);
  const selectedLocation = useMemo(() => (
    locations.find(location => location.id === selectedLocationId) || null
  ), [locations, selectedLocationId]);
  const selectedLocationLabel = selectedLocation?.name || null;
  const selectedCountry = selectedLocation?.country || null;
  const locationMatchesSelection = (location) => {
    if (!selectedLocationId) return true;
    if (selectedCountry && location.country === selectedCountry) return true;
    return location.id === selectedLocationId;
  };
  const visibleItems = useMemo(() => {
    if (!selectedLocationId) return regionItems;
    return regionItems.filter(item => (item.geoLocations || []).some(locationMatchesSelection));
  }, [regionItems, selectedLocationId, selectedCountry]);
  const visibleMarkets = useMemo(() => {
    const scoped = filterGeoMarkets(markets, activeRegion);
    const visible = selectedLocationId
      ? scoped.filter(market => extractMarketLocations(market).some(locationMatchesSelection))
      : scoped;
    return visible;
  }, [markets, activeRegion, selectedLocationId, selectedCountry, showNewsPanel]);

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <div style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        {counts.map(region => {
          const active = region.key === activeRegion;
          return (
            <button
              key={region.key}
              type="button"
              onClick={() => {
                setSelectedLocationId(null);
                onRegionChange?.(region.key);
              }}
              className={`filter-btn${active ? ' active' : ''}`}
              style={{ fontSize: 11 }}
            >
              {region.label} · {region.count}
            </button>
          );
        })}
      </div>

      <div style={{
        minHeight: 520,
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'radial-gradient(circle at 50% 18%, rgba(255,85,0,0.16), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.012))',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          placeItems: 'center',
          minHeight: 520,
          padding: 'clamp(18px, 4vw, 44px)',
        }}>
          <NewsGlobe
            region={selectedRegion}
            locations={locations}
            selectedLocationId={selectedLocationId}
            onSelectLocation={setSelectedLocationId}
          />
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: showNewsPanel ? 'repeat(auto-fit, minmax(280px, 1fr))' : 'minmax(0, 1fr)',
        gap: 16,
      }}>
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          minHeight: 260,
          maxHeight: 520,
          overflowY: 'auto',
          background: 'rgba(255,255,255,0.025)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            color: 'var(--orange)',
            textTransform: 'uppercase',
            marginBottom: 14,
          }}>
            {selectedLocationLabel ? <>Mercados de {selectedLocationLabel}</> : 'Mercados'}
          </div>
          {visibleMarkets.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              Sin mercados activos en esta zona.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {visibleMarkets.map(market => (
                <Link
                  key={`${market.surface || 'market'}-${market.id || market.marketId}`}
                  to={marketUrl(market)}
                  style={{
                    display: 'block',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 12,
                    color: 'var(--text-primary)',
                    textDecoration: 'none',
                    background: 'rgba(0,0,0,0.18)',
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 800, lineHeight: 1.2 }}>
                    {marketTitle(market)}
                  </div>
                  <div style={{
                    marginTop: 8,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}>
                    {(market.surface === 'mvp' ? 'MVP' : 'Points')} · {market.category || market.sport || 'mercado'}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {showNewsPanel ? (
          <div style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 16,
            minHeight: 260,
            maxHeight: 520,
            overflowY: 'auto',
            background: 'rgba(255,255,255,0.025)',
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.14em',
              color: 'var(--orange)',
              textTransform: 'uppercase',
              marginBottom: 14,
            }}>
              {selectedLocationLabel ? <>Noticias de {selectedLocationLabel}</> : 'Noticias'}
            </div>
            {visibleItems.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                Sin noticias ubicadas en esta zona.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {visibleItems.map(item => (
                  <a
                    key={item.url || item.title}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'block',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 12,
                      color: 'var(--text-primary)',
                      textDecoration: 'none',
                      background: 'rgba(0,0,0,0.18)',
                    }}
                  >
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 800, lineHeight: 1.2 }}>
                      {item.title}
                    </div>
                    <div style={{
                      marginTop: 8,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}>
                      {item.sourceName || item.source || 'Fuente'}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function NewsGlobe({ region, locations, selectedLocationId, onSelectLocation }) {
  const staticFallback = (
    <StaticNewsGlobe
      region={region}
      locations={locations}
      selectedLocationId={selectedLocationId}
      onSelectLocation={onSelectLocation}
    />
  );
  const loadingFallback = (
    <GlobeLoadingShell region={region} />
  );

  return (
    <Suspense fallback={loadingFallback}>
      <NewsWorldGlobe
        region={region}
        locations={locations}
        selectedLocationId={selectedLocationId}
        onSelectLocation={onSelectLocation}
        fallback={staticFallback}
      />
    </Suspense>
  );
}

function GlobeLoadingShell({ region }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'relative',
        width: 'min(82vw, 620px)',
        minWidth: 320,
        aspectRatio: '1 / 1',
        borderRadius: '50%',
        overflow: 'hidden',
        background: [
          'radial-gradient(circle at 36% 28%, rgba(255,255,255,0.14), transparent 10%)',
          'radial-gradient(circle at 50% 50%, rgba(0,232,122,0.12), transparent 44%)',
          'linear-gradient(135deg, rgba(10,21,28,0.96), rgba(1,4,8,0.98))',
        ].join(', '),
        boxShadow: '0 0 100px rgba(255,85,0,0.12), inset 0 0 70px rgba(0,232,122,0.06)',
      }}
    >
      <div style={{
        position: 'absolute',
        inset: '10%',
        borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.08)',
        borderLeftColor: 'rgba(0,232,122,0.18)',
        borderRightColor: 'rgba(255,85,0,0.18)',
        transform: `rotate(${region?.center?.lng || 0}deg)`,
      }} />
      <div style={{
        position: 'absolute',
        left: 22,
        top: 22,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.14em',
        color: 'var(--orange)',
        textTransform: 'uppercase',
        textShadow: '0 2px 16px rgba(0,0,0,0.7)',
      }}>
        {region?.label || 'Mapa'}
      </div>
    </div>
  );
}

function StaticNewsGlobe({ region, locations, selectedLocationId, onSelectLocation }) {
  return (
    <div style={{
      position: 'relative',
      width: 'min(76vw, 520px)',
      aspectRatio: '1 / 1',
      borderRadius: '50%',
      border: '1px solid rgba(255,85,0,0.32)',
      background: [
        'radial-gradient(circle at 35% 28%, rgba(255,255,255,0.16), transparent 10%)',
        'radial-gradient(circle at 50% 50%, rgba(0,232,122,0.20), transparent 34%)',
        'linear-gradient(135deg, rgba(10,21,28,0.98), rgba(1,4,8,0.98))',
      ].join(', '),
      boxShadow: '0 0 80px rgba(255,85,0,0.12), inset 0 0 64px rgba(0,232,122,0.08)',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        inset: '9%',
        borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.09)',
        borderLeftColor: 'rgba(0,232,122,0.34)',
        borderRightColor: 'rgba(255,85,0,0.28)',
        transform: `rotate(${region?.center?.lng || 0}deg)`,
        transition: 'transform 560ms ease',
      }} />
      <div style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: '72%',
        height: '72%',
        transform: 'translate(-50%, -50%) rotate(-18deg)',
        borderRadius: '50%',
        border: '1px dashed rgba(255,255,255,0.08)',
      }} />
      <WorldLandLayer region={region} />
      <div style={{
        position: 'absolute',
        left: 20,
        top: 20,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.14em',
        color: 'var(--orange)',
        textTransform: 'uppercase',
      }}>
        {region?.label || 'Mapa'}
      </div>
      {locations.map(location => {
        const point = projectLocation(location, region);
        const active = selectedLocationId === location.id;
        const size = location.render === 'country-fill'
          ? Math.max(34, Math.min(90, 34 + location.count * 10))
          : Math.max(10, Math.min(22, 9 + location.count * 2.8));
        return (
          <button
            key={location.id}
            type="button"
            onClick={() => onSelectLocation?.(active ? null : location.id)}
            title={`${location.name} · ${location.count}`}
            style={{
              position: 'absolute',
              left: `${point.x}%`,
              top: `${point.y}%`,
              width: size,
              height: size,
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              border: location.render === 'country-fill'
                ? '1px solid rgba(255,85,0,0.7)'
                : '1px solid rgba(255,255,255,0.72)',
              background: location.render === 'country-fill'
                ? 'rgba(255,85,0,0.20)'
                : 'var(--green)',
              boxShadow: active
                ? '0 0 0 5px rgba(255,255,255,0.10), 0 0 34px currentColor'
                : '0 0 22px currentColor',
              color: location.render === 'country-fill' ? 'var(--orange)' : 'var(--green)',
              cursor: 'pointer',
              padding: 0,
            }}
          />
        );
      })}
    </div>
  );
}

function WorldLandLayer({ region }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: 0.72,
        pointerEvents: 'none',
      }}
    >
      <defs>
        <clipPath id="news-globe-land-clip">
          <circle cx="50" cy="50" r="49.2" />
        </clipPath>
        <linearGradient id="news-globe-land-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(255,85,0,0.24)" />
          <stop offset="52%" stopColor="rgba(0,232,122,0.24)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.12)" />
        </linearGradient>
        <filter id="news-globe-land-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.65" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g clipPath="url(#news-globe-land-clip)">
        {[20, 35, 50, 65, 80].map(x => (
          <path
            key={`meridian-${x}`}
            d={`M ${x} 6 C ${50 + (x - 50) * 0.35} 26 ${50 + (x - 50) * 0.35} 74 ${x} 94`}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="0.35"
          />
        ))}
        {[24, 38, 52, 66, 80].map(y => (
          <path
            key={`parallel-${y}`}
            d={`M 7 ${y} C 30 ${y - 4} 70 ${y - 4} 93 ${y}`}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="0.32"
          />
        ))}
        <g filter="url(#news-globe-land-glow)">
          {WORLD_LANDMASSES.map(land => (
            <polygon
              key={land.id}
              points={polygonPoints(land.points, region)}
              fill="url(#news-globe-land-fill)"
              stroke="rgba(255,255,255,0.30)"
              strokeWidth="0.42"
              strokeLinejoin="round"
            >
              <title>{land.name}</title>
            </polygon>
          ))}
        </g>
      </g>
    </svg>
  );
}
