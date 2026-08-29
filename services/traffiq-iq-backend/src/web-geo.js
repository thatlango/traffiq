import { authenticate } from './auth.js';
import { config } from './config.js';
import { searchPlaces } from './geo.js';

const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });
const fail = (res, status, code, message) => res.status(status).json({ data: null, error: { code, message, details: null } });

export function registerWebGeo(app) {
  const searchHandler = async (req, res, next, wrapped = true) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) return wrapped ? ok(res, []) : res.json({ results: [] });
      const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 10);
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const results = await searchPlaces({
        q,
        lat: Number.isFinite(lat) ? lat : undefined,
        lng: Number.isFinite(lng) ? lng : undefined,
        limit
      });
      return wrapped ? ok(res, results) : res.json({ results });
    } catch (error) {
      if (String(error.message).includes('providers unavailable')) {
        return fail(res, 502, 'geocoder_unavailable', 'Place search is temporarily unavailable');
      }
      next(error);
    }
  };

  app.get('/v1/web/places/search', authenticate, (req, res, next) => searchHandler(req, res, next, true));
  // Same contract as the primary API. This makes the Android /mobile/v1/geo/search
  // path work through Caddy after /mobile is stripped.
  app.get('/v1/geo/search', authenticate, (req, res, next) => searchHandler(req, res, next, false));

  app.post('/v1/web/roads/snap', authenticate, async (req, res, next) => {
    try {
      const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, 400, 'validation_error', 'lat and lng are required');
      const base = config.routingBaseUrl.replace(/\/$/, '');
      const response = await fetch(`${base}/nearest/v1/driving/${lng},${lat}?number=1`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return ok(res, { lat: null, lng: null });
      const body = await response.json();
      const location = body?.waypoints?.[0]?.location;
      if (!Array.isArray(location) || location.length < 2) return ok(res, { lat: null, lng: null });
      const snappedLng = Number(location[0]), snappedLat = Number(location[1]);
      if (!Number.isFinite(snappedLat) || !Number.isFinite(snappedLng)) return ok(res, { lat: null, lng: null });
      ok(res, { lat: snappedLat, lng: snappedLng, provider: 'osrm' });
    } catch (_error) {
      ok(res, { lat: null, lng: null });
    }
  });
}
