import { config } from './config.js';

const modeToOsrmProfile = (mode) => {
  if (mode === 'walking') return 'foot';
  if (mode === 'bicycle') return 'bike';
  return 'driving';
};

export async function searchPlaces({ q, lat, lng, limit = 8 }) {
  const url = new URL('/search', config.geocodingBaseUrl);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(Math.min(limit, 10)));
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
  }
  const response = await fetch(url, {
    headers: { 'User-Agent': config.geocodingUserAgent, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error(`geocoder returned ${response.status}`);
  const items = await response.json();
  return items.map((item) => ({
    id: String(item.place_id),
    name: item.name || item.display_name?.split(',')[0] || 'Place',
    displayName: item.display_name,
    lat: Number(item.lat),
    lng: Number(item.lon),
    type: item.type,
    category: item.category,
    address: item.address ?? {}
  }));
}

export async function previewRoute({ originLat, originLng, destinationLat, destinationLng, mode }) {
  const profile = modeToOsrmProfile(mode);
  const path = `/route/v1/${profile}/${originLng},${originLat};${destinationLng},${destinationLat}`;
  const url = new URL(path, config.routingBaseUrl);
  url.searchParams.set('overview', 'full');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('steps', 'true');
  url.searchParams.set('alternatives', 'true');
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`routing provider returned ${response.status}`);
  const data = await response.json();
  if (data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
    throw new Error(data.message || 'No route found');
  }
  return {
    provider: 'osrm',
    requestedMode: mode,
    profile,
    routes: data.routes.slice(0, 3).map((route, index) => ({
      id: `route-${index + 1}`,
      distanceM: Math.round(route.distance),
      durationS: Math.round(route.duration),
      geometry: route.geometry,
      legs: route.legs?.map((leg) => ({
        distanceM: Math.round(leg.distance),
        durationS: Math.round(leg.duration),
        steps: leg.steps?.map((step) => ({
          distanceM: Math.round(step.distance),
          durationS: Math.round(step.duration),
          name: step.name,
          maneuver: step.maneuver
        }))
      }))
    }))
  };
}
