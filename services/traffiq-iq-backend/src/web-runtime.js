import { randomUUID } from 'node:crypto';
import { authenticate, sha256 } from './auth.js';
import { query } from './db.js';
import { config } from './config.js';

const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });
const fail = (res, status, code, message, details = null) => res.status(status).json({ data: null, error: { code, message, details } });

const incidentDto = row => ({
  id: row.id,
  client_incident_id: row.client_id,
  user_id: row.user_id,
  journey_id: row.journey_id,
  type: row.type,
  lat: row.lat,
  lng: row.lng,
  note: row.description,
  severity: row.severity,
  road_impact: row.metadata?.roadImpact || null,
  photo_url: row.photo_url || null,
  public_photo_url: row.photo_url || null,
  created_at: row.created_at,
  updated_at: row.updated_at,
  expires_at: row.expires_at,
  status: row.status,
  confirmation_count: Number(row.confirmations || 0),
  rejection_count: Number(row.disputes || 0),
  is_public: row.status === 'active',
});

const savedPlaceDto = row => ({
  id: row.id,
  user_id: row.user_id,
  label: row.label,
  kind: row.kind,
  lat: row.lat,
  lng: row.lng,
  formatted_address: row.formatted_address,
  provider_place_id: row.provider_place_id,
  visit_count: Number(row.visit_count || 0),
  last_visited_at: row.last_visited_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const journeyDto = row => ({
  id: row.id,
  user_id: row.user_id,
  vehicle: row.mode,
  transport_mode: row.mode,
  journey_role: row.journey_role,
  purpose: row.purpose,
  journey_mode: row.mode,
  started_at: row.started_at || row.created_at,
  ended_at: row.ended_at,
  origin_lat: row.origin_lat,
  origin_lng: row.origin_lng,
  origin_label: row.origin_name,
  destination_lat: row.destination_lat,
  destination_lng: row.destination_lng,
  destination_label: row.destination_name,
  distance_m: Number(row.distance_m || 0),
  duration_s: Number(row.duration_s || 0),
  average_speed_mps: Number(row.avg_speed_mps || 0),
  max_speed_mps: Number(row.max_speed_mps || 0),
  status: row.status,
});

async function latestIncidents() {
  return query(`
    SELECT i.*, (
      SELECT media_url FROM incident_evidence e
      WHERE e.incident_id=i.id AND e.media_type='image'
      ORDER BY e.created_at DESC LIMIT 1
    ) photo_url
    FROM incidents i
    WHERE i.status='active' AND (i.expires_at IS NULL OR i.expires_at > now())
    ORDER BY i.updated_at DESC, i.occurred_at DESC
    LIMIT 300
  `);
}

async function journeyShareByToken(token) {
  return query(`
    SELECT j.*, u.display_name, js.expires_at share_expires_at
    FROM journey_shares js
    JOIN journeys j ON j.id=js.journey_id
    JOIN users u ON u.id=j.user_id
    WHERE js.token_hash=$1 AND js.revoked_at IS NULL
      AND (js.expires_at IS NULL OR js.expires_at>now())
    LIMIT 1
  `, [sha256(token)]);
}

async function liveShareByToken(token) {
  return query(`
    SELECT ls.*, u.display_name user_display_name
    FROM live_shares ls
    JOIN users u ON u.id=ls.user_id
    WHERE ls.token_hash=$1 AND ls.active=true AND ls.expires_at>now()
    LIMIT 1
  `, [sha256(token)]);
}

export function registerWebRuntime(app) {
  // Incidents: durable first-party CRUD. Web refreshes this feed every 10 seconds.
  app.get('/v1/web/incidents', authenticate, async (_req, res, next) => {
    try { const r = await latestIncidents(); ok(res, r.rows.map(incidentDto)); }
    catch (error) { next(error); }
  });

  app.post('/v1/web/incidents', authenticate, async (req, res, next) => {
    try {
      const b = req.body || {};
      if (!Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(b.lng))) return fail(res, 400, 'validation_error', 'Valid incident coordinates are required');
      const clientId = b.client_incident_id || randomUUID();
      const expiresAt = b.expires_at ? new Date(b.expires_at) : new Date(Date.now() + 6 * 60 * 60 * 1000);
      const r = await query(`
        INSERT INTO incidents(user_id,journey_id,client_id,type,severity,lat,lng,description,occurred_at,expires_at,metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,now()),$10,$11::jsonb)
        ON CONFLICT(user_id,client_id) DO UPDATE SET updated_at=now()
        RETURNING *
      `, [req.user.id, b.journey_id || null, clientId, b.type || 'other', b.severity || 'medium', Number(b.lat), Number(b.lng), b.note || null, b.observed_at || null, expiresAt, JSON.stringify({ roadImpact: b.road_impact || null })]);
      await query(`INSERT INTO notification_outbox(user_id,event_type,payload) VALUES($1,'incident.created',$2::jsonb)`, [req.user.id, JSON.stringify({ incidentId: r.rows[0].id, type: r.rows[0].type, lat: r.rows[0].lat, lng: r.rows[0].lng })]);
      ok(res, incidentDto(r.rows[0]), 201);
    } catch (error) { next(error); }
  });

  app.patch('/v1/web/incidents/:id', authenticate, async (req, res, next) => {
    try {
      const b = req.body || {};
      const current = await query('SELECT metadata FROM incidents WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      if (!current.rowCount) return fail(res, 404, 'not_found', 'Incident not found');
      const metadata = { ...(current.rows[0].metadata || {}) };
      if (Object.prototype.hasOwnProperty.call(b, 'road_impact')) metadata.roadImpact = b.road_impact;
      const r = await query(`
        UPDATE incidents SET
          description=CASE WHEN $3::boolean THEN $4 ELSE description END,
          severity=COALESCE($5,severity),
          status=COALESCE($6,status),
          metadata=$7::jsonb,
          updated_at=now()
        WHERE id=$1 AND user_id=$2
        RETURNING *, (SELECT media_url FROM incident_evidence e WHERE e.incident_id=incidents.id AND e.media_type='image' ORDER BY e.created_at DESC LIMIT 1) photo_url
      `, [req.params.id, req.user.id, Object.prototype.hasOwnProperty.call(b, 'note'), b.note ?? null, b.severity || null, b.status || null, JSON.stringify(metadata)]);
      ok(res, incidentDto(r.rows[0]));
    } catch (error) { next(error); }
  });

  app.delete('/v1/web/incidents/:id', authenticate, async (req, res, next) => {
    try {
      const r = await query(`UPDATE incidents SET status='resolved',expires_at=LEAST(COALESCE(expires_at,now()),now()),updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id`, [req.params.id, req.user.id]);
      if (!r.rowCount) return fail(res, 404, 'not_found', 'Incident not found');
      ok(res, { deleted: true });
    } catch (error) { next(error); }
  });

  // Saved places.
  app.get('/v1/web/saved-places', authenticate, async (req, res, next) => {
    try { const r = await query('SELECT * FROM saved_places WHERE user_id=$1 ORDER BY visit_count DESC,updated_at DESC', [req.user.id]); ok(res, r.rows.map(savedPlaceDto)); }
    catch (error) { next(error); }
  });

  app.post('/v1/web/saved-places', authenticate, async (req, res, next) => {
    try {
      const b = req.body || {};
      if (!b.label || !Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(b.lng))) return fail(res, 400, 'validation_error', 'Label and coordinates are required');
      if (['home', 'work'].includes(b.kind)) await query('DELETE FROM saved_places WHERE user_id=$1 AND kind=$2', [req.user.id, b.kind]);
      const r = await query(`INSERT INTO saved_places(user_id,label,kind,formatted_address,lat,lng,provider_place_id,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [req.user.id, b.label, b.kind || 'custom', b.formatted_address || null, Number(b.lat), Number(b.lng), b.provider_place_id || null, b.source || 'web']);
      ok(res, savedPlaceDto(r.rows[0]), 201);
    } catch (error) { next(error); }
  });

  app.patch('/v1/web/saved-places/:id', authenticate, async (req, res, next) => {
    try {
      const b = req.body || {};
      const r = await query(`
        UPDATE saved_places SET
          label=COALESCE($3,label), kind=COALESCE($4,kind), formatted_address=COALESCE($5,formatted_address),
          lat=COALESCE($6,lat), lng=COALESCE($7,lng), provider_place_id=COALESCE($8,provider_place_id),
          updated_at=now()
        WHERE id=$1 AND user_id=$2 RETURNING *
      `, [req.params.id, req.user.id, b.label || null, b.kind || null, b.formatted_address ?? null, Number.isFinite(Number(b.lat)) ? Number(b.lat) : null, Number.isFinite(Number(b.lng)) ? Number(b.lng) : null, b.provider_place_id ?? null]);
      if (!r.rowCount) return fail(res, 404, 'not_found', 'Saved place not found');
      ok(res, savedPlaceDto(r.rows[0]));
    } catch (error) { next(error); }
  });

  app.post('/v1/web/saved-places/:id/visit', authenticate, async (req, res, next) => {
    try {
      const r = await query(`UPDATE saved_places SET visit_count=visit_count+1,last_visited_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`, [req.params.id, req.user.id]);
      if (!r.rowCount) return fail(res, 404, 'not_found', 'Saved place not found');
      ok(res, savedPlaceDto(r.rows[0]));
    } catch (error) { next(error); }
  });

  app.delete('/v1/web/saved-places/:id', authenticate, async (req, res, next) => {
    try { await query('DELETE FROM saved_places WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); ok(res, { deleted: true }); }
    catch (error) { next(error); }
  });

  // Standalone live location sharing.
  app.post('/v1/web/live-shares', authenticate, async (req, res, next) => {
    try {
      const b = req.body || {};
      const rawToken = String(b.token || randomUUID().replaceAll('-', ''));
      if (rawToken.length < 16) return fail(res, 400, 'weak_token', 'Share token is too short');
      const expiresAt = b.expires_at ? new Date(b.expires_at) : new Date(Date.now() + 4 * 60 * 60 * 1000);
      const r = await query(`
        INSERT INTO live_shares(user_id,token_hash,display_name,lat,lng,accuracy,heading,speed,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *
      `, [req.user.id, sha256(rawToken), b.display_name || null, b.lat ?? null, b.lng ?? null, b.accuracy ?? null, b.heading ?? null, b.speed ?? null, expiresAt]);
      ok(res, { id: r.rows[0].id, token: rawToken, share_url: `${config.publicWebBaseUrl}/share/${rawToken}`, expires_at: r.rows[0].expires_at, active: true }, 201);
    } catch (error) { next(error); }
  });

  app.patch('/v1/web/live-shares/:id', authenticate, async (req, res, next) => {
    try {
      const b = req.body || {};
      const r = await query(`
        UPDATE live_shares SET
          lat=COALESCE($3,lat),lng=COALESCE($4,lng),accuracy=COALESCE($5,accuracy),heading=COALESCE($6,heading),speed=COALESCE($7,speed),
          active=COALESCE($8,active),last_updated_at=now()
        WHERE id=$1 AND user_id=$2 RETURNING *
      `, [req.params.id, req.user.id, b.lat ?? null, b.lng ?? null, b.accuracy ?? null, b.heading ?? null, b.speed ?? null, typeof b.active === 'boolean' ? b.active : null]);
      if (!r.rowCount) return fail(res, 404, 'not_found', 'Live share not found');
      ok(res, { id: r.rows[0].id, active: r.rows[0].active, last_updated_at: r.rows[0].last_updated_at });
    } catch (error) { next(error); }
  });

  app.delete('/v1/web/live-shares/:id', authenticate, async (req, res, next) => {
    try { await query('UPDATE live_shares SET active=false,last_updated_at=now() WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); ok(res, { stopped: true }); }
    catch (error) { next(error); }
  });

  // Presence: intentionally short-lived and only visible to signed-in users nearby.
  app.put('/v1/web/presence', authenticate, async (req, res, next) => {
    try {
      const b = req.body || {};
      const sessionId = String(b.session_id || 'web');
      await query(`
        INSERT INTO user_presence(user_id,session_id,page,user_agent,lat,lng,last_seen_at)
        VALUES($1,$2,$3,$4,$5,$6,now())
        ON CONFLICT(user_id,session_id) DO UPDATE SET page=EXCLUDED.page,user_agent=EXCLUDED.user_agent,lat=EXCLUDED.lat,lng=EXCLUDED.lng,last_seen_at=now()
      `, [req.user.id, sessionId, b.page || null, b.user_agent || null, b.lat ?? null, b.lng ?? null]);
      ok(res, { ok: true, last_seen_at: new Date().toISOString() });
    } catch (error) { next(error); }
  });

  app.get('/v1/web/presence/nearby', authenticate, async (req, res, next) => {
    try {
      const lat = Number(req.query.lat), lng = Number(req.query.lng);
      const radius = Math.min(Math.max(Number(req.query.radius_m || 25000), 100), 50000);
      const maxAgeSeconds = Math.min(Math.max(Number(req.query.max_age_s || 120), 30), 600);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, 400, 'validation_error', 'lat and lng are required');
      const r = await query(`
        SELECT user_id,lat,lng,last_seen_at,
          (6371000*2*asin(sqrt(power(sin(radians(lat-$1)/2),2)+cos(radians($1))*cos(radians(lat))*power(sin(radians(lng-$2)/2),2)))) distance_m
        FROM user_presence
        WHERE user_id<>$3 AND lat IS NOT NULL AND lng IS NOT NULL
          AND last_seen_at > now() - ($4::text || ' seconds')::interval
        ORDER BY last_seen_at DESC
        LIMIT 200
      `, [lat, lng, req.user.id, String(maxAgeSeconds)]);
      ok(res, r.rows.filter(row => Number(row.distance_m) <= radius).map(row => ({ user_id: row.user_id, lat: row.lat, lng: row.lng, last_seen_at: row.last_seen_at, distance_m: Number(row.distance_m) })));
    } catch (error) { next(error); }
  });

  // Journey history.
  app.get('/v1/web/journeys/history', authenticate, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
      const r = await query('SELECT * FROM journeys WHERE user_id=$1 ORDER BY COALESCE(started_at,created_at) DESC LIMIT $2', [req.user.id, limit]);
      ok(res, r.rows.map(journeyDto));
    } catch (error) { next(error); }
  });

  // Shared reverse-geocode name cache.
  app.get('/v1/web/place-cache/:key', async (req, res, next) => {
    try {
      const r = await query('SELECT cache_key,name,lat,lng,source,updated_at,expires_at FROM place_name_cache WHERE cache_key=$1 AND expires_at>now()', [req.params.key]);
      if (!r.rowCount) return fail(res, 404, 'not_found', 'Place name not cached');
      ok(res, { key: r.rows[0].cache_key, name: r.rows[0].name, lat: r.rows[0].lat, lng: r.rows[0].lng, source: r.rows[0].source, updated_at: r.rows[0].updated_at });
    } catch (error) { next(error); }
  });

  app.put('/v1/web/place-cache/:key', authenticate, async (req, res, next) => {
    try {
      const b = req.body || {};
      if (!b.name) return fail(res, 400, 'validation_error', 'Place name is required');
      const r = await query(`
        INSERT INTO place_name_cache(cache_key,name,lat,lng,source,updated_at,expires_at)
        VALUES($1,$2,$3,$4,$5,now(),now()+interval '90 days')
        ON CONFLICT(cache_key) DO UPDATE SET name=EXCLUDED.name,lat=EXCLUDED.lat,lng=EXCLUDED.lng,source=EXCLUDED.source,updated_at=now(),expires_at=now()+interval '90 days'
        RETURNING *
      `, [req.params.key, b.name, b.lat ?? null, b.lng ?? null, b.source || 'nominatim']);
      ok(res, { key: r.rows[0].cache_key, name: r.rows[0].name });
    } catch (error) { next(error); }
  });

  // Unified public share reader: journey shares and standalone live shares use the same /share/:token page.
  app.get('/v1/shared-trips/:token', async (req, res, next) => {
    try {
      const journey = await journeyShareByToken(req.params.token);
      if (journey.rowCount) {
        const j = journey.rows[0];
        const points = await query('SELECT lat,lng,recorded_at FROM journey_points WHERE journey_id=$1 ORDER BY recorded_at ASC LIMIT 3000', [j.id]);
        return ok(res, { status: j.status === 'completed' ? 'ended' : 'active', lat: j.last_lat, lng: j.last_lng, accuracy: null, heading: null, speed: j.avg_speed_mps, last_updated_at: j.last_location_at, expires_at: j.share_expires_at, display_name: j.display_name, vehicle: j.mode, journey_role: j.journey_role, purpose: j.purpose, journey_mode: j.mode, started_at: j.started_at || j.created_at, ended_at: j.ended_at, completion_outcome: j.status === 'completed' ? 'ended' : null, origin_label: j.origin_name, destination_label: j.destination_name, origin_lat: j.origin_lat, origin_lng: j.origin_lng, destination_lat: j.destination_lat, destination_lng: j.destination_lng, distance_m: Number(j.distance_m || 0), duration_s: Number(j.duration_s || 0), average_speed_mps: Number(j.avg_speed_mps || 0), max_speed_mps: Number(j.max_speed_mps || 0), route: points.rows, route_truncated: points.rowCount >= 3000 });
      }
      const live = await liveShareByToken(req.params.token);
      if (!live.rowCount) return fail(res, 404, 'not_found', 'Share not found');
      const l = live.rows[0];
      return ok(res, { status: 'active', lat: l.lat, lng: l.lng, accuracy: l.accuracy, heading: l.heading, speed: l.speed, last_updated_at: l.last_updated_at, expires_at: l.expires_at, display_name: l.display_name || l.user_display_name, vehicle: null, journey_role: null, purpose: 'live_location', journey_mode: null, started_at: l.created_at, ended_at: null, completion_outcome: null, origin_label: null, destination_label: null, origin_lat: null, origin_lng: null, destination_lat: null, destination_lng: null, distance_m: null, duration_s: null, average_speed_mps: null, max_speed_mps: null, route: [], route_truncated: false });
    } catch (error) { next(error); }
  });

  app.get('/v1/shared-trips/:token/state', async (req, res, next) => {
    try {
      const journey = await journeyShareByToken(req.params.token);
      if (journey.rowCount) {
        const j = journey.rows[0];
        const etag = `W/\"journey-${j.id}-${new Date(j.last_location_at || j.updated_at || 0).getTime()}-${j.status}\"`;
        if (req.headers['if-none-match'] === etag) return res.status(304).end();
        res.setHeader('ETag', etag);
        return ok(res, { status: j.status === 'completed' ? 'ended' : 'active', lat: j.last_lat, lng: j.last_lng, accuracy: null, heading: null, speed: j.avg_speed_mps, last_updated_at: j.last_location_at, expires_at: j.share_expires_at });
      }
      const live = await liveShareByToken(req.params.token);
      if (!live.rowCount) return fail(res, 404, 'not_found', 'Share not found');
      const l = live.rows[0];
      const etag = `W/\"live-${l.id}-${new Date(l.last_updated_at).getTime()}-${l.active}\"`;
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      res.setHeader('ETag', etag);
      return ok(res, { status: l.active ? 'active' : 'ended', lat: l.lat, lng: l.lng, accuracy: l.accuracy, heading: l.heading, speed: l.speed, last_updated_at: l.last_updated_at, expires_at: l.expires_at });
    } catch (error) { next(error); }
  });
}
