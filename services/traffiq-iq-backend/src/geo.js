import { config } from './config.js';
import { query as dbQuery } from './db.js';

const modeToOsrmProfile = (mode) => {
  if (mode === 'walking') return 'foot';
  if (mode === 'bicycle') return 'bike';
  return 'driving';
};

export const normalizePlaceText = (value = '') => String(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const CATEGORY_DEFINITIONS = [
  { key: 'fuel', label: 'Fuel', match: /\b(fuel|petrol|gas station|fuel station)\b/, photonTag: 'amenity:fuel', osmKey: 'amenity', osmValue: 'fuel', googleTypes: ['gas_station'] },
  { key: 'food', label: 'Food', match: /\b(restaurant|food|eatery)\b/, photonTag: 'amenity:restaurant', osmKey: 'amenity', osmValue: 'restaurant', googleTypes: ['restaurant'] },
  { key: 'cafe', label: 'Cafe', match: /\b(cafe|coffee)\b/, photonTag: 'amenity:cafe', osmKey: 'amenity', osmValue: 'cafe', googleTypes: ['cafe'] },
  { key: 'hospital', label: 'Hospital', match: /\b(hospital|clinic|health centre|health center)\b/, photonTag: 'amenity:hospital', osmKey: 'amenity', osmValue: 'hospital', googleTypes: ['hospital'] },
  { key: 'pharmacy', label: 'Pharmacy', match: /\b(pharmacy|chemist)\b/, photonTag: 'amenity:pharmacy', osmKey: 'amenity', osmValue: 'pharmacy', googleTypes: ['pharmacy'] },
  { key: 'atm', label: 'ATM', match: /\b(atm)\b/, photonTag: 'amenity:atm', osmKey: 'amenity', osmValue: 'atm', googleTypes: ['atm'] },
  { key: 'bank', label: 'Bank', match: /\b(bank)\b/, photonTag: 'amenity:bank', osmKey: 'amenity', osmValue: 'bank', googleTypes: ['bank'] },
  { key: 'police', label: 'Police', match: /\b(police|police station)\b/, photonTag: 'amenity:police', osmKey: 'amenity', osmValue: 'police', googleTypes: ['police'] },
  { key: 'hotel', label: 'Hotel', match: /\b(hotel|lodge|guest house|guesthouse)\b/, photonTag: 'tourism:hotel', osmKey: 'tourism', osmValue: 'hotel', googleTypes: ['hotel'] },
  { key: 'supermarket', label: 'Supermarket', match: /\b(supermarket|grocery)\b/, photonTag: 'shop:supermarket', osmKey: 'shop', osmValue: 'supermarket', googleTypes: ['supermarket'] },
  { key: 'market', label: 'Market', match: /\b(market|marketplace)\b/, photonTag: 'amenity:marketplace', osmKey: 'amenity', osmValue: 'marketplace', googleTypes: ['market'] },
  { key: 'school', label: 'School', match: /\b(school|primary school|secondary school)\b/, photonTag: 'amenity:school', osmKey: 'amenity', osmValue: 'school', googleTypes: ['school'] },
  { key: 'university', label: 'University', match: /\b(university|college)\b/, photonTag: 'amenity:university', osmKey: 'amenity', osmValue: 'university', googleTypes: ['university'] }
];

export const placeCategories = CATEGORY_DEFINITIONS.map(({ key, label }) => ({ key, label }));

const categoryFor = value => {
  const normalized = normalizePlaceText(value);
  return CATEGORY_DEFINITIONS.find(item => item.key === normalized || item.match.test(normalized)) || null;
};

const isUgandaCoordinate = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= -1.6 && lat <= 4.4 && lng >= 29.3 && lng <= 35.1;

export const placeDistanceM = (aLat, aLng, bLat, bLng) => {
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
  const q = normalizePlaceText(query);
  const name = normalizePlaceText(item.name);
  const detail = normalizePlaceText(item.displayName || item.detail || item.formatted_address || '');
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

const sourceBoost = source => ({
  memory: 190,
  saved_place: 185,
  traffiq: 150,
  google: 65,
  photon: 35,
  nominatim: 25,
  'osm-overpass': 30
}[source] || 0);

const providerCache = new Map();
const cacheGet = key => {
  const row = providerCache.get(key);
  if (!row || row.expiresAt <= Date.now()) {
    providerCache.delete(key);
    return null;
  }
  return row.value;
};
const cacheSet = (key, value) => {
  providerCache.set(key, { value, expiresAt: Date.now() + Math.max(config.placeSearchCacheSeconds, 5) * 1000 });
  if (providerCache.size > 500) {
    const first = providerCache.keys().next().value;
    if (first) providerCache.delete(first);
  }
};

const rankPlaces = (items, { q = '', lat, lng, limit = 8, maxDistanceM = null, allowMissingCoordinates = false }) => {
  const seen = new Set();
  return items
    .filter(item => item?.name && (allowMissingCoordinates || (Number.isFinite(item.lat) && Number.isFinite(item.lng))))
    .map(item => {
      const metres = Number.isFinite(item.distance_m)
        ? Number(item.distance_m)
        : placeDistanceM(lat, lng, Number(item.lat), Number(item.lng));
      const countryCode = String(item.address?.country_code || item.address?.countrycode || item.country_code || '').toLowerCase();
      const proximity = metres == null ? 0 : 280 / (1 + metres / 4000);
      const ugandaBoost = countryCode === 'ug' ? 60 : 0;
      const namedPoiBoost = item.category && !['place', 'boundary'].includes(String(item.category).toLowerCase()) ? 35 : 0;
      return {
        ...item,
        distance_m: metres == null ? null : Math.round(metres),
        _score: textScore(q, item) + proximity + ugandaBoost + namedPoiBoost + sourceBoost(item.source)
      };
    })
    .filter(item => maxDistanceM == null || item.distance_m == null || item.distance_m <= maxDistanceM)
    .sort((a, b) => b._score - a._score || (a.distance_m ?? Number.MAX_SAFE_INTEGER) - (b.distance_m ?? Number.MAX_SAFE_INTEGER))
    .filter(item => {
      const providerKey = item.provider_place_id ? `${item.source}:${item.provider_place_id}` : null;
      const geoKey = Number.isFinite(item.lat) && Number.isFinite(item.lng)
        ? `${normalizePlaceText(item.name)}|${Number(item.lat).toFixed(4)}|${Number(item.lng).toFixed(4)}`
        : `${normalizePlaceText(item.name)}|${normalizePlaceText(item.detail || item.displayName || '')}`;
      const key = providerKey || geoKey;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.min(Math.max(Number(limit) || 8, 1), 20))
    .map(({ _score, ...item }) => item);
};

async function searchFirstParty({ userId, q, lat, lng, limit }) {
  const normalized = normalizePlaceText(q);
  if (!normalized) return [];
  const rows = [];

  if (userId) {
    const memory = await dbQuery(
      `SELECT id, label, lat, lng, category, formatted_address, provider, provider_place_id,
              source, use_count, last_used_at,
              GREATEST(similarity(normalized_label, $2), CASE WHEN normalized_label LIKE $2 || '%' THEN 0.9 ELSE 0 END) AS sim
         FROM user_place_memory
        WHERE user_id = $1
          AND (normalized_label % $2 OR normalized_label LIKE $2 || '%' OR normalized_label LIKE '%' || $2 || '%')
        ORDER BY sim DESC, use_count DESC, last_used_at DESC
        LIMIT $3`,
      [userId, normalized, Math.min(limit * 2, 20)]
    );
    rows.push(...memory.rows.map(item => ({
      id: `memory:${item.id}`,
      provider_place_id: item.provider_place_id || String(item.id),
      name: item.label,
      displayName: item.formatted_address || item.label,
      detail: item.formatted_address || null,
      formatted_address: item.formatted_address || null,
      lat: Number(item.lat),
      lng: Number(item.lng),
      type: item.category || null,
      category: item.category || null,
      address: {},
      source: 'memory',
      memory_source: item.source,
      use_count: Number(item.use_count || 0)
    })));
  }

  const shared = await dbQuery(
    `SELECT p.*,
            GREATEST(
              similarity(p.normalized_name, $1),
              COALESCE(MAX(similarity(a.normalized_alias, $1)), 0),
              CASE WHEN p.normalized_name LIKE $1 || '%' THEN 0.95 ELSE 0 END
            ) AS sim
       FROM traffiq_places p
       LEFT JOIN traffiq_place_aliases a ON a.place_id = p.id
      WHERE p.visibility = 'public'
        AND (
          p.normalized_name % $1 OR p.normalized_name LIKE $1 || '%' OR p.normalized_name LIKE '%' || $1 || '%'
          OR a.normalized_alias % $1 OR a.normalized_alias LIKE $1 || '%' OR a.normalized_alias LIKE '%' || $1 || '%'
        )
      GROUP BY p.id
      ORDER BY sim DESC, p.selection_count DESC, p.journey_count DESC
      LIMIT $2`,
    [normalized, Math.min(limit * 2, 20)]
  );
  rows.push(...shared.rows.map(item => ({
    id: `traffiq:${item.id}`,
    provider_place_id: String(item.id),
    name: item.canonical_name,
    displayName: [item.locality, item.city, item.district, item.country].filter(Boolean).join(', ') || item.canonical_name,
    detail: [item.locality, item.city, item.district, item.country].filter(Boolean).join(', ') || null,
    formatted_address: [item.locality, item.city, item.district, item.country].filter(Boolean).join(', ') || null,
    lat: Number(item.lat),
    lng: Number(item.lng),
    type: item.category || null,
    category: item.category || null,
    address: { city: item.city, county: item.district, country: item.country, country_code: item.country_code },
    source: 'traffiq',
    verified: item.verified,
    confidence: Number(item.confidence)
  })));

  return rankPlaces(rows, { q, lat, lng, limit });
}

async function searchNominatim({ q, lat, lng, limit }) {
  const cacheKey = `n:${normalizePlaceText(q)}:${Number(lat).toFixed(2)}:${Number(lng).toFixed(2)}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = new URL('/search', config.geocodingBaseUrl);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('namedetails', '1');
  url.searchParams.set('dedupe', '1');
  url.searchParams.set('limit', String(Math.min(Math.max(limit * 2, 8), 20)));
  if (isUgandaCoordinate(lat, lng)) url.searchParams.set('countrycodes', 'ug');
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
  const result = (Array.isArray(rows) ? rows : []).map(item => ({
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
  cacheSet(cacheKey, result);
  return result;
}

async function searchPhoton({ q, lat, lng, limit }) {
  const category = categoryFor(q);
  const cacheKey = `p:${normalizePlaceText(q)}:${category?.key || ''}:${Number(lat).toFixed(2)}:${Number(lng).toFixed(2)}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = new URL('/api/', config.photonBaseUrl);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(Math.min(Math.max(limit * 2, 8), 20)));
  url.searchParams.set('lang', 'en');
  if (category?.photonTag) url.searchParams.set('osm_tag', category.photonTag);
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
  const result = features.map(feature => {
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
  cacheSet(cacheKey, result);
  return result;
}

async function searchOverpassNearby({ category, lat, lng, radiusM, limit }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const definition = categoryFor(category);
  if (!definition) return [];
  const radius = Math.min(Math.max(Number(radiusM) || 25000, 500), 50000);
  const cacheKey = `o:${definition.key}:${Number(lat).toFixed(2)}:${Number(lng).toFixed(2)}:${Math.round(radius / 1000)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const overpass = `[out:json][timeout:8];(nwr(around:${Math.round(radius)},${lat},${lng})["${definition.osmKey}"="${definition.osmValue}"];);out center tags ${Math.min(Math.max(limit * 4, 20), 80)};`;
  const response = await fetch(config.overpassBaseUrl, {
    method: 'POST',
    headers: {
      'User-Agent': config.geocodingUserAgent,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body: new URLSearchParams({ data: overpass }),
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error(`overpass returned ${response.status}`);
  const body = await response.json();
  const result = (Array.isArray(body?.elements) ? body.elements : []).map(element => {
    const tags = element.tags || {};
    const itemLat = Number(element.lat ?? element.center?.lat);
    const itemLng = Number(element.lon ?? element.center?.lon);
    const name = tags.name || tags.brand || tags.operator || `${definition.label}`;
    const locality = tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || tags['addr:suburb'] || null;
    const road = tags['addr:street'] || null;
    const formatted = [name, road, locality, 'Uganda'].filter(Boolean).join(', ');
    return {
      id: `osm-overpass:${element.type}:${element.id}`,
      provider_place_id: `${element.type}/${element.id}`,
      name,
      displayName: formatted,
      detail: [road, locality].filter(Boolean).join(', ') || null,
      formatted_address: formatted,
      lat: itemLat,
      lng: itemLng,
      type: definition.osmValue,
      category: definition.key,
      address: { road, city: locality, country: 'Uganda', country_code: 'ug' },
      source: 'osm-overpass',
      named: Boolean(tags.name || tags.brand || tags.operator)
    };
  }).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));
  cacheSet(cacheKey, result);
  return result;
}

const googleEnabled = () => Boolean(config.googlePlacesApiKey);
const googleAllowed = mapProvider => googleEnabled() && String(mapProvider || '').toLowerCase() === 'google';

async function googleAutocomplete({ q, lat, lng, limit, sessionToken }) {
  if (!googleEnabled()) return [];
  const body = {
    input: q,
    languageCode: 'en',
    regionCode: 'UG',
    includedRegionCodes: ['ug']
  };
  if (sessionToken) body.sessionToken = sessionToken;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    body.origin = { latitude: lat, longitude: lng };
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 50000
      }
    };
  }
  const response = await fetch(`${config.googlePlacesBaseUrl.replace(/\/$/, '')}/places:autocomplete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.googlePlacesApiKey,
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text,suggestions.placePrediction.types,suggestions.placePrediction.distanceMeters'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6500)
  });
  if (!response.ok) throw new Error(`google autocomplete returned ${response.status}`);
  const data = await response.json();
  return (Array.isArray(data?.suggestions) ? data.suggestions : [])
    .map(item => item.placePrediction)
    .filter(Boolean)
    .slice(0, limit)
    .map(prediction => ({
      id: `google:${prediction.placeId}`,
      provider_place_id: prediction.placeId,
      name: prediction.structuredFormat?.mainText?.text || prediction.text?.text || 'Place',
      displayName: prediction.text?.text || prediction.structuredFormat?.mainText?.text || null,
      detail: prediction.structuredFormat?.secondaryText?.text || null,
      formatted_address: null,
      lat: null,
      lng: null,
      type: prediction.types?.[0] || null,
      category: prediction.types?.[0] || null,
      address: { country_code: 'ug' },
      source: 'google',
      distance_m: Number.isFinite(prediction.distanceMeters) ? Number(prediction.distanceMeters) : null,
      requires_resolution: true,
      attribution: 'Google Maps'
    }));
}

async function googleNearby({ category, lat, lng, radiusM, limit }) {
  if (!googleEnabled() || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const definition = categoryFor(category);
  if (!definition) return [];
  const body = {
    includedTypes: definition.googleTypes,
    maxResultCount: Math.min(Math.max(Number(limit) || 10, 1), 20),
    rankPreference: 'DISTANCE',
    languageCode: 'en',
    regionCode: 'UG',
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: Math.min(Math.max(Number(radiusM) || 25000, 500), 50000)
      }
    }
  };
  const response = await fetch(`${config.googlePlacesBaseUrl.replace(/\/$/, '')}/places:searchNearby`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.googlePlacesApiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error(`google nearby returned ${response.status}`);
  const data = await response.json();
  return (Array.isArray(data?.places) ? data.places : []).map(place => ({
    id: `google:${place.id}`,
    provider_place_id: place.id,
    name: place.displayName?.text || 'Place',
    displayName: place.formattedAddress || place.displayName?.text || null,
    detail: place.formattedAddress || null,
    formatted_address: place.formattedAddress || null,
    lat: Number(place.location?.latitude),
    lng: Number(place.location?.longitude),
    type: place.types?.[0] || null,
    category: definition.key,
    address: { country_code: 'ug' },
    source: 'google',
    attribution: 'Google Maps'
  })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

async function googlePlaceDetails(providerPlaceId, sessionToken) {
  if (!googleEnabled()) return null;
  const url = new URL(`${config.googlePlacesBaseUrl.replace(/\/$/, '')}/places/${encodeURIComponent(providerPlaceId)}`);
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken);
  const response = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': config.googlePlacesApiKey,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,types'
    },
    signal: AbortSignal.timeout(6500)
  });
  if (!response.ok) throw new Error(`google place details returned ${response.status}`);
  const place = await response.json();
  return {
    id: `google:${place.id}`,
    provider_place_id: place.id,
    name: place.displayName?.text || 'Place',
    displayName: place.formattedAddress || place.displayName?.text || null,
    detail: place.formattedAddress || null,
    formatted_address: place.formattedAddress || null,
    lat: Number(place.location?.latitude),
    lng: Number(place.location?.longitude),
    type: place.types?.[0] || null,
    category: place.types?.[0] || null,
    address: { country_code: 'ug' },
    source: 'google',
    requires_resolution: false,
    attribution: 'Google Maps'
  };
}

