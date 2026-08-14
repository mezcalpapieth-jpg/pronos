import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mapView = await readFile(new URL('./NewsMapView.jsx', import.meta.url), 'utf8');
let worldGlobe = '';
try {
  worldGlobe = await readFile(new URL('./NewsWorldGlobe.jsx', import.meta.url), 'utf8');
} catch {
  worldGlobe = '';
}
let subdivisions = '';
try {
  subdivisions = await readFile(new URL('../lib/newsGeoSubdivisions.js', import.meta.url), 'utf8');
} catch {
  subdivisions = '';
}
let subdivisionPolygons = '';
try {
  subdivisionPolygons = await readFile(new URL('../lib/newsGeoSubdivisionPolygons.js', import.meta.url), 'utf8');
} catch {
  subdivisionPolygons = '';
}
const newsPage = await readFile(new URL('../pages/NewsPage.jsx', import.meta.url), 'utf8');
const viteConfig = await readFile(new URL('../../vite.config.js', import.meta.url), 'utf8');

test('news map view renders a globe, region controls, market panel, and news panel', () => {
  assert.match(mapView, /function NewsGlobe/);
  assert.match(mapView, /function WorldLandLayer/);
  assert.match(mapView, /WORLD_LANDMASSES/);
  assert.match(mapView, /getNewsGeoRegions/);
  assert.match(mapView, /filterGeoItems/);
  assert.match(mapView, /extractMarketLocations/);
  assert.match(mapView, /summarizeGeoLocations\(items, markets\)/);
  assert.match(mapView, /markets/i);
  assert.match(mapView, /Noticias/);
  assert.match(mapView, /country-fill/);
});

test('news map lazy-loads a React Three Fiber globe renderer with country polygons and points', () => {
  assert.match(mapView, /React\.lazy/);
  assert.match(mapView, /NewsWorldGlobe/);
  assert.match(worldGlobe, /@react-three\/fiber/);
  assert.match(worldGlobe, /<Canvas/);
  assert.match(worldGlobe, /new ThreeGlobe/);
  assert.doesNotMatch(worldGlobe, /react-globe\.gl/);
  assert.match(worldGlobe, /world-atlas\/countries-110m\.json/);
  assert.match(worldGlobe, /pointsData/);
  assert.match(worldGlobe, /polygonsData/);
  assert.match(worldGlobe, /enableZoom=\{locked\}/);
  assert.match(worldGlobe, /autoRotate={false}/);
});

test('news globe treats markets as map signals and lets countries select their markets', () => {
  assert.match(worldGlobe, /function signalLabel/);
  assert.doesNotMatch(worldGlobe, /point\.count} noticia/);
  assert.match(worldGlobe, /mercado/);
  assert.match(worldGlobe, /function findLocationForGlobeObject/);
  assert.match(worldGlobe, /onSelectLocation\?\.\(location\.id, event\)/);
  assert.doesNotMatch(worldGlobe, /selectedLocationId === location\.id \? null : location\.id/);
  assert.match(worldGlobe, /PY:\s*'600'/);
  assert.match(worldGlobe, /EC:\s*'218'/);
  assert.match(worldGlobe, /BO:\s*'068'/);
  assert.match(worldGlobe, /GT:\s*'320'/);
  assert.match(worldGlobe, /BZ:\s*'084'/);
  assert.match(worldGlobe, /HN:\s*'340'/);
  assert.match(worldGlobe, /SV:\s*'222'/);
  assert.match(worldGlobe, /NI:\s*'558'/);
  assert.match(worldGlobe, /CR:\s*'188'/);
  assert.match(worldGlobe, /PA:\s*'591'/);
  assert.match(worldGlobe, /HU:\s*'348'/);
});

test('news globe keeps dragging on the canvas instead of a screen overlay', () => {
  assert.doesNotMatch(worldGlobe, /function CountryTargetOverlay/);
  assert.doesNotMatch(worldGlobe, /aria-label="Seleccionar pais en el mapa"/);
  assert.doesNotMatch(worldGlobe, /pointerEvents:\s*'auto'/);
  assert.doesNotMatch(worldGlobe, /function projectLocation/);
});

