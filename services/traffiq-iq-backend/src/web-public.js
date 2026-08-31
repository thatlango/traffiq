import { query } from './db.js';
import { config } from './config.js';

const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });
const fail = (res, status, code, message) => res.status(status).json({ data: null, error: { code, message, details: null } });

const webType = value => {
  switch (String(value || 'other').toLowerCase()) {
    case 'traffic': return 'Traffic';
    case 'police': return 'Police';
    case 'accident': return 'Accident';
    case 'reckless_driving': return 'Reckless driving';
    case 'recklessdriving': return 'Reckless driving';
    case 'construction': return 'Roadwork';
    case 'closure': return 'Closure';
    default: return 'Hazard';
  }
};

async function reverseGeocode(lat, lng) {
  const key = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  const cached = await query('SELECT name FROM place_name_cache WHERE cache_key=$1 AND expires_at>now()', [key]);
  if (cached.rowCount) return cached.rows[0].name;

  try {
    const params = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lng), zoom: '17', addressdetails: '1' });
    const response = await fetch(`${config.geocodingBaseUrl.replace(/\/$/, '')}/reverse?${params.toString()}`, {
      headers: { 'User-Agent': config.geocodingUserAgent, 'Accept-Language': 'en', Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error('reverse_geocode_failed');
    const body = await response.json();
    const a = body?.address || {};
    const name = a.attraction || a.tourism || a.building || a.amenity || a.road || a.pedestrian || a.neighbourhood || a.suburb || a.village || a.town || a.city_district || a.city || a.county || body?.name || body?.display_name?.split(',')?.[0] || key;
    await query(`
      INSERT INTO place_name_cache(cache_key,name,lat,lng,source,updated_at,expires_at)
      VALUES($1,$2,$3,$4,'nominatim',now(),now()+interval '90 days')
      ON CONFLICT(cache_key) DO UPDATE SET name=EXCLUDED.name,lat=EXCLUDED.lat,lng=EXCLUDED.lng,updated_at=now(),expires_at=now()+interval '90 days'
    `, [key, String(name), Number(lat), Number(lng)]);
    return String(name);
  } catch {
    return key;
  }
}

export function registerWebPublic(app) {
  app.get('/v1/web/public/incidents/:id', async (req, res, next) => {
    try {
      const r = await query(`
        SELECT i.*, (
          SELECT media_url FROM incident_evidence e
          WHERE e.incident_id=i.id AND e.media_type='image'
          ORDER BY e.created_at DESC LIMIT 1
        ) photo_url
        FROM incidents i
        WHERE i.id=$1 AND i.status='active' AND (i.expires_at IS NULL OR i.expires_at>now())
        LIMIT 1
      `, [req.params.id]);
      if (!r.rowCount) return fail(res, 404, 'not_found', 'Incident not found');
      const row = r.rows[0];
      const place = await reverseGeocode(row.lat, row.lng);
      ok(res, {
        id: row.id,
        type: webType(row.type),
        lat: row.lat,
        lng: row.lng,
        note: row.description,
        photo_url: row.photo_url || null,
        created_at: row.created_at,
        expires_at: row.expires_at,
        place,
      });
    } catch (error) { next(error); }
  });
}