export async function searchPlaces({ q, lat, lng, limit = 8, userId = null }) {
  const searchText = String(q || '').trim();
  if (searchText.length < 2) return [];
  const requested = Math.min(Math.max(Number(limit) || 8, 1), 10);
  const providers = await Promise.allSettled([
    searchFirstParty({ userId, q: searchText, lat, lng, limit: requested }),
    searchPhoton({ q: searchText, lat, lng, limit: requested }),
    searchNominatim({ q: searchText, lat, lng, limit: requested })
  ]);
  const items = providers.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  if (!items.length && providers.every(result => result.status === 'rejected')) {
    throw new Error('place search providers unavailable');
  }
  return rankPlaces(items, { q: searchText, lat, lng, limit: requested });
}

export async function autocompletePlaces({ userId, q, lat, lng, limit = 8, mapProvider = 'open', sessionToken = null }) {
  const searchText = String(q || '').trim();
  if (searchText.length < 2) return { results: [], providers: [], google_enabled: googleEnabled() };
  const requested = Math.min(Math.max(Number(limit) || 8, 1), 10);
  const work = [
    searchFirstParty({ userId, q: searchText, lat, lng, limit: requested }),
    searchPhoton({ q: searchText, lat, lng, limit: requested }),
    searchNominatim({ q: searchText, lat, lng, limit: requested })
  ];
  if (googleAllowed(mapProvider)) work.unshift(googleAutocomplete({ q: searchText, lat, lng, limit: requested, sessionToken }));
  const settled = await Promise.allSettled(work);
  const results = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const ranked = rankPlaces(results, { q: searchText, lat, lng, limit: requested, allowMissingCoordinates: true });
  return {
    results: ranked,
    providers: [...new Set(ranked.map(item => item.source))],
    google_enabled: googleEnabled(),
    google_used: ranked.some(item => item.source === 'google')
  };
}