test('news globe can drill from Mexico and US countries into clickable state polygons', () => {
  assert.match(subdivisions, /SUBDIVISION_DRILL_COUNTRIES/);
  assert.match(subdivisions, /country:\s*'MX'/);
  assert.match(subdivisions, /country:\s*'US'/);
  assert.match(subdivisions, /name:\s*'Jalisco'/);
  assert.match(subdivisions, /name:\s*'California'/);
  assert.doesNotMatch(subdivisions, /newsGeoAdmin1Boundaries/);
  assert.match(subdivisionPolygons, /newsGeoAdmin1Boundaries/);
  assert.match(subdivisionPolygons, /function buildSubdivisionPolygonsForCountry/);
  assert.match(mapView, /buildSubdivisionLocations/);
  assert.match(mapView, /subdivisionLocations=\{subdivisionLocations\}/);
  assert.match(worldGlobe, /drillCountryCode/);
  assert.match(worldGlobe, /getSubdivisionsForCountry\(drillCountryCode\)/);
  assert.match(worldGlobe, /import\('\.\.\/lib\/newsGeoSubdivisionPolygons\.js'\)/);
  assert.match(worldGlobe, /setSubdivisionPolygonsData\(buildSubdivisionPolygonsForCountry\(drillCountryCode,\s*subdivisionPoints\)\)/);
  assert.match(worldGlobe, /polygonsForGlobe = drillCountryCode \? subdivisionPolygonsData : COUNTRIES/);
  assert.match(worldGlobe, /pointsForGlobe = drillCountryCode \? \[\] : pointsData/);
  assert.match(worldGlobe, /const labelPointsData = \[\]/);
  assert.doesNotMatch(worldGlobe, /labelText\('shortName'\)/);
  assert.match(worldGlobe, /marketCount/);
  assert.match(worldGlobe, /Volver/);
});

test('news globe keeps state drilldown on the globe and adds small Alaska and Hawaii controls', () => {
  assert.doesNotMatch(subdivisions, /mapInsetForSubdivision/);
  assert.match(subdivisions, /us-alaska/);
  assert.match(subdivisions, /us-hawaii/);
  assert.doesNotMatch(worldGlobe, /const SUBDIVISION_VIEWBOX/);
  assert.doesNotMatch(worldGlobe, /const US_SUBDIVISION_INSETS/);
  assert.doesNotMatch(worldGlobe, /function SubdivisionMapLayer/);
  assert.doesNotMatch(worldGlobe, /onWheel=\{handleWheel\}/);
  assert.doesNotMatch(worldGlobe, /setViewTransform/);
  assert.match(worldGlobe, /function SubdivisionInsetControls/);
  assert.match(worldGlobe, /function MiniSubdivisionShape/);
  assert.match(worldGlobe, /'us-alaska'/);
  assert.match(worldGlobe, /'us-hawaii'/);
  assert.match(worldGlobe, /onSelectLocation\?\.\(subdivision\.id, event\)/);
  assert.match(worldGlobe, /<SubdivisionInsetControls/);
  assert.match(worldGlobe, /selectedLocationId=\{selectedLocationId\}/);
});

test('news globe does not fade the whole map when selecting a state', () => {
  assert.match(worldGlobe, /const statePolygonsActive = polygonsData\.some\(polygonIsState\)/);
  assert.match(worldGlobe, /\.polygonsTransitionDuration\(statePolygonsActive \? 0 : 500\)/);
});

