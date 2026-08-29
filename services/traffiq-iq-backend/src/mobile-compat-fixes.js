import { authenticate } from './auth.js';
import { query } from './db.js';

const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });
const fail = (res, status, code, message) => res.status(status).json({ data: null, error: { code, message, details: null } });
const modeMap = (raw = 'car') => {
  const value = String(raw).toLowerCase();
  if (['motorcycle','boda','boda_boda'].includes(value)) return 'motorcycle';
  if (['taxi','matatu'].includes(value)) return 'taxi';
  if (['bus','truck','bicycle','walking','other','car'].includes(value)) return value;
  return 'car';
};
const toJourneyDto = row => ({
  id: row.id,
  client_journey_id: row.client_id,
  user_id: row.user_id,
  vehicle: row.mode,
  transport_mode: row.mode,
  journey_role: row.journey_role,
  purpose: row.purpose,
  journey_mode: row.mode,
  origin_lat: row.origin_lat,
  origin_lng: row.origin_lng,
  origin_label: row.origin_name,
  destination_lat: row.destination_lat,
  destination_lng: row.destination_lng,
  destination_label: row.destination_name,
  prefer_safe: row.prefer_safe,
  prefer_paved: row.prefer_paved,
  started_at: row.started_at || row.created_at,
  ended_at: row.ended_at,
  distance_m: Number(row.distance_m || 0),
  duration_s: Number(row.duration_s || 0),
  last_activity_at: row.last_location_at || row.updated_at,
  end_reason: row.end_reason
});
const saved = p => ({
  id: p.id,
  user_id: p.user_id,
  label: p.label,
  kind: p.kind,
  formatted_address: p.formatted_address,
  lat: p.lat,
  lng: p.lng,
  provider_place_id: p.provider_place_id,
  is_favorite: p.is_favorite,
  is_suggested: p.is_suggested,
  source: p.source,
  created_at: p.created_at,
  updated_at: p.updated_at
});

export function registerMobileCompatibilityFixes(app) {
  // Register literal collection routes before the broad /:id compatibility routes.
  // These shapes intentionally match the Android kotlinx.serialization models.
  app.post('/v1/journeys', authenticate, async (req, res, next) => { try {
    const b = req.body || {};
    if (!b.client_journey_id) return fail(res, 400, 'validation_error', 'client_journey_id is required');
    const r = await query(`INSERT INTO journeys(user_id,client_id,mode,status,journey_role,purpose,origin_name,origin_lat,origin_lng,destination_name,destination_lat,destination_lng,prefer_safe,prefer_paved,started_at,distance_m,duration_s)
      VALUES($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,0)
      ON CONFLICT(user_id,client_id) DO UPDATE SET updated_at=now() RETURNING *`, [
      req.user.id,
      b.client_journey_id,
      modeMap(b.vehicle || b.transport_mode || b.journey_mode),
      b.role || b.journey_role || null,
      b.purpose || 'personal',
      b.origin_label || null,
      b.origin?.lat ?? b.origin_lat ?? null,
      b.origin?.lng ?? b.origin_lng ?? null,
      b.destination_label || null,
      b.destination?.lat ?? b.destination_lat ?? null,
      b.destination?.lng ?? b.destination_lng ?? null,
      !!b.prefer_safe,
      !!b.prefer_paved,
      b.started_at || new Date()
    ]);
    ok(res, toJourneyDto(r.rows[0]), 201);
  } catch (e) { next(e); } });

  app.get('/v1/incidents/nearby', authenticate, async (req, res, next) => { try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Math.min(Number(req.query.radius_m || 10000), 50000);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, 400, 'validation_error', 'lat and lng are required');
    const latDelta = radius / 111320;
    const lngDelta = radius / Math.max(111320 * Math.cos(lat * Math.PI / 180), 1);
    const r = await query(`SELECT * FROM (
      SELECT i.*,
        (6371000*2*asin(sqrt(power(sin(radians(i.lat-$1)/2),2)+cos(radians($1))*cos(radians(i.lat))*power(sin(radians(i.lng-$2)/2),2)))) distance_m,
        (SELECT media_url FROM incident_evidence e WHERE e.incident_id=i.id AND e.media_type='image' ORDER BY e.created_at DESC LIMIT 1) photo_url
      FROM incidents i
      WHERE i.status='active' AND (i.expires_at IS NULL OR i.expires_at>now())
        AND i.lat BETWEEN $1-$4 AND $1+$4 AND i.lng BETWEEN $2-$5 AND $2+$5
    ) x WHERE distance_m<=$3 ORDER BY distance_m,occurred_at DESC LIMIT 200`, [lat, lng, radius, latDelta, lngDelta]);
    ok(res, r.rows);
  } catch (e) { next(e); } });

  app.get('/v1/sync/capabilities', authenticate, (_req, res) => ok(res, {
    server_time: new Date().toISOString(),
    max_location_batch: 500,
    supports: {
      journey_sync: true,
      location_batch: true,
      incident_sync: true,
      sharing: true,
      saved_places: true,
      trusted_people: true
    }
  }));

  app.get('/v1/saved-places', authenticate, async (req, res, next) => { try {
    const r = await query('SELECT * FROM saved_places WHERE user_id=$1 ORDER BY updated_at DESC', [req.user.id]);
    ok(res, r.rows.map(saved));
  } catch (e) { next(e); } });

  app.post('/v1/saved-places', authenticate, async (req, res, next) => { try {
    const b = req.body || {};
    const r = await query(`INSERT INTO saved_places(user_id,label,kind,formatted_address,lat,lng,provider_place_id,is_favorite,is_suggested,source)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [req.user.id,b.label,b.kind||'custom',b.formatted_address||null,b.lat,b.lng,b.provider_place_id||null,!!b.is_favorite,!!b.is_suggested,b.source||'manual']);
    ok(res, saved(r.rows[0]), 201);
  } catch (e) { next(e); } });

  app.patch('/v1/saved-places/:id', authenticate, async (req, res, next) => { try {
    const b = req.body || {};
    const r = await query(`UPDATE saved_places SET label=$3,kind=$4,formatted_address=$5,lat=$6,lng=$7,provider_place_id=$8,is_favorite=COALESCE($9,is_favorite),is_suggested=COALESCE($10,is_suggested),source=COALESCE($11,source),updated_at=now()
      WHERE id=$1 AND user_id=$2 RETURNING *`, [req.params.id,req.user.id,b.label,b.kind||'custom',b.formatted_address||null,b.lat,b.lng,b.provider_place_id||null,b.is_favorite,b.is_suggested,b.source||null]);
    if (!r.rowCount) return fail(res,404,'not_found','Saved place not found');
    ok(res, saved(r.rows[0]));
  } catch (e) { next(e); } });

  app.delete('/v1/saved-places/:id', authenticate, async (req, res, next) => { try {
    await query('DELETE FROM saved_places WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    ok(res, null);
  } catch (e) { next(e); } });
}
