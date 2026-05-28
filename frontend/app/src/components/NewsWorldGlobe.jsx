import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber';
import ThreeGlobe from 'three-globe';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import countriesTopology from 'world-atlas/countries-110m.json';

extend({ OrbitControls });

const COUNTRY_ID_BY_CODE = {
  AR: '032',
  BO: '068',
  BR: '076',
  BZ: '084',
  CA: '124',
  CL: '152',
  CN: '156',
  CO: '170',
  CR: '188',
  DE: '276',
  EC: '218',
  ES: '724',
  FR: '250',
  GB: '826',
  GT: '320',
  HN: '340',
  HU: '348',
  IL: '376',
  IN: '356',
  IR: '364',
  IT: '380',
  JP: '392',
  MX: '484',
  NL: '528',
  NI: '558',
  PA: '591',
  PE: '604',
  PT: '620',
  PY: '600',
  SV: '222',
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

function globeCoordsToVector3(lat, lng, altitude = 0) {
  const phi = THREE.MathUtils.degToRad(90 - clampNumber(lat, 0));
  const theta = THREE.MathUtils.degToRad(90 - clampNumber(lng, 0));
  const r = 100 * (1 + altitude);
  return new THREE.Vector3(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

function vector3ToGlobeCoords(point) {
  const normalized = point.clone().normalize();
  const lat = 90 - THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, normalized.y))));
  const theta = Math.atan2(normalized.z, normalized.x);
  const rawLng = 90 - THREE.MathUtils.radToDeg(theta);
  const lng = ((rawLng + 540) % 360) - 180;
  return { lat, lng };
}

function cameraPositionForRegion(region) {
  const center = region?.center || { lat: 18, lng: -35 };
  const defaultAltitude = region?.key === 'all' ? 2.15 : 1.28;
  const altitude = region?.globeAltitude ?? defaultAltitude;
  return globeCoordsToVector3(center.lat, center.lng, altitude);
}

function GlobeCamera({ region }) {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.copy(cameraPositionForRegion(region));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, region]);

  return null;
}

function GlobeControls() {
  const controlsRef = useRef(null);
  const { camera, gl } = useThree();

  useFrame(() => {
    controlsRef.current?.update();
  });

  return (
    <orbitControls
      ref={controlsRef}
      args={[camera, gl.domElement]}
      enableZoom={false}
      enablePan={false}
      autoRotate={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.42}
    />
  );
}

function findObjectData(object) {
  let current = object;
  while (current) {
    if (current.__data) return current.__data;
    if (current.__currentTargetD) return current.__currentTargetD;
    current = current.parent;
  }
  return null;
}

function findLocationForGlobeObject(object, locationByCountryId, pointsData) {
  const data = findObjectData(object);
  if (!data) return null;

  const countryId = data?.data?.id ?? data?.id;
  const countryLocation = countryId ? locationByCountryId.get(String(countryId)) : null;
  if (countryLocation) return countryLocation;

  const pointId = data?.id;
  if (pointId) return pointsData.find(point => point.id === pointId) || null;

  return null;
}

function findCountryLocationForPoint(point, locationByCountryId) {
  const coords = vector3ToGlobeCoords(point);
  for (const country of COUNTRIES) {
    const location = locationByCountryId.get(String(country.id));
    if (location && geoContains(country, [coords.lng, coords.lat])) return location;
  }
  return null;
}

function findLocationAtPointer({
  event,
  element,
  camera,
  raycaster,
  pointer,
  globe,
  locationByCountryId,
  pointsData,
}) {
  if (!globe) return null;
  const rect = element.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObject(globe, true);
  const nearestDistance = hits[0]?.distance;
  for (const hit of hits) {
    if (hit.distance > nearestDistance + 32) break;
    const location = (
      findLocationForGlobeObject(hit.object, locationByCountryId, pointsData)
      || findCountryLocationForPoint(hit.point, locationByCountryId)
    );
    if (location) return location;
  }
  return null;
}

function clampHoverPosition(event, container, options = {}) {
  const rect = container.getBoundingClientRect();
  const cardWidth = options.cardWidth || 240;
  const cardHeight = options.cardHeight || 126;
  const gap = 12;
  const margin = 12;
  const rawX = event.clientX - rect.left + gap;
  const rawY = event.clientY - rect.top - cardHeight - gap;
  return {
    x: Math.max(margin, Math.min(rawX, rect.width - cardWidth - margin)),
    y: Math.max(margin, Math.min(rawY, rect.height - cardHeight - margin)),
  };
}