test('news globe can select empty countries and preserve empty panel titles', () => {
  assert.match(mapView, /selectedFallbackLocation/);
  assert.match(mapView, /const handleSelectLocation = \(nextLocationId, nextLocation = null\) => \{/);
  assert.match(mapView, /setSelectedFallbackLocation/);
  assert.match(mapView, /selectedFallbackLocation\?\.id === selectedLocationId/);
  assert.match(worldGlobe, /function countryLocationFallbacks/);
  assert.match(worldGlobe, /COUNTRIES\.map/);
  assert.match(worldGlobe, /countryFallbackLocations/);
  assert.match(worldGlobe, /pointsData,\s*\.\.\.countryFallbackLocations/);
  assert.match(worldGlobe, /selectableFallback:\s*true/);
  assert.match(worldGlobe, /onSelectLocation\?\.\(nextId, nextLocation\)/);
});

test('news globe exits state drill-down through Todos or Volver without keeping regional filters', () => {
  assert.match(mapView, /const \[returnFocusCountry, setReturnFocusCountry\] = useState\(null\)/);
  assert.match(mapView, /function focusCountryForSelection/);
  assert.match(mapView, /function buildReturnFocusRegion/);
  assert.match(mapView, /const globeRegion = returnFocusRegion/);
  assert.doesNotMatch(mapView, /buildSelectedLocationFocusRegion/);
  assert.match(mapView, /const handleRegionSelect = \(nextRegionKey\) => \{/);
  assert.match(mapView, /const nextFocusCountry = focusCountryForSelection/);
  assert.match(mapView, /if \(nextRegionKey === 'all'\) setReturnFocusCountry\(nextFocusCountry \|\| returnFocusCountry\)/);
  assert.match(mapView, /if \(!nextLocationId\) setReturnFocusCountry\(null\)/);
  assert.doesNotMatch(mapView, /if \(nextLocationId\) setReturnFocusCountry\(null\)/);
  assert.match(mapView, /onRegionChange\?\.\('all'\)/);
  assert.match(mapView, /onExitDrill=\{handleExitDrill\}/);
  assert.match(worldGlobe, /onExitDrill/);
  assert.match(worldGlobe, /onExitDrill\?\.\(drillCountryCode\)/);
  assert.match(worldGlobe, /if \(!selectedLocationId && drillCountryCode\)/);
});

test('news globe keeps Mexico and US clickable even without live map signals', () => {
  assert.match(worldGlobe, /DRILL_COUNTRY_LOCATIONS/);
  assert.match(worldGlobe, /id:\s*'mexico'/);
  assert.match(worldGlobe, /id:\s*'estados-unidos'/);
  assert.match(worldGlobe, /function visibleDrillCountryLocations\(region\)/);
  assert.match(worldGlobe, /region\?\.key === 'all'/);
  assert.match(worldGlobe, /const drillCountryClickPoints = useMemo/);
  assert.match(worldGlobe, /visibleDrillCountryLocations\(region\)/);
  assert.match(worldGlobe, /for \(const location of drillCountryClickPoints\)/);
  assert.match(worldGlobe, /if \(id && !byId\.has\(id\)\) byId\.set\(id, location\);/);
});

test('news globe locks world dragging while browsing Mexico or US states', () => {
  assert.match(worldGlobe, /PAN_MOUSE_BUTTONS/);
  assert.match(worldGlobe, /LEFT:\s*THREE\.MOUSE\.PAN/);
  assert.match(worldGlobe, /mouseButtons=\{locked \? PAN_MOUSE_BUTTONS : ROTATE_MOUSE_BUTTONS\}/);
  assert.match(worldGlobe, /screenSpacePanning=\{locked\}/);
  assert.match(worldGlobe, /function GlobeControls\(\{ locked = false \}\)/);
  assert.match(worldGlobe, /enableZoom=\{locked\}/);
  assert.match(worldGlobe, /enablePan=\{locked\}/);
  assert.match(worldGlobe, /enableRotate=\{!locked\}/);
  assert.match(worldGlobe, /interactionLocked/);
  assert.match(worldGlobe, /locked=\{Boolean\(drillCountryCode\)\}/);
  assert.match(worldGlobe, /interactionLocked=\{Boolean\(drillCountryCode\)\}/);
  assert.match(worldGlobe, /element\.style\.cursor = interactionLocked \? 'default' : 'grab'/);
  assert.match(worldGlobe, /element\.style\.cursor = interactionLocked \? \(location \? 'pointer' : 'default'\) : \(location \? 'pointer' : 'grab'\)/);
  assert.match(worldGlobe, /element\.style\.cursor = interactionLocked \? \(location \? 'pointer' : 'default'\) : 'grabbing'/);
});

test('news globe picks tiny states from the actual globe surface instead of an offset dot', () => {
  assert.match(worldGlobe, /SMALL_STATE_HIT_RADIUS_DEGREES/);
  assert.match(worldGlobe, /function stateHitRadiusForPolygon/);
  assert.match(worldGlobe, /function findStateLocationAtSurfacePoint/);
  assert.match(worldGlobe, /function findContainingStateLocationAtCoords/);
  assert.match(worldGlobe, /function findNearbyStateLocationForCoords/);
  assert.match(worldGlobe, /function distanceToFeatureDegrees/);
  assert.match(worldGlobe, /function findExactLocationAtPointer/);
  assert.match(worldGlobe, /raycaster\.ray\.intersectSphere/);
  assert.match(worldGlobe, /new THREE\.Sphere\(new THREE\.Vector3\(0, 0, 0\), 100\)/);
  assert.match(worldGlobe, /geoContains\(polygon,\s*\[coords\.lng,\s*coords\.lat\]\)/);
  assert.match(worldGlobe, /const surfaceStateLocation = interactionLocked \? findStateLocationAtSurfacePoint/);
  assert.match(worldGlobe, /if \(surfaceStateLocation\) return surfaceStateLocation/);
  assert.doesNotMatch(worldGlobe, /function screenPointForLocation/);
  assert.doesNotMatch(worldGlobe, /globeCoordsToVector3\(location\.lat, location\.lng, 0\.08\)\.project\(camera\)/);
  assert.ok(
    worldGlobe.indexOf('const containingStateLocation = findContainingStateLocationAtCoords')
      < worldGlobe.indexOf('const nearbyStateLocation = findNearbyStateLocationForCoords'),
    'state polygon containment must win before nearby tiny-state padding',
  );
});

test('news globe clamps state zoom before the camera can pass through states', () => {
  assert.match(worldGlobe, /STATE_VIEW_MIN_DISTANCE/);
  assert.match(worldGlobe, /const STATE_VIEW_MIN_DISTANCE = 112;/);
  assert.match(worldGlobe, /STATE_VIEW_MAX_DISTANCE/);
  assert.match(worldGlobe, /minDistance=\{locked \? STATE_VIEW_MIN_DISTANCE : WORLD_VIEW_MIN_DISTANCE\}/);
  assert.match(worldGlobe, /maxDistance=\{locked \? STATE_VIEW_MAX_DISTANCE : WORLD_VIEW_MAX_DISTANCE\}/);
});

test('news globe keeps selected state polygons flat while turning them red', () => {
  assert.match(worldGlobe, /const STATE_POLYGON_ALTITUDE = 0\.012;/);
  assert.match(worldGlobe, /\.polygonAltitude\(country => \(\s*polygonIsState\(country\)\s*\?\s*STATE_POLYGON_ALTITUDE\s*:\s*isSelectedCountry\(country\)/);
  assert.match(worldGlobe, /isSelectedCountry\(country\)\s*\?\s*'rgba\(120,18,18,0\.9\)'/);
  assert.match(worldGlobe, /isSelectedCountry\(country\)\s*\?\s*'rgba\(255,85,0,0\.95\)'/);
});

test('news globe clamps panning in state drill-down so the country cannot leave frame', () => {
  assert.match(worldGlobe, /STATE_VIEW_MIN_PAN_TARGET/);
  assert.match(worldGlobe, /STATE_VIEW_MAX_PAN_TARGET/);
  assert.match(worldGlobe, /function statePanTargetLimit\(distance\)/);
  assert.match(worldGlobe, /function clampStatePanTarget\(controls, camera\)/);
  assert.match(worldGlobe, /camera\.position\.distanceTo\(controls\.target\)/);
  assert.match(worldGlobe, /controls\.target\.clone\(\)\.setLength\(maxPan\)/);
  assert.match(worldGlobe, /camera\.position\.add\(correction\)/);
  assert.match(worldGlobe, /if \(locked && controls\) \{/);
});

test('news globe starts Mexico and US state drill-downs closer for small-state picking', () => {
  assert.match(subdivisions, /MX:\s*\{[\s\S]*globeAltitude:\s*0\.78,/);
  assert.match(subdivisions, /US:\s*\{[\s\S]*globeAltitude:\s*1\.02,/);
});

test('news globe keeps state camera stable while selecting and panning state polygons', () => {
  assert.match(worldGlobe, /const effectiveRegion = useMemo\(\(\) => \{/);
  assert.match(worldGlobe, /if \(!drillCountry\) return region;/);
  assert.match(worldGlobe, /\}, \[drillCountry, drillCountryCode, region\]\)/);
});

test('news globe selects countries with canvas raycasting against the real globe', () => {
  assert.match(worldGlobe, /function GlobePointerSelector/);
  assert.match(worldGlobe, /element\.addEventListener\('pointerup'/);
  assert.match(worldGlobe, /raycaster\.intersectObject\(globe,\s*true\)/);
  assert.match(worldGlobe, /findLocationForGlobeObject\(hit\.object/);
  assert.match(worldGlobe, /function vector3ToGlobeCoords/);
  assert.match(worldGlobe, /geoContains\(polygon,\s*\[coords\.lng,\s*coords\.lat\]\)/);
  assert.match(worldGlobe, /findCountryLocationForPoint\(hit\.point/);
});

test('news globe does not pick countries from the far side of the sphere', () => {
  assert.match(worldGlobe, /const nearestDistance = hits\[0\]\?\.distance/);
  assert.match(worldGlobe, /if \(hit\.distance > nearestDistance \+ 32\) break;/);
});

test('news globe uses country fills without ocean-centered pulse rings', () => {
  assert.match(worldGlobe, /const pinPointsData = useMemo\(/);
  assert.match(worldGlobe, /pointsData\.filter\(point => point\.render !== 'country-fill'\)/);
  assert.match(worldGlobe, /\.pointsData\(pinPointsData\)/);
  assert.match(worldGlobe, /\.ringsData\(pinPointsData\)/);
  assert.doesNotMatch(worldGlobe, /ringMaxRadius\(point => point\.render === 'country-fill'/);
});

test('news globe gives selected countries a clear pressed highlight', () => {
  assert.match(worldGlobe, /const selectedCountryId = useMemo\(/);
  assert.match(worldGlobe, /selectedCountryId=\{selectedCountryId\}/);
  assert.match(worldGlobe, /function polygonLocationId/);
  assert.match(worldGlobe, /const isSelectedCountry = country => selectedCountryId === String\(polygonLocationId\(country\)\)/);
  assert.match(worldGlobe, /isSelectedCountry\(country\)[\s\S]*\? 0\.045/);
  assert.match(worldGlobe, /isSelectedCountry\(country\)\s*\?\s*'rgba\(120,18,18,0\.9\)'/);
  assert.match(worldGlobe, /isSelectedCountry\(country\)\s*\?\s*'rgba\(255,85,0,0\.95\)'/);
});

test('news globe uses hand cursor over clickable countries and keeps grab while rotating', () => {
  assert.match(worldGlobe, /element\.style\.cursor = interactionLocked \? 'default' : 'grab'/);
  assert.match(worldGlobe, /element\.style\.cursor = interactionLocked \? \(location \? 'pointer' : 'default'\) : 'grabbing'/);
  assert.match(worldGlobe, /element\.addEventListener\('pointermove'/);
  assert.match(worldGlobe, /element\.style\.cursor = interactionLocked \? \(location \? 'pointer' : 'default'\) : \(location \? 'pointer' : 'grab'\)/);
});

test('news globe previews the three most relevant country signals on hover', () => {
  assert.match(mapView, /function buildGeoSignal/);
  assert.match(mapView, /function sortGeoSignals/);
  assert.match(mapView, /addLocation\(normalizeGeoLocationToCountry\(location\), 'news', item\)/);
  assert.match(mapView, /addLocation\(normalizeGeoLocationToCountry\(location\), 'market', market\)/);
  assert.match(mapView, /signals:\s*sortGeoSignals/);
  assert.match(worldGlobe, /hoveredLocationId/);
  assert.match(worldGlobe, /hoveredLocation/);
  assert.match(worldGlobe, /hoverPosition/);
  assert.match(worldGlobe, /function clampHoverPosition/);
  assert.match(worldGlobe, /onHoverLocation/);
  assert.match(worldGlobe, /onHoverLocation\?\.\(location \|\| null,\s*event\)/);
  assert.match(worldGlobe, /const hoverSignals = \(hoveredLocation\?\.signals \|\| \[\]\)\.slice\(0,\s*3\)/);
  assert.match(worldGlobe, /<GlobeHoverCard[\s\S]*location=\{hoveredLocation\}[\s\S]*signals=\{hoverSignals\}[\s\S]*position=\{hoverPosition\}/);
  assert.match(worldGlobe, /left:\s*position\.x/);
  assert.match(worldGlobe, /top:\s*position\.y/);
  assert.match(worldGlobe, /width:\s*'min\(240px, calc\(100% - 24px\)\)'/);
  assert.match(worldGlobe, /{signal\.kind === 'market' \? 'Mercado' : 'Noticia'}/);
  assert.doesNotMatch(worldGlobe, /dangerouslySetInnerHTML/);
});

test('news globe keeps clicked-country popup open with scrollable full signals', () => {
  assert.match(worldGlobe, /const selectedLocation = useMemo\(/);
  assert.match(worldGlobe, /const selectedSignals = selectedLocation\?\.signals \|\| \[\]/);
  assert.match(worldGlobe, /const \[selectedPosition, setSelectedPosition\] = useState\(\{ x: 18, y: 18 \}\)/);
  assert.match(worldGlobe, /const \[selectedPopupVisible, setSelectedPopupVisible\] = useState\(false\)/);
  assert.match(worldGlobe, /const handleSelectLocation = useCallback\(\(nextId, event\) => \{/);
  assert.match(worldGlobe, /setSelectedPopupVisible\(Boolean\(nextId\)\)/);
  assert.match(worldGlobe, /setSelectedPosition\(clampHoverPosition\(event, wrapperRef\.current, \{ cardHeight: 260 \}\)\)/);
  assert.match(worldGlobe, /selectedLocation && selectedPopupVisible \? \(/);
  assert.match(worldGlobe, /<GlobeHoverCard location=\{selectedLocation\} signals=\{selectedSignals\} position=\{selectedPosition\} persistent/);
  assert.match(worldGlobe, /maxHeight:\s*persistent \? 'min\(280px, calc\(100% - 28px\)\)' : undefined/);
  assert.match(worldGlobe, /overflow:\s*persistent \? 'hidden' : 'visible'/);
  assert.match(worldGlobe, /maxHeight:\s*persistent \? 112 : undefined/);
  assert.match(worldGlobe, /overflowY:\s*persistent \? 'auto' : 'visible'/);
  assert.match(worldGlobe, /const hasLinks = signals\.some\(signal => signal\.href\)/);
  assert.match(worldGlobe, /pointerEvents:\s*hasLinks \? 'auto' : 'none'/);
  assert.match(worldGlobe, /import \{ Link \} from 'react-router-dom'/);
  assert.match(worldGlobe, /const SignalTag = signal\.href \? \(signal\.kind === 'market' \? Link : 'a'\) : 'div'/);
  assert.match(worldGlobe, /to:\s*signal\.href/);
  assert.match(worldGlobe, /href:\s*signal\.href/);
  assert.match(worldGlobe, /target:\s*signal\.kind === 'news' \? '_blank' : undefined/);
  assert.match(worldGlobe, /rel:\s*signal\.kind === 'news' \? 'noreferrer' : undefined/);
});

test('news globe hover popup stays clickable while moving from globe to links', () => {
  assert.match(worldGlobe, /hoverCardHoldingRef/);
  assert.match(worldGlobe, /function GlobeHoverCard\(\{ location, signals, position, persistent = false, onHoverHoldChange \}\)/);
  assert.match(worldGlobe, /onPointerEnter=\{\(\) => onHoverHoldChange\?\.\(true\)\}/);
  assert.match(worldGlobe, /onPointerLeave=\{\(\) => onHoverHoldChange\?\.\(false\)\}/);
  assert.match(worldGlobe, /const handleHoverHoldChange = useCallback\(\(isHolding\) => \{/);
  assert.match(worldGlobe, /hoverCardHoldingRef\.current = isHolding/);
  assert.match(worldGlobe, /if \(hoverCardHoldingRef\.current\) return;/);
  assert.match(worldGlobe, /onHoverHoldChange=\{handleHoverHoldChange\}/);
});

test('news globe hover cards are not clipped by the circular globe mask', () => {
  assert.match(worldGlobe, /const globeShellStyle = \{/);
  assert.match(worldGlobe, /const globeViewportStyle = \{/);
  assert.match(worldGlobe, /overflow:\s*'visible'/);
  assert.match(worldGlobe, /overflow:\s*'hidden'/);
  assert.match(worldGlobe, /<div style=\{globeViewportStyle\}>[\s\S]*<Canvas/);
  assert.match(worldGlobe, /<GlobeHoverCard[\s\S]*position=\{hoverPosition\}/);
});

test('news globe hides the clicked popup on globe interaction without clearing selection', () => {
  assert.match(worldGlobe, /onGlobeInteraction/);
  assert.match(worldGlobe, /const handleGlobeInteraction = useCallback\(\(\) => \{/);
  assert.match(worldGlobe, /setSelectedPopupVisible\(false\)/);
  assert.match(worldGlobe, /onGlobeInteraction\?\.\(\)/);
  assert.match(worldGlobe, /onGlobeInteraction=\{handleGlobeInteraction\}/);
  assert.doesNotMatch(worldGlobe, /handleGlobeInteraction[\s\S]*onSelectLocation\?\.\(null\)/);
});

test('static fallback keeps country selection sticky instead of toggling it off', () => {
  assert.match(mapView, /const active = selectedLocationId === location\.id/);
  assert.match(mapView, /onClick=\{\(\) => onSelectLocation\?\.\(location\.id\)\}/);
  assert.doesNotMatch(mapView, /onSelectLocation\?\.\(active \? null : location\.id\)/);
});

test('news globe keeps hover previews stable while moving inside the same country', () => {
  assert.match(worldGlobe, /hoverLocationIdRef/);
  assert.match(worldGlobe, /hoverClearTimerRef/);
  assert.match(worldGlobe, /const handleHoverLocation = useCallback/);
  assert.match(worldGlobe, /if \(hoverLocationIdRef\.current === nextId\) return;/);
  assert.match(worldGlobe, /setTimeout\(\(\) => \{/);
  assert.match(worldGlobe, /clearHoverTimer\(\);/);
  assert.match(worldGlobe, /const handleRenderError = useCallback/);
});

test('news globe does not show a floating bottom-right country tooltip', () => {
  assert.doesNotMatch(worldGlobe, /hoveredPoint/);
  assert.doesNotMatch(worldGlobe, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(worldGlobe, /signalLabel\(hoveredPoint\)/);
});

test('news globe camera uses the same lat-lng convention as three-globe', () => {
  assert.match(worldGlobe, /function globeCoordsToVector3/);
  assert.match(worldGlobe, /THREE\.MathUtils\.degToRad\(90 - clampNumber\(lng, 0\)\)/);
  assert.match(worldGlobe, /const r = 100 \* \(1 \+ altitude\)/);
  assert.doesNotMatch(worldGlobe, /clampNumber\(center\.lng, -35\) \+ 180/);
});

test('news globe lets wide regions override the camera zoom', () => {
  assert.match(worldGlobe, /region\?\.globeAltitude \?\? defaultAltitude/);
});

test('news globe loading state does not flash the static marker layer', () => {
  assert.match(mapView, /function GlobeLoadingShell/);
  assert.match(mapView, /const loadingFallback = \(/);
  assert.match(mapView, /<Suspense fallback={loadingFallback}>/);
  assert.match(mapView, /fallback={staticFallback}/);
  assert.doesNotMatch(mapView, /<Suspense fallback={fallback}>/);
});

test('news map can be reused as a market-only globe', () => {
  assert.match(mapView, /showNewsPanel = true/);
  assert.match(mapView, /showNewsPanel \?/);
  assert.match(mapView, /return visible;/);
  assert.match(mapView, /selectedCountry/);
  assert.match(mapView, /locationMatchesSelection/);
});

test('news map does not cap market locations or panel rows', () => {
  assert.doesNotMatch(mapView, /\.slice\(0,\s*28\)/);
  assert.doesNotMatch(mapView, /visible\.slice\(0,\s*8\)/);
  assert.doesNotMatch(mapView, /visibleItems\.slice\(0,\s*8\)/);
  assert.match(mapView, /maxHeight:\s*520/);
  assert.match(mapView, /overflowY:\s*'auto'/);
});

test('news map panel titles include the selected country or place', () => {
  assert.match(mapView, /selectedLocationLabel/);
  assert.match(mapView, /Mercados de \{selectedLocationLabel\}/);
  assert.match(mapView, /Noticias de \{selectedLocationLabel\}/);
});

test('news map filters panels by selected state subdivision', () => {
  assert.match(mapView, /normalizeGeoLocationToSubdivision/);
  assert.match(mapView, /const subdivisionLocations = useMemo/);
  assert.match(mapView, /subdivisionLocations\.find\(location => location\.id === selectedLocationId\)/);
  assert.match(mapView, /if \(selectedSubdivisionId && location\.subdivisionId === selectedSubdivisionId\) return true;/);
  assert.match(mapView, /normalizeGeoLocationToSubdivision\(location\)/);
});

test('news map aggregates visible globe locations by country', () => {
  assert.match(mapView, /normalizeGeoLocationToCountry/);
  assert.match(mapView, /addLocation\(normalizeGeoLocationToCountry\(location\), 'news', item\)/);
  assert.match(mapView, /addLocation\(normalizeGeoLocationToCountry\(location\), 'market', market\)/);
});

test('news page exposes map mode from the news experience', () => {
  assert.match(newsPage, /viewMode/);
  assert.match(newsPage, /setViewMode\('map'\)/);
  assert.match(newsPage, /useState\('all'\)/);
  assert.match(newsPage, /NewsMapView/);
  assert.match(newsPage, /Mapa/);
  assert.match(newsPage, /enrichNewsItemsWithGeo/);
  assert.match(newsPage, /viewMode === 'map' && !loading/);
  assert.doesNotMatch(newsPage, /viewMode === 'map' && !loading && !error/);
});

test('local dev serves shared CSS under the app basename', () => {
  assert.match(viteConfig, /sharedCssDevMiddleware/);
  assert.match(viteConfig, /\/mvp\/css\//);
  assert.match(viteConfig, /\/points\/css\//);
});
