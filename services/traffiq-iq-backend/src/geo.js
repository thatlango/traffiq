import { config } from './config.js';

const modeToOsrmProfile = (mode) => {
  if (mode === 'walking') return 'foot';
  if (mode === 'bicycle') return 'bike';
  return 'driving';
};

const normalize = (value = '') => String(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const CATEGORY_TAGS = [
  { match: /\b(fuel|petrol|gas station|fuel station)\b/, tag: 'amenity:fuel' },
  { match: /\b(hospital|clinic|health centre|health center)\b/, tag: 'amenity:hospital' },
  { match: /\b(pharmacy|chemist)\b/, tag: 'amenity:pharmacy' },
  { match: /\b(restaurant|food|eatery)\b/, tag: 'amenity:restaurant' },
  { match: /\b(cafe|coffee)\b/, tag: 'amenity:cafe' },
  { match: /\b(bank)\b/, tag: 'amenity:bank' },
  { match: /\b(atm)\b/, tag: 'amenity:atm' },
  { match: /\b(police|police station)\b/, tag: 'amenity:police' },
  { match: /\b(school|primary school|secondary school)\b/, tag: 'amenity:school' },
  { match: /\b(university|college)\b/, tag: 'amenity:university' },
  { match: /\b(hotel|lodge|guest house|guesthouse)\b/, tag: 'tourism:hotel' },
  { match: /\b(supermarket|grocery)\b/, tag: 'shop:supermarket' },
  { match: /\b(market|marketplace)\b/, tag: 'amenity:marketplace' }
];

const categoryTagFor = query => CATEGORY_TAGS.find(item => item.match.test(normalize(query)))?.tag || null;

const distanceM = (aLat, aLng, bLat, bLng) => {
  if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return null;
  const toRad = value => value * Math.PI / 180;
  const earth = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const textScore = (query, item) => {
  const q = normalize(query);
  const name = normalize(item.name);
  const detail = normalize(item.displayName || item.formatted_address || '');
  if (!q) return 0;
  let score = 0;
  if (name === q) score += 520;
  else if (name.startsWith(q)) score += 360;
  else if (name.includes(q)) score += 240;
  if (detail.startsWith(q)) score += 130;
  else if (detail.includes(q)) score += 90;
  const qWords = q.split(' ').filter(Boolean);
  const nameWords = new Set(name.split(' ').filter(Boolean));
  score += qWords.filter(word => nameWords.has(word)).length * 35;
  return score;
};

const rankPlaces = (items, { q, lat, lng, limit }) => {
  const seen = new Set();
  const ranked = items
    .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng) && item.name)
    .map(item => {
      const metres = distanceM(lat, lng, item.lat, item.lng);
      const countryCode = String(item.address?.country_code || item.address?.countrycode || '').toLowerCase();
      const proximity = metres == null ? 0 : 260 / (1 + metres / 4500);
      const ugandaBoost = countryCode === 'ug' ? 55 : 0;
      const namedPoiBoost = item.category && !['place', 'boundary'].includes(String(item.category).toLowerCase()) ? 35 : 0;
      return { ...item, distance_m: metres == null ? null : Math.round(metres), _score: textScore(q, item) + proximity + ugandaBoost + namedPoiBoost };
    });

  const hasLocal = ranked.some(item => item.distance_m != null && item.distance_m <= 200000);
  return ranked
    .filter(item => !hasLocal || item.distance_m == null || item.distance_m <= 500000)
    .sort((a, b) => b._score - a._score || (a.distance_m ?? Number.MAX_SAFE_INTEGER) - (b.distance_m ?? Number.MAX_SAFE_INTEGER))
    .filter(item => {
      const key = `${normalize(item.name)}|${item.lat.toFixed(4)}|${item.lng.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.min(Math.max(Number(limit) || 8, 1), 10))
    .map(({ _score, ...item }) => item);
};

async function searchNominatim({ q, lat, lng, limit }) {
  const url = new URL('/search', config.geocodingBaseUrl);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('namedetails', '1');
  url.searchParams.set('dedupe', '1');
  url.searchParams.set('limit', String(Math.min(Math.max(limit * 2, 8), 20)));
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const delta = 1.8;
    url.searchParams.set('viewbox', `${lng - delta},${lat + delta},${lng + delta},${lat - delta}`);
    url.searchParams.set('bounded', '0');
  }
  const response = await fetch(url, {
    headers: { 'User-Agent': config.geocodingUserAgent, 'Accept-Language': 'en', Accept: 'application/json' },
    signal: AbortSignal.timeout(6500)
  });
  if (!response.ok) throw new Error(`nominatim returned ${response.status}`);
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : []).map(item => ({
    id: `nominatim:${item.place_id}`,
    provider_place_id: String(item.place_id || ''),
    name: item.name || item.namedetails?.name || item.display_name?.split(',')[0] || 'Place',
    displayName: item.display_name || null,
    detail: item.display_name || null,
    formatted_address: item.display_name || null,
    lat: Number(item.lat),
    lng: Number(item.lon),
    type: item.type || null,
    category: item.category || item.class || null,
    address: item.address ?? {},
    source: 'nominatim'
  }));
}

async function searchPhoton({ q, lat, lng, limit }) {
  const url = new URL('/api/', process.env.PHOTON_BASE_URL || 'https://photon.komoot.io');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(Math.min(Math.max(limit * 2, 8), 20)));
  url.searchParams.set('lang', 'en');
  const categoryTag = categoryTagFor(q);
  if (categoryTag) url.searchParams.set('osm_tag', categoryTag);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
  }
  const response = await fetch(url, {
    headers: { 'User-Agent': config.geocodingUserAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(6500)
  });
  if (!response.ok) throw new Error(`photon returned ${response.status}`);
  const body = await response.json();
  const features = Array.isArray(body?.features) ? body.features : [];
  return features.map(feature => {
    const p = feature.properties || {};
    const coords = feature.geometry?.coordinates || [];
    const parts = [p.name, p.street, p.housenumber, p.district, p.city, p.county, p.state, p.country].filter(Boolean);
    const formatted = [...new Set(parts)].join(', ');
    return {
      id: `photon:${p.osm_type || 'x'}:${p.osm_id || `${coords[0]}:${coords[1]}`}`,
      provider_place_id: String(p.osm_id || ''),
      name: p.name || p.street || p.city || p.district || 'Place',
      displayName: formatted || p.name || null,
      detail: formatted || null,
      formatted_address: formatted || null,
      lat: Number(coords[1]),
      lng: Number(coords[0]),
      type: p.osm_value || p.type || null,
      category: p.osm_key || null,
      address: {
        road: p.street || null,
        suburb: p.district || null,
        city: p.city || null,
        county: p.county || null,
        state: p.state || null,
        country: p.country || null,
        country_code: p.countrycode || null,
        postcode: p.postcode || null
      },
      source: 'photon'
    };
  });
}

export async function searchPlaces({ q, lat, lng, limit = 8 }) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  const requested = Math.min(Math.max(Number(limit) || 8, 1), 10);
  const providers = await Promise.allSettled([
    searchPhoton({ q: query, lat, lng, limit: requested }),
    searchNominatim({ q: query, lat, lng, limit: requested })
  ]);
  const items = providers.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  if (!items.length && providers.every(result => result.status === 'rejected')) {
    throw new Error('place search providers unavailable');
  }
  return rankPlaces(items, { q: query, lat, lng, limit: requested });
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