function GlobeObject({
  pointsData,
  activeCountryIds,
  selectedCountryId,
  globeRef,
  onRenderError,
}) {
  const globe = useMemo(() => new ThreeGlobe({ waitForGlobeReady: true, animateIn: false }), []);
  const pinPointsData = useMemo(
    () => pointsData.filter(point => point.render !== 'country-fill'),
    [pointsData],
  );
  const globeMaterial = useMemo(() => new THREE.MeshPhongMaterial({
    color: '#07120f',
    emissive: '#02100b',
    shininess: 5,
    transparent: true,
    opacity: 0.94,
  }), []);

  useEffect(() => {
    globeRef.current = globe;
    return () => {
      if (globeRef.current === globe) globeRef.current = null;
    };
  }, [globe, globeRef]);

  useEffect(() => {
    try {
      globe
        .showGlobe(true)
        .showAtmosphere(true)
        .atmosphereColor('#ff5a1f')
        .atmosphereAltitude(0.18)
        .globeMaterial(globeMaterial);
    } catch {
      onRenderError?.();
    }
  }, [globe, globeMaterial, onRenderError]);

  useEffect(() => {
    const isSelectedCountry = country => selectedCountryId === String(country.id);
    const isActiveCountry = country => activeCountryIds.has(String(country.id));
    try {
      globe
        .polygonsData(COUNTRIES)
        .polygonGeoJsonGeometry('geometry')
        .polygonAltitude(country => (isSelectedCountry(country) ? 0.04 : isActiveCountry(country) ? 0.018 : 0.006))
        .polygonCapColor(country => (isSelectedCountry(country)
          ? 'rgba(120,18,18,0.9)'
          : isActiveCountry(country)
            ? 'rgba(255,85,0,0.48)'
            : 'rgba(0,232,122,0.10)'))
        .polygonSideColor(country => (isSelectedCountry(country)
          ? 'rgba(255,85,0,0.32)'
          : 'rgba(0,232,122,0.035)'))
        .polygonStrokeColor(country => (isSelectedCountry(country)
          ? 'rgba(255,85,0,0.95)'
          : isActiveCountry(country)
            ? 'rgba(255,255,255,0.52)'
            : 'rgba(255,255,255,0.12)'))
        .polygonsTransitionDuration(500)
        .pointsData(pinPointsData)
        .pointLat('lat')
        .pointLng('lng')
        .pointRadius('radius')
        .pointAltitude(point => point.active ? 0.08 : 0.045)
        .pointColor(pointColor)
        .pointResolution(18)
        .pointsTransitionDuration(450)
        .ringsData(pinPointsData)
        .ringLat('lat')
        .ringLng('lng')
        .ringMaxRadius(() => 3.6)
        .ringPropagationSpeed(1.25)
        .ringRepeatPeriod(2600)
        .ringColor(point => pointColor(point));
    } catch {
      onRenderError?.();
    }
  }, [activeCountryIds, globe, onRenderError, pinPointsData, selectedCountryId]);

  useEffect(() => () => {
    globe._destructor?.();
    globeMaterial.dispose();
  }, [globe, globeMaterial]);

  return <primitive object={globe} />;
}

function GlobePointerSelector({
  globeRef,
  pointsData,
  locationByCountryId,
  selectedLocationId,
  onSelectLocation,
  onHoverLocation,
  onGlobeInteraction,
}) {
  const { camera, gl } = useThree();
  const pointerDownRef = useRef(null);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useEffect(() => {
    const element = gl.domElement;
    element.style.cursor = 'grab';
    const getLocation = event => findLocationAtPointer({
      event,
      element,
      camera,
      raycaster,
      pointer,
      globe: globeRef.current,
      locationByCountryId,
      pointsData,
    });
    const handlePointerDown = event => {
      pointerDownRef.current = { x: event.clientX, y: event.clientY };
      onHoverLocation?.(null);
      onGlobeInteraction?.();
      element.style.cursor = 'grabbing';
    };
    const handlePointerMove = event => {
      if (pointerDownRef.current) return;
      const location = getLocation(event);
      onHoverLocation?.(location || null, event);
      element.style.cursor = location ? 'pointer' : 'grab';
    };
    const handlePointerUp = event => {
      const pointerDown = pointerDownRef.current;
      pointerDownRef.current = null;
      if (
        pointerDown
        && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 7
      ) {
        element.style.cursor = 'grab';
        return;
      }
      const location = getLocation(event);
      element.style.cursor = location ? 'pointer' : 'grab';
      if (location) {
        event.preventDefault();
        onSelectLocation?.(location.id, event);
      }
    };
    const handlePointerLeave = () => {
      pointerDownRef.current = null;
      onHoverLocation?.(null);
      element.style.cursor = 'grab';
    };

    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', handlePointerUp);
    element.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      element.removeEventListener('pointerleave', handlePointerLeave);
      element.style.cursor = '';
    };
  }, [
    camera,
    gl.domElement,
    globeRef,
    locationByCountryId,
    onHoverLocation,
    onSelectLocation,
    onGlobeInteraction,
    pointer,
    pointsData,
    raycaster,
    selectedLocationId,
  ]);

  return null;
}

