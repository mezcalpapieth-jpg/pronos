import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichNewsItemsWithGeo,
  extractNewsLocations,
  extractMarketLocations,
  filterGeoItems,
  getNewsGeoRegions,
  marketMatchesGeoRegion,
  normalizeGeoLocationToCountry,
  summarizeGeoLocations,
} from './newsGeo.js';
import {
  getSubdivisionsForCountry,
  normalizeGeoLocationToSubdivision,
} from './newsGeoSubdivisions.js';
import {
  buildSubdivisionPolygonsForCountry,
} from './newsGeoSubdivisionPolygons.js';

test('enriches city news as precise dots and country news as country glows', () => {
  const [guadalajara, iran] = enrichNewsItemsWithGeo([
    {
      title: 'Nueva inversión tecnológica llega a Guadalajara',
      summary: 'El proyecto se anunció en Jalisco esta mañana.',
      url: 'https://example.com/gdl',
    },
    {
      title: 'Tensión internacional sube en Irán',
      summary: 'Analistas siguen el impacto regional.',
      url: 'https://example.com/iran',
    },
  ]);

  assert.equal(guadalajara.geoLocations[0].name, 'Guadalajara');
  assert.equal(guadalajara.geoLocations[0].region, 'mexico');
  assert.equal(guadalajara.geoLocations[0].granularity, 'city');
  assert.equal(guadalajara.geoLocations[0].render, 'point');
  assert.equal(typeof guadalajara.geoLocations[0].lat, 'number');
  assert.equal(typeof guadalajara.geoLocations[0].lng, 'number');

  assert.equal(iran.geoLocations[0].name, 'Irán');
  assert.equal(iran.geoLocations[0].region, 'asia');
  assert.equal(iran.geoLocations[0].granularity, 'country');
  assert.equal(iran.geoLocations[0].render, 'country-fill');
});

test('filters and summarizes enriched news by globe region', () => {
  const items = enrichNewsItemsWithGeo([
    { title: 'Guadalajara prepara nuevas obras', url: 'https://example.com/1' },
    { title: 'Elecciones en Argentina entran a fase decisiva', url: 'https://example.com/2' },
    { title: 'Mercados de Estados Unidos cierran mixtos', url: 'https://example.com/3' },
    { title: 'Francia anuncia nuevo gabinete', url: 'https://example.com/4' },
    { title: 'Irán responde a sanciones', url: 'https://example.com/5' },
  ]);

  assert.deepEqual(getNewsGeoRegions().map(r => r.key), ['all', 'mexico', 'latam', 'us-canada', 'europe', 'asia']);
  assert.equal(filterGeoItems(items, 'mexico').length, 1);
  assert.equal(filterGeoItems(items, 'latam').length, 1);
  assert.equal(filterGeoItems(items, 'us-canada').length, 1);
  assert.equal(filterGeoItems(items, 'europe').length, 1);
  assert.equal(filterGeoItems(items, 'asia').length, 1);

  const asiaRegion = getNewsGeoRegions().find(region => region.key === 'asia');
  assert.deepEqual(asiaRegion.center, { lat: 22, lng: 78 });
  assert.equal(asiaRegion.zoom, 1.0);
  assert.equal(asiaRegion.globeAltitude, 2.15);
  const latamRegion = getNewsGeoRegions().find(region => region.key === 'latam');
  assert.deepEqual(latamRegion.center, { lat: -15, lng: -58 });
  assert.equal(latamRegion.zoom, 1.0);
  assert.equal(latamRegion.globeAltitude, 2.15);

  const counts = Object.fromEntries(summarizeGeoLocations(items).map(r => [r.key, r.count]));
  assert.equal(counts.all, 5);
  assert.equal(counts.mexico, 1);
  assert.equal(counts.latam, 1);
  assert.equal(counts['us-canada'], 1);
  assert.equal(counts.europe, 1);
  assert.equal(counts.asia, 1);
});

test('routes tournament-specific news to the real host region', () => {
  const libertadores = extractNewsLocations({
    title: 'Copa Libertadores: partidos destacados en Mexico & Latam',
    summary: 'Los cruces de Sudamérica se mueven esta semana.',
  });
  const rolandGarros = extractNewsLocations({
    title: 'Roland Garros define semifinales',
    summary: 'El torneo se juega en París, Francia.',
  });

  assert.equal(libertadores[0].id, 'copa-libertadores');
  assert.equal(libertadores[0].region, 'latam');
  assert.equal(libertadores.some(location => location.region === 'mexico'), false);

  assert.equal(rolandGarros[0].id, 'roland-garros');
  assert.equal(rolandGarros[0].region, 'europe');
  assert.equal(rolandGarros[0].country, 'FR');
});