export async function nearbyPlaces({ userId, category, lat, lng, radiusM = 25000, limit = 12, mapProvider = 'open' }) {
  const definition = categoryFor(category);
  if (!definition) throw Object.assign(new Error('unsupported_place_category'), { status: 400 });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw Object.assign(new Error('lat_and_lng_required'), { status: 400 });
  const requested = Math.min(Math.max(Number(limit) || 12, 1), 20);
  const radius = Math.min(Math.max(Number(radiusM) || 25000, 500), 50000);
  const work = [
    searchFirstParty({ userId, q: definition.label, lat, lng, limit: requested }),
    searchOverpassNearby({ category: definition.key, lat, lng, radiusM: radius, limit: requested }),
    searchPhoton({ q: definition.label, lat, lng, limit: requested })
  ];
  if (googleAllowed(mapProvider)) work.unshift(googleNearby({ category: definition.key, lat, lng, radiusM: radius, limit: requested }));
  const settled = await Promise.allSettled(work);
  const results = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const ranked = rankPlaces(results, {
    q: definition.label,
    lat,
    lng,
    limit: requested,
    maxDistanceM: radius
  });
  return {
    category: { key: definition.key, label: definition.label },
    radius_m: radius,
    results: ranked,
    providers: [...new Set(ranked.map(item => item.source))],
    google_enabled: googleEnabled(),
    google_used: ranked.some(item => item.source === 'google')
  };
}