function GlobeScene({
  region,
  pointsData,
  activeCountryIds,
  selectedCountryId,
  locationByCountryId,
  selectedLocationId,
  onSelectLocation,
  onHoverLocation,
  onGlobeInteraction,
  onRenderError,
}) {
  const globeRef = useRef(null);

  return (
    <>
      <color attach="background" args={['#000000']} />
      <ambientLight intensity={1.22} />
      <directionalLight position={[180, 160, 240]} intensity={1.5} color="#ffffff" />
      <pointLight position={[-120, -80, 140]} intensity={0.85} color="#ff5a1f" />
      <GlobeCamera region={region} />
      <GlobeControls />
      <GlobeObject
        pointsData={pointsData}
        activeCountryIds={activeCountryIds}
        selectedCountryId={selectedCountryId}
        globeRef={globeRef}
        onRenderError={onRenderError}
      />
      <GlobePointerSelector
        globeRef={globeRef}
        pointsData={pointsData}
        locationByCountryId={locationByCountryId}
        selectedLocationId={selectedLocationId}
        onSelectLocation={onSelectLocation}
        onHoverLocation={onHoverLocation}
        onGlobeInteraction={onGlobeInteraction}
      />
    </>
  );
}

function GlobeHoverCard({ location, signals, position, persistent = false, onHoverHoldChange }) {
  if (!location || signals.length === 0) return null;
  const hasLinks = signals.some(signal => signal.href);

  return (
    <div
      aria-live="polite"
      onPointerDown={event => event.stopPropagation()}
      onPointerEnter={() => onHoverHoldChange?.(true)}
      onPointerLeave={() => onHoverHoldChange?.(false)}
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        width: 'min(240px, calc(100% - 24px))',
        maxHeight: persistent ? 'min(280px, calc(100% - 28px))' : undefined,
        overflow: persistent ? 'hidden' : 'visible',
        border: '1px solid rgba(255,85,0,0.38)',
        borderRadius: 7,
        background: 'linear-gradient(180deg, rgba(32,8,8,0.94), rgba(6,6,6,0.92))',
        boxShadow: '0 14px 44px rgba(0,0,0,0.42)',
        padding: 9,
        pointerEvents: hasLinks ? 'auto' : 'none',
        zIndex: 2,
      }}
    >
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        letterSpacing: '0.14em',
        color: 'var(--orange)',
        textTransform: 'uppercase',
        marginBottom: 6,
      }}>
        {location.name}
      </div>
      <div
        onWheel={persistent ? event => event.stopPropagation() : undefined}
        style={{
          display: 'grid',
          gap: 5,
          maxHeight: persistent ? 112 : undefined,
          overflowY: persistent ? 'auto' : 'visible',
          overscrollBehavior: persistent ? 'contain' : undefined,
          paddingRight: persistent ? 3 : 0,
        }}
      >
        {signals.map(signal => {
          const SignalTag = signal.href ? (signal.kind === 'market' ? Link : 'a') : 'div';
          const signalLinkProps = signal.href
            ? signal.kind === 'market'
              ? { to: signal.href }
              : {
                href: signal.href,
                target: signal.kind === 'news' ? '_blank' : undefined,
                rel: signal.kind === 'news' ? 'noreferrer' : undefined,
              }
            : {};
          return (
            <SignalTag
              key={`${signal.kind}-${signal.id || signal.title}`}
              {...signalLinkProps}
              style={{
                display: 'grid',
                gap: 2,
                minWidth: 0,
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              <div style={{
                fontFamily: 'var(--font-body)',
                fontSize: 10,
                fontWeight: 800,
                lineHeight: 1.15,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {signal.title}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 8,
                letterSpacing: '0.08em',
                color: signal.kind === 'market' ? 'var(--green)' : 'var(--text-muted)',
                textTransform: 'uppercase',
              }}>
                {signal.kind === 'market' ? 'Mercado' : 'Noticia'} · {signal.meta}
              </div>
            </SignalTag>
          );
        })}
      </div>
    </div>
  );
}

