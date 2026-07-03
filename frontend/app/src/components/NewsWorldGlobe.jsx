import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber';
import ThreeGlobe from 'three-globe';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { geoCentroid, geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import countriesTopology from 'world-atlas/countries-110m.json';
import {
  buildSubdivisionPolygonsForCountry,
  getSubdivisionCountry,
  getSubdivisionsForCountry,
} from '../lib/newsGeoSubdivisions.js';

extend({ OrbitControls });

const ROTATE_MOUSE_BUTTONS = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
};

const PAN_MOUSE_BUTTONS = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
};

const ROTATE_TOUCHES = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};

const PAN_TOUCHES = {
  ONE: THREE.TOUCH.PAN,
  TWO: THREE.TOUCH.DOLLY_PAN,
};

const WORLD_VIEW_MIN_DISTANCE = 120;
const WORLD_VIEW_MAX_DISTANCE = 520;
const STATE_VIEW_MIN_DISTANCE = 112;
const STATE_VIEW_MAX_DISTANCE = 320;
const STATE_VIEW_MIN_PAN_TARGET = 6;
const STATE_VIEW_MAX_PAN_TARGET = 34;
const STATE_POLYGON_ALTITUDE = 0.012;
const SMALL_STATE_HIT_RADIUS_DEGREES = 0.11;
const MEDIUM_STATE_HIT_RADIUS_DEGREES = 0.07;
const GLOBE_SURFACE_SPHERE = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 100);
const GLOBE_SURFACE_POINT = new THREE.Vector3();

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

const COUNTRY_CODE_BY_ID = Object.fromEntries(
  Object.entries(COUNTRY_ID_BY_CODE).map(([code, id]) => [id, code]),
);

const COUNTRIES = feature(
  countriesTopology,
  countriesTopology.objects.countries,
).features;

const DRILL_COUNTRY_LOCATIONS = [
  {
    id: 'mexico',
    name: 'Mexico',
    region: 'mexico',
    country: 'MX',
    granularity: 'country',
    render: 'country-fill',
    lat: 23.6,
    lng: -102.5,
    count: 0,
    newsCount: 0,
    marketCount: 0,
    signals: [],
  },
  {
    id: 'estados-unidos',
    name: 'Estados Unidos',
    region: 'us-canada',
    country: 'US',
    granularity: 'country',
    render: 'country-fill',
    lat: 39.8,
    lng: -98.6,
    count: 0,
    newsCount: 0,
    marketCount: 0,
    signals: [],
  },
];

function visibleDrillCountryLocations(region) {
  if (!region || region?.key === 'all') return DRILL_COUNTRY_LOCATIONS;
  return DRILL_COUNTRY_LOCATIONS.filter(location => location.region === region.key);
}

function regionForCountryCode(countryCode) {
  const code = String(countryCode || '').toUpperCase();
  if (code === 'MX') return 'mexico';
  if (code === 'US' || code === 'CA') return 'us-canada';
  if (['AR', 'BO', 'BR', 'BZ', 'CL', 'CO', 'CR', 'EC', 'GT', 'HN', 'NI', 'PA', 'PE', 'PY', 'SV', 'UY', 'VE'].includes(code)) return 'latam';
  if (['DE', 'ES', 'FR', 'GB', 'HU', 'IT', 'NL', 'PT', 'UA'].includes(code)) return 'europe';
  if (['CN', 'IL', 'IN', 'IR', 'JP'].includes(code)) return 'asia';
  return 'all';
}

function countryLocationFallbacks() {
  return COUNTRIES.map(country => {
    const polygonId = String(polygonLocationId(country) || '');
    const code = COUNTRY_CODE_BY_ID[polygonId] || null;
    const name = country?.properties?.name || country?.properties?.NAME || code || 'Pais';
    const [lng, lat] = geoCentroid(country);
    return {
      id: `country-${polygonId}`,
      name,
      region: regionForCountryCode(code),
      country: code,
      countryPolygonId: polygonId,
      granularity: 'country',
      render: 'country-fill',
      lat: Number.isFinite(lat) ? lat : 0,
      lng: Number.isFinite(lng) ? lng : 0,
      count: 0,
      newsCount: 0,
      marketCount: 0,
      signals: [],
      selectableFallback: true,
    };
  }).filter(location => location.countryPolygonId);
}

function clampNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointColor(point) {
  if (point.active) return 'rgba(255,255,255,0.96)';
  if (point.render === 'state-marker') {
    return Number(point.count || 0) > 0
      ? 'rgba(255,85,0,0.96)'
      : 'rgba(255,255,255,0.62)';
  }
  return point.render === 'country-fill'
    ? 'rgba(255,85,0,0.92)'
    : 'rgba(0,232,122,0.96)';
}