export async function resolvePlace({ userId, id, provider, providerPlaceId, sessionToken = null }) {
  const source = String(provider || id?.split(':')?.[0] || '').toLowerCase();
  const providerId = String(providerPlaceId || (source === 'google' ? id?.slice('google:'.length) : '') || '');
  if (source === 'google') return googlePlaceDetails(providerId, sessionToken);

  if (source === 'traffiq') {
    const placeId = id?.replace(/^traffiq:/, '') || providerId;
    const result = await dbQuery('SELECT * FROM traffiq_places WHERE id=$1 AND visibility=$2', [placeId, 'public']);
    const item = result.rows[0];
    if (!item) return null;
    return {
      id: `traffiq:${item.id}`,
      provider_place_id: String(item.id),
      name: item.canonical_name,
      displayName: [item.locality, item.city, item.district, item.country].filter(Boolean).join(', ') || item.canonical_name,
      detail: [item.locality, item.city, item.district, item.country].filter(Boolean).join(', ') || null,
      formatted_address: [item.locality, item.city, item.district, item.country].filter(Boolean).join(', ') || null,
      lat: Number(item.lat),
      lng: Number(item.lng),
      type: item.category,
      category: item.category,
      source: 'traffiq',
      verified: item.verified
    };
  }

  if (source === 'memory' && userId) {
    const placeId = id?.replace(/^memory:/, '') || providerId;
    const result = await dbQuery('SELECT * FROM user_place_memory WHERE id=$1 AND user_id=$2', [placeId, userId]);
    const item = result.rows[0];
    if (!item) return null;
    return {
      id: `memory:${item.id}`,
      provider_place_id: item.provider_place_id || String(item.id),
      name: item.label,
      displayName: item.formatted_address || item.label,
      detail: item.formatted_address,
      formatted_address: item.formatted_address,
      lat: Number(item.lat),
      lng: Number(item.lng),
      type: item.category,
      category: item.category,
      source: 'memory'
    };
  }

  return null;
}