test('routes Central America news into Latam', () => {
  const panama = extractNewsLocations({
    title: 'Panamá prepara nuevas elecciones',
    summary: 'Analistas de Centroamérica siguen la jornada.',
  });
  const costaRica = extractNewsLocations({
    title: 'Costa Rica anuncia paquete económico',
    summary: 'El gobierno presentó nuevas medidas fiscales.',
  });

  assert.equal(panama[0].id, 'panama');
  assert.equal(panama[0].region, 'latam');
  assert.equal(costaRica[0].id, 'costa-rica');
  assert.equal(costaRica[0].region, 'latam');
  assert.equal(filterGeoItems(enrichNewsItemsWithGeo([
    { title: 'Panamá prepara nuevas elecciones' },
    { title: 'Costa Rica anuncia paquete económico' },
  ]), 'latam').length, 2);
});

test('normalizes city and tournament locations to countries for globe display', () => {
  const madrid = extractNewsLocations({
    title: 'Madrid prepara nuevas restricciones',
    summary: 'La medida se discutirá esta semana.',
  })[0];
  const rolandGarros = extractNewsLocations({
    title: 'Roland Garros define semifinales',
    summary: 'El torneo se juega en París.',
  })[0];

  const madridCountry = normalizeGeoLocationToCountry(madrid);
  const rolandCountry = normalizeGeoLocationToCountry(rolandGarros);

  assert.equal(madrid.name, 'Madrid');
  assert.equal(madridCountry.name, 'España');
  assert.equal(madridCountry.id, 'espana');
  assert.equal(madridCountry.render, 'country-fill');
  assert.equal(rolandCountry.name, 'Francia');
  assert.equal(rolandCountry.id, 'francia');
});

test('keeps Mexico and US state metadata for subdivision drill-downs', () => {
  const guadalajara = extractNewsLocations({
    title: 'Guadalajara anuncia nuevas obras',
    summary: 'El proyecto se presentó en Jalisco.',
  })[0];
  const newYork = extractNewsLocations({
    title: 'Nueva York prepara nuevas reglas financieras',
    summary: 'Wall Street sigue atento.',
  })[0];

  assert.equal(guadalajara.subdivisionId, 'mx-jalisco');
  assert.equal(normalizeGeoLocationToSubdivision(guadalajara).id, 'mx-jalisco');
  assert.equal(normalizeGeoLocationToSubdivision(guadalajara).name, 'Jalisco');
  assert.equal(newYork.subdivisionId, 'us-new-york');
  assert.equal(normalizeGeoLocationToSubdivision(newYork).id, 'us-new-york');
  assert.ok(getSubdivisionsForCountry('MX').length >= 32);
  assert.ok(getSubdivisionsForCountry('US').length >= 51);
});

test('builds clickable subdivision polygons with market glow metadata', () => {
  const polygons = buildSubdivisionPolygonsForCountry('MX', [
    {
      id: 'mx-jalisco',
      marketCount: 2,
      newsCount: 1,
      count: 3,
      signals: [{ kind: 'market', title: 'Guadalajara vs America' }],
    },
  ]);

  const jalisco = polygons.find(feature => feature.properties.locationId === 'mx-jalisco');
  const sinaloa = polygons.find(feature => feature.properties.locationId === 'mx-sinaloa');

  assert.ok(polygons.length >= 32);
  assert.equal(jalisco.properties.name, 'Jalisco');
  assert.equal(jalisco.properties.country, 'MX');
  assert.equal(jalisco.properties.granularity, 'state');
  assert.equal(jalisco.properties.boundarySource, 'natural-earth-admin1');
  assert.equal(jalisco.properties.marketCount, 2);
  assert.equal(jalisco.properties.count, 3);
  assert.equal(Array.isArray(jalisco.geometry.coordinates[0]), true);
  assert.ok(jalisco.geometry.coordinates.flat(4).length > 80);
  assert.equal(sinaloa.properties.marketCount, 0);
});

test('keeps Alaska and Hawaii available as clickable US subdivision polygons', () => {
  const polygons = buildSubdivisionPolygonsForCountry('US', [
    { id: 'us-alaska', marketCount: 1, count: 1 },
    { id: 'us-hawaii', newsCount: 2, count: 2 },
  ]);

  const alaska = polygons.find(feature => feature.properties.locationId === 'us-alaska');
  const hawaii = polygons.find(feature => feature.properties.locationId === 'us-hawaii');
  const texas = polygons.find(feature => feature.properties.locationId === 'us-texas');

  assert.ok(alaska);
  assert.equal(alaska.properties.boundarySource, 'natural-earth-admin1');
  assert.equal(alaska.properties.granularity, 'state');
  assert.equal(alaska.properties.marketCount, 1);
  assert.ok(hawaii);
  assert.equal(hawaii.properties.boundarySource, 'natural-earth-admin1');
  assert.equal(hawaii.properties.newsCount, 2);
  assert.ok(texas);
  assert.equal(texas.properties.boundarySource, 'natural-earth-admin1');
  assert.equal('mapInset' in alaska.properties, false);
  assert.equal('mapInset' in hawaii.properties, false);
  assert.equal('mapInset' in texas.properties, false);
});