function buildPoint(location, selectedLocationId) {
  const rawCount = Math.max(0, Number(location.count) || 0);
  const count = location.render === 'state-marker' ? rawCount : Math.max(1, rawCount || 1);
  const active = selectedLocationId === location.id;
  const stateRadius = active ? 0.13 : count > 0 ? 0.095 : 0.058;
  return {
    ...location,
    lat: clampNumber(location.lat, 0),
    lng: clampNumber(location.lng, 0),
    count,
    active,
    radius: location.render === 'state-marker'
      ? stateRadius
      : location.render === 'country-fill'
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

function statePanTargetLimit(distance) {
  const zoomProgress = 1 - (
    (distance - STATE_VIEW_MIN_DISTANCE)
    / (STATE_VIEW_MAX_DISTANCE - STATE_VIEW_MIN_DISTANCE)
  );
  return THREE.MathUtils.clamp(
    STATE_VIEW_MIN_PAN_TARGET + zoomProgress * (STATE_VIEW_MAX_PAN_TARGET - STATE_VIEW_MIN_PAN_TARGET),
    STATE_VIEW_MIN_PAN_TARGET,
    STATE_VIEW_MAX_PAN_TARGET,
  );
}

function clampStatePanTarget(controls, camera) {
  const distance = camera.position.distanceTo(controls.target);
  const maxPan = statePanTargetLimit(distance);
  if (controls.target.length() <= maxPan) return false;

  const clampedTarget = controls.target.clone().setLength(maxPan);
  const correction = clampedTarget.clone().sub(controls.target);
  controls.target.copy(clampedTarget);
  camera.position.add(correction);
  return true;
}

function GlobeControls({ locked = false }) {
  const controlsRef = useRef(null);
  const { camera, gl } = useThree();

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    controls.update();
    if (locked && controls) {
      const clamped = clampStatePanTarget(controls, camera);
      if (clamped) controls.update();
    }
  });

  return (
    <orbitControls
      ref={controlsRef}
      args={[camera, gl.domElement]}
      enableZoom={locked}
      enablePan={locked}
      enableRotate={!locked}
      autoRotate={false}
      enableDamping
      dampingFactor={0.08}
      mouseButtons={locked ? PAN_MOUSE_BUTTONS : ROTATE_MOUSE_BUTTONS}
      touches={locked ? PAN_TOUCHES : ROTATE_TOUCHES}
      minDistance={locked ? STATE_VIEW_MIN_DISTANCE : WORLD_VIEW_MIN_DISTANCE}
      maxDistance={locked ? STATE_VIEW_MAX_DISTANCE : WORLD_VIEW_MAX_DISTANCE}
      screenSpacePanning={locked}
      panSpeed={locked ? 0.42 : 0}
      rotateSpeed={locked ? 0 : 0.42}
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

function polygonLocationId(data) {
  return (
    data?.properties?.locationId
    || data?.data?.properties?.locationId
    || data?.properties?.id
    || data?.data?.properties?.id
    || data?.data?.id
    || data?.id
  );
}

function polygonMarketCount(polygon) {
  return Math.max(0, Number(polygon?.properties?.marketCount) || 0);
}

function polygonCount(polygon) {
  return Math.max(0, Number(polygon?.properties?.count) || 0);
}

function polygonIsState(polygon) {
  return polygon?.properties?.granularity === 'state';
}

function stateHitRadiusForPolygon(polygon) {
  if (!polygonIsState(polygon)) return 0;
  const bounds = boundsForFeature(polygon);
  if (!bounds) return 0;
  const lngSpan = Math.max(0, bounds.maxLng - bounds.minLng);
  const latSpan = Math.max(0, bounds.maxLat - bounds.minLat);
  const area = lngSpan * latSpan;
  if (area <= 0.25) return SMALL_STATE_HIT_RADIUS_DEGREES;
  if (area <= 0.9) return MEDIUM_STATE_HIT_RADIUS_DEGREES;
  return 0;
}

function featureAreaScore(polygon) {
  const bounds = boundsForFeature(polygon);
  if (!bounds) return Infinity;
  return Math.max(0, bounds.maxLng - bounds.minLng) * Math.max(0, bounds.maxLat - bounds.minLat);
}

function findContainingStateLocationAtCoords({
  coords,
  locationByCountryId,
  polygonsData,
}) {
  let best = null;

  for (const polygon of polygonsData || []) {
    if (!polygonIsState(polygon)) continue;
    if (!geoContains(polygon, [coords.lng, coords.lat])) continue;
    const id = polygonLocationId(polygon);
    const location = id ? locationByCountryId.get(String(id)) : null;
    if (!location) continue;
    const area = featureAreaScore(polygon);
    if (!best || area < best.area) {
      best = { location, area };
    }
  }

  return best?.location || null;
}

function signedLngDeltaDegrees(lng, originLng) {
  return ((lng - originLng + 540) % 360) - 180;
}

function coordToLocalPoint(coord, origin, feature) {
  const lng = normalizeSubdivisionLng(feature, coord?.[0]);
  const lat = Number(coord?.[1]);
  const latScale = Math.max(0.25, Math.cos(THREE.MathUtils.degToRad(origin.lat)));
  return {
    x: signedLngDeltaDegrees(lng, origin.lng) * latScale,
    y: lat - origin.lat,
  };
}

function pointSegmentDistanceDegrees(point, startCoord, endCoord) {
  const start = coordToLocalPoint(startCoord, point, point.feature);
  const end = coordToLocalPoint(endCoord, point, point.feature);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0) return Math.hypot(start.x, start.y);
  const t = Math.max(0, Math.min(1, -(start.x * dx + start.y * dy) / lengthSq));
  return Math.hypot(start.x + dx * t, start.y + dy * t);
}

function distanceToFeatureDegrees(coords, polygon) {
  let best = Infinity;
  const point = { ...coords, feature: polygon };
  for (const ring of polygonRings(polygon.geometry)) {
    for (let index = 1; index < ring.length; index += 1) {
      const distance = pointSegmentDistanceDegrees(point, ring[index - 1], ring[index]);
      if (distance < best) best = distance;
    }
  }
  return best;
}

function findNearbyStateLocationForCoords({
  coords,
  locationByCountryId,
  polygonsData,
}) {
  let best = null;

  for (const polygon of polygonsData || []) {
    const radius = stateHitRadiusForPolygon(polygon);
    if (!radius) continue;
    const id = polygonLocationId(polygon);
    const location = id ? locationByCountryId.get(String(id)) : null;
    if (!location) continue;
    const distance = distanceToFeatureDegrees(coords, polygon);
    if (distance <= radius && (!best || distance < best.distance)) {
      best = { location, distance };
    }
  }

  return best?.location || null;
}

function findStateLocationAtSurfacePoint({
  raycaster,
  locationByCountryId,
  polygonsData,
}) {
  const surfacePoint = raycaster.ray.intersectSphere(GLOBE_SURFACE_SPHERE, GLOBE_SURFACE_POINT);
  if (!surfacePoint) return null;
  const coords = vector3ToGlobeCoords(surfacePoint);
  const containingStateLocation = findContainingStateLocationAtCoords({
    coords,
    locationByCountryId,
    polygonsData,
  });
  if (containingStateLocation) return containingStateLocation;

  const nearbyStateLocation = findNearbyStateLocationForCoords({
    coords,
    locationByCountryId,
    polygonsData,
  });
  if (nearbyStateLocation) return nearbyStateLocation;

  return null;
}

function findLocationForGlobeObject(object, locationByCountryId, pointsData) {
  const data = findObjectData(object);
  if (!data) return null;

  const countryId = polygonLocationId(data);
  const countryLocation = countryId ? locationByCountryId.get(String(countryId)) : null;
  if (countryLocation) return countryLocation;

  const pointId = data?.id;
  if (pointId) return pointsData.find(point => point.id === pointId) || null;

  return null;
}

function findCountryLocationForPoint(point, locationByCountryId, polygonsData = COUNTRIES) {
  const coords = vector3ToGlobeCoords(point);
  for (const polygon of polygonsData) {
    const id = polygonLocationId(polygon);
    const location = id ? locationByCountryId.get(String(id)) : null;
    if (location && geoContains(polygon, [coords.lng, coords.lat])) return location;
  }
  return null;
}

function findExactLocationAtPointer({
  raycaster,
  globe,
  locationByCountryId,
  pointsData,
  polygonsData,
}) {
  const hits = raycaster.intersectObject(globe, true);
  const nearestDistance = hits[0]?.distance;
  for (const hit of hits) {
    if (hit.distance > nearestDistance + 32) break;
    const location = (
      findLocationForGlobeObject(hit.object, locationByCountryId, pointsData)
      || findCountryLocationForPoint(hit.point, locationByCountryId, polygonsData)
    );
    if (location) return location;
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
  polygonsData,
  interactionLocked,
}) {
  if (!globe) return null;
  const rect = element.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);

  const surfaceStateLocation = interactionLocked ? findStateLocationAtSurfacePoint({
    raycaster,
    locationByCountryId,
    polygonsData,
  }) : null;
  if (surfaceStateLocation) return surfaceStateLocation;

  const exactLocation = findExactLocationAtPointer({
    raycaster,
    globe,
    locationByCountryId,
    pointsData,
    polygonsData,
  });
  if (exactLocation) return exactLocation;

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

function normalizeSubdivisionLng(feature, lng) {
  const value = Number(lng);
  if (feature?.properties?.locationId === 'us-alaska' && value > 0) return value - 360;
  return value;
}

function polygonRings(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates || [];
  if (geometry?.type === 'MultiPolygon') return (geometry.coordinates || []).flat();
  return [];
}

function boundsForFeature(feature) {
  const bounds = {
    minLng: Infinity,
    maxLng: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity,
  };

  for (const ring of polygonRings(feature.geometry)) {
    for (const coord of ring || []) {
      const lng = normalizeSubdivisionLng(feature, coord?.[0]);
      const lat = Number(coord?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      bounds.minLng = Math.min(bounds.minLng, lng);
      bounds.maxLng = Math.max(bounds.maxLng, lng);
      bounds.minLat = Math.min(bounds.minLat, lat);
      bounds.maxLat = Math.max(bounds.maxLat, lat);
    }
  }

  if (!Number.isFinite(bounds.minLng)) return null;
  return bounds;
}

function makeMiniSubdivisionProjector(bounds, width, height, feature) {
  const lngSpan = Math.max(0.001, bounds.maxLng - bounds.minLng);
  const latSpan = Math.max(0.001, bounds.maxLat - bounds.minLat);
  const scale = Math.min((width - 8) / lngSpan, (height - 8) / latSpan);
  const drawnWidth = lngSpan * scale;
  const drawnHeight = latSpan * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;

  return coord => {
    const lng = normalizeSubdivisionLng(feature, coord?.[0]);
    const lat = Number(coord?.[1]);
    return {
      x: offsetX + (lng - bounds.minLng) * scale,
      y: offsetY + (bounds.maxLat - lat) * scale,
    };
  };
}

function miniSubdivisionPath(feature, width = 82, height = 44) {
  const bounds = boundsForFeature(feature);
  if (!bounds) return '';
  const project = makeMiniSubdivisionProjector(bounds, width, height, feature);
  return polygonRings(feature.geometry)
    .map(ring => (ring || [])
      .map((coord, index) => {
        const point = project(coord);
        const command = index === 0 ? 'M' : 'L';
        return `${command}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
      })
      .join(' '))
    .filter(Boolean)
    .map(path => `${path} Z`)
    .join(' ');
}

function MiniSubdivisionShape({ feature, selected = false }) {
  const d = useMemo(() => miniSubdivisionPath(feature), [feature]);
  return (
    <svg
      viewBox="0 0 82 44"
      aria-hidden="true"
      focusable="false"
      style={{
        width: 52,
        height: 28,
        display: 'block',
        overflow: 'visible',
        filter: selected ? 'drop-shadow(0 0 12px rgba(255,85,0,0.58))' : 'drop-shadow(0 0 8px rgba(0,0,0,0.36))',
      }}
    >
      <path
        d={d}
        fill={selected ? 'rgba(120,18,18,0.9)' : 'rgba(0,232,122,0.18)'}
        stroke={selected ? 'rgba(255,85,0,0.95)' : 'rgba(255,255,255,0.54)'}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function SubdivisionInsetControls({
  countryCode,
  polygons,
  locations,
  selectedLocationId,
  onSelectLocation,
  onHoverLocation,
}) {
  const locationsById = useMemo(
    () => new Map((locations || []).map(location => [location.id, location])),
    [locations],
  );
  const insetFeatures = useMemo(() => {
    if (countryCode !== 'US') return [];
    return ['us-alaska', 'us-hawaii']
      .map(id => {
        const feature = (polygons || []).find(polygon => polygon?.properties?.locationId === id);
        const subdivision = locationsById.get(id);
        return feature && subdivision ? { feature, subdivision } : null;
      })
      .filter(Boolean);
  }, [countryCode, locationsById, polygons]);

  if (!insetFeatures.length) return null;

  return (
    <div style={{
      position: 'absolute',
      left: '50%',
      bottom: 18,
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'end',
      gap: 12,
      zIndex: 3,
    }}>
      {insetFeatures.map(({ feature, subdivision }) => {
        const active = selectedLocationId === subdivision.id;
        return (
          <button
            key={subdivision.id}
            type="button"
            aria-label={subdivision.name}
            onClick={event => onSelectLocation?.(subdivision.id, event)}
            onPointerEnter={event => onHoverLocation?.(subdivision, event)}
            onPointerMove={event => onHoverLocation?.(subdivision, event)}
            onPointerLeave={() => onHoverLocation?.(null)}
            style={{
              appearance: 'none',
              border: 0,
              background: 'transparent',
              color: active ? 'var(--orange)' : 'rgba(255,255,255,0.76)',
              cursor: 'pointer',
              display: 'grid',
              justifyItems: 'center',
              gap: 2,
              fontFamily: 'var(--font-mono)',
              fontSize: 8,
              letterSpacing: '0.1em',
              padding: 0,
              textTransform: 'uppercase',
            }}
          >
            <MiniSubdivisionShape feature={feature} selected={active} />
            <span>{subdivision.shortName}</span>
          </button>
        );
      })}
    </div>
  );
}

function GlobeObject({
  pointsData,
  polygonsData = COUNTRIES,
  labelPointsData = [],
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
    const isSelectedCountry = country => selectedCountryId === String(polygonLocationId(country));
    const isActiveCountry = country => activeCountryIds.has(String(polygonLocationId(country)));
    const hasStateMarket = country => polygonIsState(country) && polygonMarketCount(country) > 0;
    const hasStateSignal = country => polygonIsState(country) && polygonCount(country) > 0;
    const statePolygonsActive = polygonsData.some(polygonIsState);
    try {
      globe
        .polygonsData(polygonsData)
        .polygonGeoJsonGeometry('geometry')
        .polygonAltitude(country => (
          polygonIsState(country)
            ? STATE_POLYGON_ALTITUDE
            : isSelectedCountry(country)
              ? 0.045
              : hasStateMarket(country)
                ? 0.034
                : isActiveCountry(country)
                  ? 0.018
                  : 0.006
        ))
        .polygonCapColor(country => (isSelectedCountry(country)
          ? 'rgba(120,18,18,0.9)'
          : hasStateMarket(country)
            ? 'rgba(0,232,122,0.42)'
            : isActiveCountry(country)
            ? 'rgba(255,85,0,0.48)'
            : polygonIsState(country)
              ? 'rgba(0,232,122,0.09)'
              : 'rgba(0,232,122,0.10)'))
        .polygonSideColor(country => (isSelectedCountry(country)
          ? 'rgba(255,85,0,0.32)'
          : hasStateMarket(country)
            ? 'rgba(0,232,122,0.22)'
            : 'rgba(0,232,122,0.035)'))
        .polygonStrokeColor(country => (isSelectedCountry(country)
          ? 'rgba(255,85,0,0.95)'
          : hasStateMarket(country)
            ? 'rgba(0,232,122,0.88)'
          : isActiveCountry(country)
            ? 'rgba(255,255,255,0.52)'
            : polygonIsState(country)
              ? 'rgba(255,255,255,0.28)'
              : 'rgba(255,255,255,0.12)'))
        .polygonsTransitionDuration(statePolygonsActive ? 0 : 500)
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
        .ringMaxRadius(point => point.render === 'state-marker' && !point.count ? 0.22 : 3.6)
        .ringPropagationSpeed(1.25)
        .ringRepeatPeriod(2600)
        .ringColor(point => point.render === 'state-marker' && !point.count
          ? 'rgba(255,255,255,0.0)'
          : pointColor(point))
        .labelsData(labelPointsData)
        .labelLat('lat')
        .labelLng('lng')
        .labelText('name')
        .labelSize(point => point.active ? 0.8 : 0.55)
        .labelDotRadius(point => point.count > 0 || point.active ? 0.18 : 0.1)
        .labelColor(point => point.active
          ? 'rgba(255,255,255,0.96)'
          : point.count > 0
            ? 'rgba(255,85,0,0.96)'
            : 'rgba(255,255,255,0.64)')
        .labelAltitude(point => point.active ? 0.078 : 0.052)
        .labelResolution(2);
    } catch {
      onRenderError?.();
    }
  }, [activeCountryIds, globe, labelPointsData, onRenderError, pinPointsData, polygonsData, selectedCountryId]);

  useEffect(() => () => {
    globe._destructor?.();
    globeMaterial.dispose();
  }, [globe, globeMaterial]);

  return <primitive object={globe} />;
}

function GlobePointerSelector({
  globeRef,
  pointsData,
  polygonsData,
  locationByCountryId,
  selectedLocationId,
  onSelectLocation,
  onHoverLocation,
  onGlobeInteraction,
  interactionLocked,
}) {
  const { camera, gl } = useThree();
  const pointerDownRef = useRef(null);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useEffect(() => {
    const element = gl.domElement;
    element.style.cursor = interactionLocked ? 'default' : 'grab';
    const getLocation = event => findLocationAtPointer({
      event,
      element,
      camera,
      raycaster,
      pointer,
      globe: globeRef.current,
      locationByCountryId,
      pointsData,
      polygonsData,
      interactionLocked,
    });
    const handlePointerDown = event => {
      pointerDownRef.current = { x: event.clientX, y: event.clientY };
      onHoverLocation?.(null);
      onGlobeInteraction?.();
      const location = interactionLocked ? getLocation(event) : null;
      element.style.cursor = interactionLocked ? (location ? 'pointer' : 'default') : 'grabbing';
    };
    const handlePointerMove = event => {
      if (pointerDownRef.current) return;
      const location = getLocation(event);
      onHoverLocation?.(location || null, event);
      element.style.cursor = interactionLocked ? (location ? 'pointer' : 'default') : (location ? 'pointer' : 'grab');
    };
    const handlePointerUp = event => {
      const pointerDown = pointerDownRef.current;
      pointerDownRef.current = null;
      if (
        pointerDown
        && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 7
      ) {
        element.style.cursor = interactionLocked ? 'default' : 'grab';
        return;
      }
      const location = getLocation(event);
      element.style.cursor = interactionLocked ? (location ? 'pointer' : 'default') : (location ? 'pointer' : 'grab');
      if (location) {
        event.preventDefault();
        onSelectLocation?.(location.id, event);
      }
    };
    const handlePointerLeave = () => {
      pointerDownRef.current = null;
      onHoverLocation?.(null);
      element.style.cursor = interactionLocked ? 'default' : 'grab';
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
    interactionLocked,
    locationByCountryId,
    onHoverLocation,
    onSelectLocation,
    onGlobeInteraction,
    pointer,
    polygonsData,
    pointsData,
    raycaster,
    selectedLocationId,
  ]);

  return null;
}

function GlobeScene({
  region,
  pointsData,
  polygonsData,
  labelPointsData,
  activeCountryIds,
  selectedCountryId,
  locationByCountryId,
  selectedLocationId,
  onSelectLocation,
  onHoverLocation,
  onGlobeInteraction,
  locked,
  interactionLocked,
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
      <GlobeControls locked={Boolean(locked)} />
      <GlobeObject
        pointsData={pointsData}
        polygonsData={polygonsData}
        labelPointsData={labelPointsData}
        activeCountryIds={activeCountryIds}
        selectedCountryId={selectedCountryId}
        globeRef={globeRef}
        onRenderError={onRenderError}
      />
      <GlobePointerSelector
        globeRef={globeRef}
        pointsData={pointsData}
        polygonsData={polygonsData}
        locationByCountryId={locationByCountryId}
        selectedLocationId={selectedLocationId}
        onSelectLocation={onSelectLocation}
        onHoverLocation={onHoverLocation}
        onGlobeInteraction={onGlobeInteraction}
        interactionLocked={interactionLocked}
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

const globeShellStyle = {
  position: 'relative',
  width: 'min(82vw, 620px)',
  minWidth: 320,
  aspectRatio: '1 / 1',
  borderRadius: '50%',
  overflow: 'visible',
  display: 'grid',
  placeItems: 'center',
  background: 'radial-gradient(circle at 50% 50%, rgba(0,232,122,0.16), transparent 42%)',
  boxShadow: '0 0 100px rgba(255,85,0,0.14)',
  isolation: 'isolate',
};

const globeViewportStyle = {
  position: 'absolute',
  inset: 0,
  borderRadius: '50%',
  overflow: 'hidden',
  display: 'grid',
  placeItems: 'center',
  zIndex: 0,
};

export default function NewsWorldGlobe({
  region,
  locations = [],
  subdivisionLocations = [],
  selectedLocationId,
  onSelectLocation,
  onExitDrill,
  fallback = null,
}) {
  const wrapperRef = useRef(null);
  const [size, setSize] = useState(520);
  const [renderFailed, setRenderFailed] = useState(false);
  const [hoveredLocationId, setHoveredLocationId] = useState(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 18, y: 18 });
  const [selectedPosition, setSelectedPosition] = useState({ x: 18, y: 18 });
  const [selectedPopupVisible, setSelectedPopupVisible] = useState(false);
  const [drillCountryCode, setDrillCountryCode] = useState(null);
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
  const countryFallbackLocations = useMemo(() => (
    countryLocationFallbacks().map(location => buildPoint(location, selectedLocationId))
  ), [selectedLocationId]);
  const drillCountryClickPoints = useMemo(() => {
    const pointsByCountry = new Map();
    for (const point of pointsData || []) {
      const country = String(point.country || '').toUpperCase();
      if (country && !pointsByCountry.has(country)) pointsByCountry.set(country, point);
    }
    return visibleDrillCountryLocations(region).map(location => (
      pointsByCountry.get(location.country) || buildPoint(location, selectedLocationId)
    ));
  }, [pointsData, region, selectedLocationId]);
  const subdivisionBaseLocations = useMemo(
    () => getSubdivisionsForCountry(drillCountryCode),
    [drillCountryCode],
  );
  const subdivisionPoints = useMemo(() => {
    const locationById = new Map((subdivisionLocations || []).map(location => [location.id, location]));
    return subdivisionBaseLocations.map(location => {
      const enriched = locationById.get(location.id) || {};
      return buildPoint({
        ...location,
        ...enriched,
        signals: enriched.signals || [],
      }, selectedLocationId);
    });
  }, [selectedLocationId, subdivisionBaseLocations, subdivisionLocations]);
  const subdivisionPolygonsData = useMemo(
    () => buildSubdivisionPolygonsForCountry(drillCountryCode, subdivisionPoints),
    [drillCountryCode, subdivisionPoints],
  );
  const polygonsForGlobe = drillCountryCode ? subdivisionPolygonsData : COUNTRIES;
  const pointsForGlobe = drillCountryCode ? [] : pointsData;
  const interactionPoints = drillCountryCode ? subdivisionPoints : [...pointsData, ...countryFallbackLocations];
  const labelPointsData = [];
  const drillCountry = getSubdivisionCountry(drillCountryCode);
  const effectiveRegion = useMemo(() => {
    if (!drillCountry) return region;
    return {
      key: `drill-${drillCountryCode}`,
      label: drillCountry.label,
      center: drillCountry.center,
      globeAltitude: drillCountry.globeAltitude,
    };
  }, [drillCountry, drillCountryCode, region]);

  const activeCountryIds = useMemo(() => {
    if (drillCountryCode) {
      return new Set(
        subdivisionPoints
          .filter(location => Number(location.count || 0) > 0)
          .map(location => location.id),
      );
    }
    const ids = new Set();
    for (const location of locations || []) {
      const id = COUNTRY_ID_BY_CODE[String(location.country || '').toUpperCase()];
      if (id) ids.add(id);
    }
    for (const location of visibleDrillCountryLocations(region)) {
      const id = COUNTRY_ID_BY_CODE[String(location.country || '').toUpperCase()];
      if (id) ids.add(id);
    }
    return ids;
  }, [drillCountryCode, locations, region, subdivisionPoints]);

  const locationByCountryId = useMemo(() => {
    if (drillCountryCode) {
      return new Map(subdivisionPoints.map(location => [location.id, location]));
    }
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
    for (const location of drillCountryClickPoints) {
      const id = COUNTRY_ID_BY_CODE[String(location.country || '').toUpperCase()];
      if (id && !byId.has(id)) byId.set(id, location);
    }
    for (const location of countryFallbackLocations) {
      const id = location.countryPolygonId || COUNTRY_ID_BY_CODE[String(location.country || '').toUpperCase()];
      if (id && !byId.has(id)) byId.set(id, location);
    }
    return byId;
  }, [countryFallbackLocations, drillCountryClickPoints, drillCountryCode, pointsData]);

  const selectedLocation = useMemo(() => (
    interactionPoints.find(location => location.id === selectedLocationId) || null
  ), [interactionPoints, selectedLocationId]);
  const selectedCountryId = useMemo(() => (
    drillCountryCode
      ? selectedLocation?.id || null
      : selectedLocation
      ? selectedLocation.countryPolygonId || COUNTRY_ID_BY_CODE[String(selectedLocation.country || '').toUpperCase()] || null
      : null
  ), [drillCountryCode, selectedLocation]);
  const hoveredLocation = useMemo(() => (
    interactionPoints.find(location => location.id === hoveredLocationId) || null
  ), [interactionPoints, hoveredLocationId]);
  const hoverSignals = (hoveredLocation?.signals || []).slice(0, 3);
  const selectedSignals = selectedLocation?.signals || [];
  const clearHoverTimer = useCallback(() => {
    if (!hoverClearTimerRef.current) return;
    clearTimeout(hoverClearTimerRef.current);
    hoverClearTimerRef.current = null;
  }, []);
  const handleSelectLocation = useCallback((nextId, event) => {
    const nextLocation = (
      interactionPoints.find(location => location.id === nextId)
      || drillCountryClickPoints.find(location => location.id === nextId)
    );
    if (!drillCountryCode) {
      const nextDrillCountry = getSubdivisionCountry(nextLocation?.country);
      if (nextDrillCountry) {
        setDrillCountryCode(nextDrillCountry.country);
        setSelectedPopupVisible(false);
        clearHoverTimer();
        hoverLocationIdRef.current = null;
        setHoveredLocationId(null);
        onSelectLocation?.(nextId, nextLocation);
        return;
      }
    }
    if (nextId && event && wrapperRef.current) {
      setSelectedPosition(clampHoverPosition(event, wrapperRef.current, { cardHeight: 260 }));
    }
    setSelectedPopupVisible(Boolean(nextId));
    clearHoverTimer();
    hoverLocationIdRef.current = null;
    setHoveredLocationId(null);
    onSelectLocation?.(nextId, nextLocation);
  }, [clearHoverTimer, drillCountryClickPoints, drillCountryCode, interactionPoints, onSelectLocation]);
  const handleGlobeInteraction = useCallback(() => {
    setSelectedPopupVisible(false);
  }, []);
  const handleBackToCountries = useCallback(() => {
    const resetLocationId = null;
    setDrillCountryCode(null);
    setSelectedPopupVisible(false);
    clearHoverTimer();
    hoverLocationIdRef.current = null;
    setHoveredLocationId(null);
    onSelectLocation?.(resetLocationId, null);
    onExitDrill?.(drillCountryCode);
  }, [clearHoverTimer, drillCountryCode, onExitDrill, onSelectLocation]);
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

  useEffect(() => {
    setDrillCountryCode(null);
    setSelectedPopupVisible(false);
    clearHoverTimer();
    hoverLocationIdRef.current = null;
    setHoveredLocationId(null);
  }, [clearHoverTimer, region?.key]);

  useEffect(() => {
    if (!selectedLocationId && drillCountryCode) {
      setDrillCountryCode(null);
      setSelectedPopupVisible(false);
      clearHoverTimer();
      hoverLocationIdRef.current = null;
      setHoveredLocationId(null);
    }
  }, [clearHoverTimer, drillCountryCode, selectedLocationId]);

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  if (renderFailed) return fallback;

  return (
    <div ref={wrapperRef} style={globeShellStyle}>
      <div style={globeViewportStyle}>
        <Canvas
          style={{ width: size, height: size }}
          camera={{ fov: 38, near: 0.1, far: 1000 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
          }}
        >
          <GlobeScene
            region={effectiveRegion}
            pointsData={pointsForGlobe}
            polygonsData={polygonsForGlobe}
            labelPointsData={labelPointsData}
            activeCountryIds={activeCountryIds}
            selectedCountryId={selectedCountryId}
            locationByCountryId={locationByCountryId}
            selectedLocationId={selectedLocationId}
            onSelectLocation={handleSelectLocation}
            onHoverLocation={handleHoverLocation}
            onGlobeInteraction={handleGlobeInteraction}
            locked={Boolean(drillCountryCode)}
            interactionLocked={Boolean(drillCountryCode)}
            onRenderError={handleRenderError}
          />
        </Canvas>
      </div>
      <SubdivisionInsetControls
        countryCode={drillCountryCode}
        polygons={subdivisionPolygonsData}
        locations={subdivisionPoints}
        selectedLocationId={selectedLocationId}
        onSelectLocation={handleSelectLocation}
        onHoverLocation={handleHoverLocation}
      />
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
      {drillCountryCode ? (
        <button
          type="button"
          onClick={handleBackToCountries}
          style={{
            position: 'absolute',
            left: 16,
            top: 16,
            border: '1px solid rgba(255,85,0,0.48)',
            borderRadius: 999,
            background: 'rgba(10,10,10,0.78)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            padding: '9px 12px',
            textTransform: 'uppercase',
            textShadow: '0 2px 16px rgba(0,0,0,0.7)',
            zIndex: 3,
          }}
        >
          Volver
        </button>
      ) : (
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
          zIndex: 1,
        }}>
          {region?.label || 'Mapa'}
        </div>
      )}
    </div>
  );
}
