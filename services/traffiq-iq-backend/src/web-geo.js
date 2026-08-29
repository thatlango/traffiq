import { authenticate } from './auth.js';
import { config } from './config.js';

const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });
const fail = (res, status, code, message) => res.status(status).json({ data: null, error: { code, message, details: null } });

export function registerWebGeo(app) {
  app.get('/v1/web/places/search', authenticate, async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) return ok(res, []);
      const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 10);
      const params = new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', limit: String(limit), dedupe: '1' });
      const lat = Number(req.query.lat), lng = Number(req.query.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const delta = 1.5;
        params.set('viewbox', `${lng - delta},${lat + delta},${lng + delta},${lat - delta}`);
        params.set('bounded', '0');
      }
      const response = await fetch(`${config.geocodingBaseUrl.replace(/\/$/, '')}/search?${params.toString()}`, {
        headers: { 'User-Agent': config.geocodingUserAgent, 'Accept-Language': 'en', Accept: 'application/json' },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) return fail(res, 502, 'geocoder_unavailable', 'Place search is temporarily unavailable');
      const rows = await response.json();
      ok(res, (Array.isArray(rows) ? rows : []).map(row => ({
        provider_place_id: String(row.place_id || ''),
        name: row.name || row.display_name?.split(',')?.[0] || 'Place',
        detail: row.display_name || null,
        formatted_address: row.display_name || null,
        lat: Number(row.lat),
        lng: Number(row.lon),
        source: 'nominatim',
      })).filter(row => Number.isFinite(row.lat) && Number.isFinite(row.lng)));
    } catch (error) { next(error); }
  });

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