test('keeps regional tournament markets out of Mexico when category text is broad', () => {
  const libertadoresMarket = {
    categoryTags: ['mexico'],
    geoTags: ['latam'],
    league: 'Copa Libertadores',
    sport: 'soccer',
  };
  const rolandGarrosMarket = {
    categoryTags: ['deportes'],
    league: 'Roland Garros',
    sport: 'tennis',
  };

  assert.equal(marketMatchesGeoRegion(libertadoresMarket, 'mexico'), false);
  assert.equal(marketMatchesGeoRegion(libertadoresMarket, 'latam'), true);
  assert.equal(marketMatchesGeoRegion(rolandGarrosMarket, 'mexico'), false);
  assert.equal(marketMatchesGeoRegion(rolandGarrosMarket, 'europe'), true);
});

test('summarizes news and market locations together for the globe counters', () => {
  const items = enrichNewsItemsWithGeo([
    { title: 'Francia anuncia nuevo gabinete', url: 'https://example.com/france' },
  ]);
  const markets = [
    {
      id: 6129,
      question: 'Libertad vs Universidad Central',
      sport: 'soccer',
      league: 'copa-libertadores',
      categoryTags: ['deportes', 'mexico'],
      geoTags: ['latam'],
      outcomes: ['Libertad', 'Empate', 'Universidad Central'],
    },
  ];

  const counts = Object.fromEntries(summarizeGeoLocations(items, markets).map(r => [r.key, r.count]));

  assert.equal(counts.all, 2);
  assert.equal(counts.europe, 1);
  assert.equal(counts.latam, 1);
  assert.equal(counts.mexico, 0);
});

test('locates sports markets by the host side instead of both team countries', () => {
  const finalLocations = extractMarketLocations({
    question: 'Crystal Palace vs Rayo Vallecano',
    sport: 'soccer',
    league: 'uefa-conference-league',
    outcomes: ['Crystal Palace', 'Rayo Vallecano'],
    resolverConfig: {
      homeName: 'Crystal Palace',
      awayName: 'Rayo Vallecano',
      shape: 'binary',
    },
  });

  assert.equal(finalLocations.length, 1);
  assert.equal(finalLocations[0].country, 'GB');
  assert.equal(finalLocations[0].region, 'europe');
  assert.equal(finalLocations.some(location => location.country === 'ES'), false);

  const libertadoresLocations = extractMarketLocations({
    question: 'Libertad vs Universidad Central',
    sport: 'soccer',
    league: 'copa-libertadores',
    categoryTags: ['deportes', 'mexico'],
    geoTags: ['latam'],
    outcomes: ['Libertad', 'Empate', 'Universidad Central'],
  });

  assert.equal(libertadoresLocations[0].name, 'Paraguay');
  assert.equal(libertadoresLocations[0].region, 'latam');
  assert.equal(libertadoresLocations.some(location => location.region === 'mexico'), false);
});

test('locates market countries from known venues and South American club aliases', () => {
  const psgArsenal = extractMarketLocations({
    question: 'PSG vs Arsenal',
    sport: 'soccer',
    league: 'uefa-cl',
    sourceData: {
      venue: 'Puskas Arena, Budapest',
    },
    outcomes: ['PSG', 'Arsenal'],
  });

  assert.equal(psgArsenal[0].name, 'Budapest');
  assert.equal(psgArsenal[0].country, 'HU');
  assert.equal(psgArsenal[0].region, 'europe');

  const championsFinalFallback = extractMarketLocations({
    question: 'PSG vs Arsenal',
    sport: 'soccer',
    league: 'uefa-cl',
    outcomes: ['PSG', 'Arsenal'],
  });

  assert.equal(championsFinalFallback[0].country, 'HU');

  const boca = extractMarketLocations({
    question: 'Boca Juniors vs Palmeiras',
    sport: 'soccer',
    league: 'copa-libertadores',
    outcomes: ['Boca Juniors', 'Palmeiras'],
  });

  assert.equal(boca[0].name, 'Argentina');
  assert.equal(boca[0].region, 'latam');
});
