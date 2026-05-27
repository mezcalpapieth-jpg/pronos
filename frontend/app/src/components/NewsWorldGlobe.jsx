import React, { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import { feature } from 'topojson-client';
import countriesTopology from 'world-atlas/countries-110m.json';

const COUNTRY_ID_BY_CODE = {
  AR: '032',
  BO: '068',
  BR: '076',
  CA: '124',
  CL: '152',
  CN: '156',
  CO: '170',
  DE: '276',
  EC: '218',
  ES: '724',
  FR: '250',
  GB: '826',
  HU: '348',
  IL: '376',
  IN: '356',
  IR: '364',
  IT: '380',
  JP: '392',
  MX: '484',
  NL: '528',
  PE: '604',
  PT: '620',
  PY: '600',
  US: '840',
  UA: '804',
  UY: '858',
  VE: '862',
};

const COUNTRIES = feature(
  countriesTopology,
  countriesTopology.objects.countries,
).features;

function clampNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointColor(point) {
  if (point.active) return 'rgba(255,255,255,0.96)';
  return point.render === 'country-fill'
    ? 'rgba(255,85,0,0.92)'
    : 'rgba(0,232,122,0.96)';
}

function buildPoint(location, selectedLocationId) {
  const count = Math.max(1, Number(location.count) || 1);
  return {
    ...location,
    lat: clampNumber(location.lat, 0),
    lng: clampNumber(location.lng, 0),
    count,
    active: selectedLocationId === location.id,
    radius: location.render === 'country-fill'
      ? Math.max(0.26, Math.min(0.62, 0.22 + count * 0.08))
      : Math.max(0.11, Math.min(0.22, 0.09 + count * 0.025)),
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function signalLabel(point) {
  const newsCount = Math.max(0, Number(point.newsCount) || 0);
  const marketCount = Math.max(0, Number(point.marketCount) || 0);
  const parts = [];
  if (newsCount) parts.push(plural(newsCount, 'noticia', 'noticias'));
  if (marketCount) parts.push(plural(marketCount, 'mercado', 'mercados'));
  if (parts.length === 0) {
    const count = Math.max(1, Number(point.count) || 1);
    parts.push(plural(count, 'señal', 'señales'));
  }
  return `<b>${escapeHtml(point.name)}</b><br/>${parts.join(' · ')}`;
}

export default function NewsWorldGlobe({
  region,
  locations = [],
  selectedLocationId,
  onSelectLocation,
  fallback = null,
}) {
  const wrapperRef = useRef(null);
  const globeRef = useRef(null);
  const [size, setSize] = useState(520);
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return undefined;
    const sync = () => {
      const bounds = element.getBoundingClientRect();
      const next = Math.max(320, Math.min(620, Math.floor(Math.min(bounds.width, bounds.height || bounds.width))));
      setSize(next);
    };
    sync();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync);
      return () => window.removeEventListener('resize', sync);
    }
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pointsData = useMemo(() => (
    (locations || []).map(location => buildPoint(location, selectedLocationId))
  ), [locations, selectedLocationId]);

  const activeCountryIds = useMemo(() => {
    const ids = new Set();
    for (const location of locations || []) {
      const id = COUNTRY_ID_BY_CODE[String(location.country || '').toUpperCase()];
      if (id) ids.add(id);
    }
    return ids;
  }, [locations]);

  const locationByCountryId = useMemo(() => {
    const byId = new Map();
    for (const location of locations || []) {
      const id = COUNTRY_ID_BY_CODE[String(location.country || '').toUpperCase()];
      if (!id) continue;
      const previous = byId.get(id);
      const currentScore = Number(location.count) || 0;
      const previousScore = Number(previous?.count) || 0;
      if (
        !previous
        || currentScore > previousScore
        || (currentScore === previousScore && location.granularity === 'country')
      ) {
        byId.set(id, location);
      }
    }
    return byId;
  }, [locations]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    try {
      const controls = globe.controls?.();
      if (controls) {
        controls.autoRotate = false;
        controls.autoRotateSpeed = 0;
        controls.enablePan = false;
        controls.enableZoom = false;
      }
      const center = region?.center || { lat: 18, lng: -35 };
      const altitude = region?.key === 'all' ? 2.35 : 1.35;
      globe.pointOfView?.({ lat: center.lat, lng: center.lng, altitude }, 900);
    } catch {
      setRenderFailed(true);
    }
  }, [region]);

  if (renderFailed) return fallback;

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'relative',
        width: 'min(82vw, 620px)',
        minWidth: 320,
        aspectRatio: '1 / 1',
        borderRadius: '50%',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        background: 'radial-gradient(circle at 50% 50%, rgba(0,232,122,0.16), transparent 42%)',
        boxShadow: '0 0 100px rgba(255,85,0,0.14)',
      }}
    >
      <Globe
        ref={globeRef}
        width={size}
        height={size}
        backgroundColor="rgba(0,0,0,0)"
        showGlobe
        showAtmosphere
        atmosphereColor="#ff5a1f"
        atmosphereAltitude={0.18}
        polygonsData={COUNTRIES}
        polygonGeoJsonGeometry="geometry"
        polygonAltitude={country => activeCountryIds.has(String(country.id)) ? 0.018 : 0.006}
        polygonCapColor={country => activeCountryIds.has(String(country.id))
          ? 'rgba(255,85,0,0.48)'
          : 'rgba(0,232,122,0.10)'}
        polygonSideColor={() => 'rgba(0,232,122,0.035)'}
        polygonStrokeColor={country => activeCountryIds.has(String(country.id))
          ? 'rgba(255,255,255,0.52)'
          : 'rgba(255,255,255,0.12)'}
        onPolygonClick={country => {
          const location = locationByCountryId.get(String(country.id));
          if (!location) return;
          onSelectLocation?.(selectedLocationId === location.id ? null : location.id);
        }}
        pointsData={pointsData}
        pointLat="lat"
        pointLng="lng"
        pointRadius="radius"
        pointAltitude={point => point.active ? 0.08 : 0.045}
        pointColor={pointColor}
        pointResolution={18}
        pointLabel={signalLabel}
        onPointClick={point => onSelectLocation?.(point.active ? null : point.id)}
        ringsData={pointsData}
        ringLat="lat"
        ringLng="lng"
        ringMaxRadius={point => point.render === 'country-fill' ? 8 : 3.6}
        ringPropagationSpeed={1.25}
        ringRepeatPeriod={2600}
        ringColor={point => () => pointColor(point)}
      />
      <div style={{
        position: 'absolute',
        left: 22,
        top: 22,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.14em',
        color: 'var(--orange)',
        textTransform: 'uppercase',
        pointerEvents: 'none',
        textShadow: '0 2px 16px rgba(0,0,0,0.7)',
      }}>
        {region?.label || 'Mapa'}
      </div>
    </div>
  );
}