export default function NewsWorldGlobe({
  region,
  locations = [],
  selectedLocationId,
  onSelectLocation,
  fallback = null,
}) {
  const wrapperRef = useRef(null);
  const [size, setSize] = useState(520);
  const [renderFailed, setRenderFailed] = useState(false);
  const [hoveredLocationId, setHoveredLocationId] = useState(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 18, y: 18 });
  const [selectedPosition, setSelectedPosition] = useState({ x: 18, y: 18 });
  const [selectedPopupVisible, setSelectedPopupVisible] = useState(false);
  const hoverLocationIdRef = useRef(null);
  const hoverClearTimerRef = useRef(null);
  const hoverCardHoldingRef = useRef(false);

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
    for (const location of pointsData || []) {
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
  }, [pointsData]);

  const selectedLocation = useMemo(() => (
    pointsData.find(location => location.id === selectedLocationId) || null
  ), [pointsData, selectedLocationId]);
  const selectedCountryId = useMemo(() => (
    selectedLocation
      ? COUNTRY_ID_BY_CODE[String(selectedLocation.country || '').toUpperCase()] || null
      : null
  ), [selectedLocation]);
  const hoveredLocation = useMemo(() => (
    pointsData.find(location => location.id === hoveredLocationId) || null
  ), [pointsData, hoveredLocationId]);
  const hoverSignals = (hoveredLocation?.signals || []).slice(0, 3);
  const selectedSignals = selectedLocation?.signals || [];
  const clearHoverTimer = useCallback(() => {
    if (!hoverClearTimerRef.current) return;
    clearTimeout(hoverClearTimerRef.current);
    hoverClearTimerRef.current = null;
  }, []);
  const handleSelectLocation = useCallback((nextId, event) => {
    if (nextId && event && wrapperRef.current) {
      setSelectedPosition(clampHoverPosition(event, wrapperRef.current, { cardHeight: 260 }));
    }
    setSelectedPopupVisible(Boolean(nextId));
    clearHoverTimer();
    hoverLocationIdRef.current = null;
    setHoveredLocationId(null);
    onSelectLocation?.(nextId);
  }, [clearHoverTimer, onSelectLocation]);
  const handleGlobeInteraction = useCallback(() => {
    setSelectedPopupVisible(false);
  }, []);
  const handleHoverHoldChange = useCallback((isHolding) => {
    hoverCardHoldingRef.current = isHolding;
    if (isHolding) {
      clearHoverTimer();
      return;
    }
    if (!hoverLocationIdRef.current || hoverClearTimerRef.current) return;
    hoverClearTimerRef.current = setTimeout(() => {
      hoverLocationIdRef.current = null;
      hoverClearTimerRef.current = null;
      setHoveredLocationId(null);
    }, 120);
  }, [clearHoverTimer]);
  const handleHoverLocation = useCallback((location, event) => {
    const nextId = location?.id || null;
    if (!nextId) {
      if (hoverCardHoldingRef.current) return;
      if (!hoverLocationIdRef.current || hoverClearTimerRef.current) return;
      hoverClearTimerRef.current = setTimeout(() => {
        hoverLocationIdRef.current = null;
        hoverClearTimerRef.current = null;
        setHoveredLocationId(null);
      }, 120);
      return;
    }
    clearHoverTimer();
    if (hoverLocationIdRef.current === nextId) return;
    hoverLocationIdRef.current = nextId;
    if (event && wrapperRef.current) {
      setHoverPosition(clampHoverPosition(event, wrapperRef.current));
    }
    setHoveredLocationId(nextId);
  }, [clearHoverTimer]);
  const handleRenderError = useCallback(() => {
    setRenderFailed(true);
  }, []);

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

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
      <Canvas
        style={{ width: size, height: size }}
        camera={{ fov: 38, near: 0.1, far: 1000 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <GlobeScene
          region={region}
          pointsData={pointsData}
          activeCountryIds={activeCountryIds}
          selectedCountryId={selectedCountryId}
          locationByCountryId={locationByCountryId}
          selectedLocationId={selectedLocationId}
          onSelectLocation={handleSelectLocation}
          onHoverLocation={handleHoverLocation}
          onGlobeInteraction={handleGlobeInteraction}
          onRenderError={handleRenderError}
        />
      </Canvas>
      {selectedLocation && selectedPopupVisible ? (
        <GlobeHoverCard location={selectedLocation} signals={selectedSignals} position={selectedPosition} persistent />
      ) : (
        <GlobeHoverCard
          location={hoveredLocation}
          signals={hoverSignals}
          position={hoverPosition}
          onHoverHoldChange={handleHoverHoldChange}
        />
      )}
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