export async function recentPlaces({ userId, limit = 8 }) {
  if (!userId) return [];
  const requested = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const rows = await dbQuery(
    `SELECT id, label, lat, lng, category, formatted_address, provider, provider_place_id,
            source, use_count, last_used_at
       FROM user_place_memory
      WHERE user_id=$1
      ORDER BY last_used_at DESC, use_count DESC
      LIMIT $2`,
    [userId, requested]
  );
  return rows.rows.map(item => ({
    id: `memory:${item.id}`,
    provider_place_id: item.provider_place_id || String(item.id),
    name: item.label,
    displayName: item.formatted_address || item.label,
    detail: item.formatted_address || null,
    formatted_address: item.formatted_address || null,
    lat: Number(item.lat),
    lng: Number(item.lng),
    type: item.category,
    category: item.category,
    source: 'memory',
    use_count: Number(item.use_count || 0),
    last_used_at: item.last_used_at
  }));
}

const roundedBucket = (value, places = 2) => Number.isFinite(value) ? Number(Number(value).toFixed(places)) : null;

export async function recordPlaceSearch({ userId, q, lat, lng, provider, resultCount, latencyMs, metadata = {} }) {
  const eventType = Number(resultCount) === 0 ? 'zero_result' : 'search';
  await dbQuery(
    `INSERT INTO place_search_events(user_id,event_type,query,normalized_query,lat_bucket,lng_bucket,provider,result_count,latency_ms,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [userId || null, eventType, q || null, normalizePlaceText(q || ''), roundedBucket(lat), roundedBucket(lng), provider || null, Number(resultCount) || 0, Number(latencyMs) || null, JSON.stringify(metadata || {})]
  );
}

export async function recordPlaceSelection({ userId, q, lat, lng, result }) {
  if (!userId || !result) return;
  const provider = String(result.source || result.provider || '').toLowerCase();
  const providerPlaceId = result.provider_place_id || result.providerPlaceId || null;
  const placeId = provider === 'traffiq' ? String(result.id || '').replace(/^traffiq:/, '') : null;
  await dbQuery(
    `INSERT INTO place_search_events(user_id,event_type,query,normalized_query,lat_bucket,lng_bucket,provider,result_count,selected_place_id,selected_provider,selected_provider_place_id,metadata)
     VALUES($1,'selection',$2,$3,$4,$5,$6,1,$7,$6,$8,$9::jsonb)`,
    [userId, q || null, normalizePlaceText(q || ''), roundedBucket(lat), roundedBucket(lng), provider || null, placeId || null, providerPlaceId, JSON.stringify({ category: result.category || null })]
  );

  if (placeId) {
    await dbQuery(
      `UPDATE traffiq_places
          SET selection_count=selection_count+1,last_selected_at=now(),updated_at=now()
        WHERE id=$1`,
      [placeId]
    );
  }

  if (provider === 'memory') {
    const memoryId = String(result.id || '').replace(/^memory:/, '');
    await dbQuery(
      `UPDATE user_place_memory SET use_count=use_count+1,last_used_at=now(),updated_at=now()
        WHERE id=$1 AND user_id=$2`,
      [memoryId, userId]
    );
    return;
  }

  // Google Places content is deliberately not cached into TraffIQ's place
  // memory. Only the provider ID is retained in the analytics event above.
  if (provider === 'google') return;

  const name = String(result.name || '').trim();
  const itemLat = Number(result.lat);
  const itemLng = Number(result.lng);
  if (!name || !Number.isFinite(itemLat) || !Number.isFinite(itemLng)) return;
  const normalized = normalizePlaceText(name);
  await dbQuery(
    `INSERT INTO user_place_memory(user_id,label,normalized_label,lat,lng,category,formatted_address,provider,provider_place_id,source,use_count,last_used_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'selection',1,now())
     ON CONFLICT (user_id, normalized_label, lat, lng) DO UPDATE
       SET use_count=user_place_memory.use_count+1,last_used_at=now(),updated_at=now(),
           provider=COALESCE(EXCLUDED.provider,user_place_memory.provider),
           provider_place_id=COALESCE(EXCLUDED.provider_place_id,user_place_memory.provider_place_id),
           formatted_address=COALESCE(EXCLUDED.formatted_address,user_place_memory.formatted_address)`,
    [userId, name, normalized, itemLat, itemLng, result.category || null, result.formatted_address || result.detail || null, provider || null, providerPlaceId]
  );
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
