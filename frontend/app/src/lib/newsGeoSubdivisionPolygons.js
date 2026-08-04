import { ADMIN1_BOUNDARY_FEATURES } from './newsGeoAdmin1Boundaries.js';
import { getSubdivisionCountry } from './newsGeoSubdivisions.js';

export function buildSubdivisionPolygonsForCountry(countryCode, subdivisionLocations = []) {
  const country = getSubdivisionCountry(countryCode);
  if (!country) return [];

  const enrichedById = new Map((subdivisionLocations || []).map(location => [location.id, location]));
  const statesById = new Map(country.states.map(subdivision => {
    const enriched = enrichedById.get(subdivision.id) || {};
    return [subdivision.id, {
      ...subdivision,
      ...enriched,
      lat: Number(enriched.lat ?? subdivision.lat),
      lng: Number(enriched.lng ?? subdivision.lng),
      count: Math.max(0, Number(enriched.count) || 0),
      newsCount: Math.max(0, Number(enriched.newsCount) || 0),
      marketCount: Math.max(0, Number(enriched.marketCount) || 0),
      signals: enriched.signals || [],
    }];
  }));

  return ADMIN1_BOUNDARY_FEATURES
    .filter(feature => feature?.properties?.country === country.country)
    .map(feature => {
      const site = statesById.get(feature.properties.locationId);
      if (!site) return null;
      return {
        ...feature,
        id: site.id,
        properties: {
          ...feature.properties,
          id: site.id,
          locationId: site.id,
          name: site.name,
          shortName: site.shortName,
          country: site.country,
          region: site.region,
          subdivisionId: site.id,
          subdivisionName: site.name,
          granularity: 'state',
          count: site.count,
          newsCount: site.newsCount,
          marketCount: site.marketCount,
          signals: site.signals,
        },
      };
    })
    .filter(Boolean);
}
