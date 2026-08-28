import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { checkDatabase, pool, query, transaction } from './db.js';
import {
  authenticate,
  hashPassword,
  issueAccessToken,
  issueRefreshToken,
  normalizeEmail,
  sha256,
  verifyPassword
} from './auth.js';
import { previewRoute, searchPlaces } from './geo.js';
import { runMigrations } from '../scripts/migrate.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin(origin, cb) {
    if (!origin || config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed'));
  }
}));

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const uuid = z.string().uuid();
const coordinate = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  name: z.string().trim().min(1).max(240).optional()
});
const deviceSchema = z.object({
  installationId: z.string().min(8).max(200),
  platform: z.enum(['android', 'ios', 'web']),
  pushToken: z.string().max(2048).nullable().optional(),
  appVersion: z.string().max(80).optional(),
  osVersion: z.string().max(80).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional()
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error('validation_error');
    error.status = 400;
    error.details = result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }));
    throw error;
  }
  return result.data;
}

async function upsertDevice(userId, device) {
  if (!device) return null;
  const row = await query(
    `INSERT INTO devices (user_id, installation_id, platform, push_token, app_version, os_version, capabilities)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (installation_id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       platform = EXCLUDED.platform,
       push_token = EXCLUDED.push_token,
       app_version = EXCLUDED.app_version,
       os_version = EXCLUDED.os_version,
       capabilities = EXCLUDED.capabilities,
       last_seen_at = now(),
       updated_at = now()
     RETURNING id, installation_id, platform, app_version, os_version, last_seen_at`,
    [
      userId,
      device.installationId,
      device.platform,
      device.pushToken ?? null,
      device.appVersion ?? null,
      device.osVersion ?? null,
      JSON.stringify(device.capabilities ?? {})
    ]
  );
  return row.rows[0];
}

async function authResponse(user, device = null) {
  const dbDevice = await upsertDevice(user.id, device);
  const accessToken = await issueAccessToken(user);
  const refresh = await issueRefreshToken(user.id, dbDevice?.id ?? null);
  return {
    user: { id: user.id, email: user.email, displayName: user.display_name },
    device: dbDevice,
    accessToken,
    accessTokenExpiresInSeconds: config.accessTokenMinutes * 60,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt
  };
}

async function ownedJourney(userId, journeyId) {
  const result = await query('SELECT * FROM journeys WHERE id = $1 AND user_id = $2', [journeyId, userId]);
  if (!result.rowCount) {
    const error = new Error('journey_not_found');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

async function recomputeJourneyStats(journeyId) {
  const stats = await query(
    `WITH ordered AS (
       SELECT lat, lng, speed_mps, recorded_at,
              lag(lat) OVER (ORDER BY recorded_at, id) AS prev_lat,
              lag(lng) OVER (ORDER BY recorded_at, id) AS prev_lng
       FROM journey_points WHERE journey_id = $1
     ), segments AS (
       SELECT *,
         CASE WHEN prev_lat IS NULL THEN 0 ELSE
           6371000 * 2 * asin(sqrt(
             power(sin(radians(lat - prev_lat) / 2), 2) +
             cos(radians(prev_lat)) * cos(radians(lat)) * power(sin(radians(lng - prev_lng) / 2), 2)
           )) END AS segment_m
       FROM ordered
     )
     SELECT COALESCE(sum(segment_m),0) AS distance_m,
            COALESCE(max(speed_mps),0) AS max_speed_mps,
            min(recorded_at) AS first_at,
            max(recorded_at) AS last_at,
            (array_agg(lat ORDER BY recorded_at DESC))[1] AS last_lat,
            (array_agg(lng ORDER BY recorded_at DESC))[1] AS last_lng
     FROM segments`,
    [journeyId]
  );
  const s = stats.rows[0];
  const durationS = s.first_at && s.last_at ? Math.max(0, Math.round((new Date(s.last_at) - new Date(s.first_at)) / 1000)) : 0;
  const distanceM = Number(s.distance_m ?? 0);
  const avgSpeed = durationS > 0 ? distanceM / durationS : 0;
  const updated = await query(
    `UPDATE journeys SET
       distance_m = $2,
       duration_s = $3,
       max_speed_mps = $4,
       avg_speed_mps = $5,
       last_lat = $6,
       last_lng = $7,
       last_location_at = $8,
       version = version + 1,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [journeyId, distanceM, durationS, Number(s.max_speed_mps ?? 0), avgSpeed, s.last_lat, s.last_lng, s.last_at]
  );
  return updated.rows[0];
}

app.get('/health', asyncRoute(async (_req, res) => {
  const dbTime = await checkDatabase();
  res.json({ ok: true, service: 'traffiq-iq-api', version: '0.1.0', dbTime });
}));

app.get('/v1/meta', (_req, res) => {
  res.json({
    apiVersion: 'v1',
    journeyModes: ['car','motorcycle','taxi','bus','truck','bicycle','walking','other'],
    incidentTypes: ['accident','hazard','roadblock','police','traffic','road_damage','flooding','construction','closure','other'],
    maxPointsPerBatch: 500,
    serverTime: new Date().toISOString()
  });
});

app.post('/v1/auth/register', asyncRoute(async (req, res) => {
  const body = parse(z.object({
    email: z.string().email(),
    password: z.string().min(8).max(200),
    displayName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(7).max(30).optional(),
    device: deviceSchema.optional()
  }), req.body);
  const email = normalizeEmail(body.email);
  const passwordHash = await hashPassword(body.password);
  try {
    const created = await query(
      `INSERT INTO users (email, phone, display_name, password_hash)
       VALUES ($1,$2,$3,$4)
       RETURNING id, email, display_name`,
      [email, body.phone ?? null, body.displayName, passwordHash]
    );
    res.status(201).json(await authResponse(created.rows[0], body.device));
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'account_exists' });
    throw error;
  }
}));

app.post('/v1/auth/login', asyncRoute(async (req, res) => {
  const body = parse(z.object({
    email: z.string().email(),
    password: z.string().min(1).max(200),
    device: deviceSchema.optional()
  }), req.body);
  const result = await query('SELECT * FROM users WHERE email = $1 AND status = $2', [normalizeEmail(body.email), 'active']);
  const user = result.rows[0];
  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  res.json(await authResponse(user, body.device));
}));

app.post('/v1/auth/refresh', asyncRoute(async (req, res) => {
  const body = parse(z.object({ refreshToken: z.string().min(32) }), req.body);
  const tokenHash = sha256(body.refreshToken);
  const result = await query(
    `SELECT rt.id AS refresh_id, rt.user_id, rt.device_id, u.id, u.email, u.display_name
     FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now() AND u.status = 'active'`,
    [tokenHash]
  );
  if (!result.rowCount) return res.status(401).json({ error: 'invalid_refresh_token' });
  const row = result.rows[0];
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.refresh_id]);
  const accessToken = await issueAccessToken(row);
  const refresh = await issueRefreshToken(row.user_id, row.device_id);
  res.json({ accessToken, accessTokenExpiresInSeconds: config.accessTokenMinutes * 60, refreshToken: refresh.token, refreshTokenExpiresAt: refresh.expiresAt });
}));

app.post('/v1/auth/logout', asyncRoute(async (req, res) => {
  const body = parse(z.object({ refreshToken: z.string().min(32) }), req.body);
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(body.refreshToken)]);
  res.status(204).end();
}));

app.put('/v1/devices/current', authenticate, asyncRoute(async (req, res) => {
  const device = parse(deviceSchema, req.body);
  res.json(await upsertDevice(req.user.id, device));
}));

app.get('/v1/geo/search', authenticate, asyncRoute(async (req, res) => {
  const params = parse(z.object({
    q: z.string().trim().min(2).max(200),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    limit: z.coerce.number().int().min(1).max(10).optional()
  }), req.query);
  res.json({ results: await searchPlaces(params) });
}));

app.post('/v1/routes/preview', authenticate, asyncRoute(async (req, res) => {
  const body = parse(z.object({
    origin: coordinate,
    destination: coordinate,
    mode: z.enum(['car','motorcycle','taxi','bus','truck','bicycle','walking','other'])
  }), req.body);
  res.json(await previewRoute({
    originLat: body.origin.lat,
    originLng: body.origin.lng,
    destinationLat: body.destination.lat,
    destinationLng: body.destination.lng,
    mode: body.mode
  }));
}));

app.post('/v1/journeys', authenticate, asyncRoute(async (req, res) => {
  const body = parse(z.object({
    clientId: uuid,
    mode: z.enum(['car','motorcycle','taxi','bus','truck','bicycle','walking','other']),
    origin: coordinate.optional(),
    destination: coordinate,
    route: z.object({ provider: z.string().max(60).optional(), polyline: z.string().max(200000).optional(), distanceM: z.number().nonnegative().optional(), durationS: z.number().int().nonnegative().optional() }).optional()
  }), req.body);
  const result = await query(
    `INSERT INTO journeys (
       user_id, client_id, mode, origin_name, origin_lat, origin_lng,
       destination_name, destination_lat, destination_lng, route_provider,
       route_polyline, planned_distance_m, planned_duration_s
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (user_id, client_id) DO UPDATE SET updated_at = journeys.updated_at
     RETURNING *`,
    [req.user.id, body.clientId, body.mode, body.origin?.name ?? null, body.origin?.lat ?? null, body.origin?.lng ?? null,
      body.destination.name ?? null, body.destination.lat, body.destination.lng, body.route?.provider ?? null,
      body.route?.polyline ?? null, body.route?.distanceM ?? null, body.route?.durationS ?? null]
  );
  res.status(201).json(result.rows[0]);
}));

app.get('/v1/journeys', authenticate, asyncRoute(async (req, res) => {
  const params = parse(z.object({
    status: z.enum(['planned','active','paused','completed','cancelled']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
  }), req.query);
  const result = params.status
    ? await query('SELECT * FROM journeys WHERE user_id = $1 AND status = $2 ORDER BY updated_at DESC LIMIT $3', [req.user.id, params.status, params.limit ?? 50])
    : await query('SELECT * FROM journeys WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2', [req.user.id, params.limit ?? 50]);
  res.json({ journeys: result.rows });
}));

app.get('/v1/journeys/:id', authenticate, asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.id);
  res.json(await ownedJourney(req.user.id, id));
}));

app.post('/v1/journeys/:id/start', authenticate, asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await ownedJourney(req.user.id, id);
  const result = await query(
    `UPDATE journeys SET status = 'active', started_at = COALESCE(started_at, now()), ended_at = NULL, version = version + 1, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status IN ('planned','paused') RETURNING *`,
    [id, req.user.id]
  );
  if (!result.rowCount) return res.status(409).json({ error: 'invalid_journey_state' });
  res.json(result.rows[0]);
}));

app.post('/v1/journeys/:id/pause', authenticate, asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const result = await query(
    `UPDATE journeys SET status = 'paused', version = version + 1, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING *`,
    [id, req.user.id]
  );
  if (!result.rowCount) return res.status(409).json({ error: 'invalid_journey_state' });
  res.json(result.rows[0]);
}));

app.post('/v1/journeys/:id/points', authenticate, asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(z.object({
    points: z.array(z.object({
      id: uuid,
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracyM: z.number().nonnegative().max(10000).optional(),
      speedMps: z.number().nonnegative().max(150).optional(),
      bearingDeg: z.number().min(0).max(360).optional(),
      altitudeM: z.number().min(-1000).max(12000).optional(),
      recordedAt: z.string().datetime({ offset: true }),
      source: z.enum(['gps','network','manual']).optional()
    })).min(1).max(500)
  }), req.body);
  const journey = await ownedJourney(req.user.id, id);
  if (!['active','paused'].includes(journey.status)) return res.status(409).json({ error: 'journey_not_recording' });
  const insert = await query(
    `INSERT INTO journey_points (journey_id, client_point_id, lat, lng, accuracy_m, speed_mps, bearing_deg, altitude_m, recorded_at, source)
     SELECT $1, p.id::uuid, p.lat, p.lng, p.accuracy_m, p.speed_mps, p.bearing_deg, p.altitude_m, p.recorded_at::timestamptz, COALESCE(p.source,'gps')
     FROM jsonb_to_recordset($2::jsonb) AS p(id text, lat double precision, lng double precision, accuracy_m double precision, speed_mps double precision, bearing_deg double precision, altitude_m double precision, recorded_at text, source text)
     ON CONFLICT (journey_id, client_point_id) DO NOTHING
     RETURNING id`,
    [id, JSON.stringify(body.points.map(p => ({ id: p.id, lat: p.lat, lng: p.lng, accuracy_m: p.accuracyM, speed_mps: p.speedMps, bearing_deg: p.bearingDeg, altitude_m: p.altitudeM, recorded_at: p.recordedAt, source: p.source })))]
  );
  const updated = await recomputeJourneyStats(id);
  res.status(202).json({ accepted: insert.rowCount, duplicateOrExisting: body.points.length - insert.rowCount, journey: updated });
}));

app.post('/v1/journeys/:id/end', authenticate, asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await ownedJourney(req.user.id, id);
  await recomputeJourneyStats(id);
  const result = await query(
    `UPDATE journeys SET status = 'completed', ended_at = now(), version = version + 1, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status IN ('active','paused') RETURNING *`,
    [id, req.user.id]
  );
  if (!result.rowCount) return res.status(409).json({ error: 'invalid_journey_state' });
  res.json(result.rows[0]);
}));

app.post('/v1/journeys/:id/share', authenticate, asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(z.object({ expiresInHours: z.number().int().min(1).max(720).optional() }).default({}), req.body ?? {});
  await ownedJourney(req.user.id, id);
  const rawToken = randomBytes(32).toString('base64url');
  const expiresAt = body.expiresInHours ? new Date(Date.now() + body.expiresInHours * 3_600_000) : null;
  await query('INSERT INTO journey_shares (journey_id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)', [id, req.user.id, sha256(rawToken), expiresAt]);
  const apiPath = `/public/journeys/${rawToken}`;
  res.status(201).json({ token: rawToken, apiUrl: config.publicApiBaseUrl ? `${config.publicApiBaseUrl}${apiPath}` : apiPath, webUrl: config.publicWebBaseUrl ? `${config.publicWebBaseUrl}/journey/${rawToken}` : null, expiresAt });
}));

app.get('/public/journeys/:token', asyncRoute(async (req, res) => {
  const token = String(req.params.token ?? '');
  if (token.length < 24) return res.status(404).json({ error: 'share_not_found' });
  const result = await query(
    `SELECT j.id, j.mode, j.status, j.destination_name, j.destination_lat, j.destination_lng,
            j.last_lat, j.last_lng, j.last_location_at, j.distance_m, j.duration_s,
            j.started_at, j.ended_at, js.expires_at
     FROM journey_shares js JOIN journeys j ON j.id = js.journey_id
     WHERE js.token_hash = $1 AND js.revoked_at IS NULL AND (js.expires_at IS NULL OR js.expires_at > now())`,
    [sha256(token)]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'share_not_found' });
  res.json({ journey: result.rows[0], serverTime: new Date().toISOString() });
}));

app.post('/v1/incidents', authenticate, asyncRoute(async (req, res) => {
  const body = parse(z.object({
    clientId: uuid,
    journeyId: uuid.optional(),
    type: z.enum(['accident','hazard','roadblock','police','traffic','road_damage','flooding','construction','closure','other']),
    severity: z.enum(['low','medium','high','critical']).optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    headingDeg: z.number().min(0).max(360).optional(),
    description: z.string().trim().max(1000).optional(),
    occurredAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    evidence: z.array(z.object({ mediaType: z.enum(['image','video','audio']), mediaUrl: z.string().url().max(2000).optional(), storageKey: z.string().max(500).optional(), sha256: z.string().max(128).optional(), capturedAt: z.string().datetime({ offset: true }).optional() })).max(8).optional()
  }), req.body);
  if (body.journeyId) await ownedJourney(req.user.id, body.journeyId);
  const incident = await transaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO incidents (user_id, journey_id, client_id, type, severity, lat, lng, heading_deg, description, occurred_at, expires_at, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       ON CONFLICT (user_id, client_id) DO UPDATE SET updated_at = incidents.updated_at
       RETURNING *`,
      [req.user.id, body.journeyId ?? null, body.clientId, body.type, body.severity ?? 'medium', body.lat, body.lng, body.headingDeg ?? null, body.description ?? null, body.occurredAt, body.expiresAt ?? null, JSON.stringify(body.metadata ?? {})]
    );
    const row = inserted.rows[0];
    for (const evidence of body.evidence ?? []) {
      await client.query(
        `INSERT INTO incident_evidence (incident_id, media_type, storage_key, media_url, sha256, captured_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [row.id, evidence.mediaType, evidence.storageKey ?? null, evidence.mediaUrl ?? null, evidence.sha256 ?? null, evidence.capturedAt ?? null]
      );
    }
    await client.query(
      `INSERT INTO notification_outbox (event_type, payload)
       VALUES ('incident.created', jsonb_build_object('incidentId',$1::text,'type',$2::text,'lat',$3::double precision,'lng',$4::double precision))`,
      [row.id, row.type, row.lat, row.lng]
    );
    return row;
  });
  res.status(201).json(incident);
}));

app.get('/v1/incidents/nearby', authenticate, asyncRoute(async (req, res) => {
  const params = parse(z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusM: z.coerce.number().int().min(100).max(50000).optional(),
    sinceHours: z.coerce.number().int().min(1).max(168).optional()
  }), req.query);
  const radius = params.radiusM ?? 10000;
  const latDelta = radius / 111320;
  const lngDelta = radius / Math.max(111320 * Math.cos(params.lat * Math.PI / 180), 1);
  const result = await query(
    `SELECT * FROM (
       SELECT i.*,
         6371000 * 2 * asin(sqrt(
           power(sin(radians(i.lat - $1) / 2), 2) +
           cos(radians($1)) * cos(radians(i.lat)) * power(sin(radians(i.lng - $2) / 2), 2)
         )) AS distance_m
       FROM incidents i
       WHERE i.status = 'active'
         AND (i.expires_at IS NULL OR i.expires_at > now())
         AND i.occurred_at > now() - make_interval(hours => $3)
         AND i.lat BETWEEN $1 - $5 AND $1 + $5
         AND i.lng BETWEEN $2 - $6 AND $2 + $6
     ) x WHERE distance_m <= $4 ORDER BY distance_m ASC, occurred_at DESC LIMIT 200`,
    [params.lat, params.lng, params.sinceHours ?? 24, radius, latDelta, lngDelta]
  );
  res.json({ incidents: result.rows, radiusM: radius, serverTime: new Date().toISOString() });
}));

app.put('/v1/incidents/:id/vote', authenticate, asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(z.object({ vote: z.enum(['confirm','dispute']) }), req.body);
  const counts = await transaction(async (client) => {
    const incident = await client.query('SELECT id FROM incidents WHERE id = $1', [id]);
    if (!incident.rowCount) {
      const error = new Error('incident_not_found');
      error.status = 404;
      throw error;
    }
    await client.query(
      `INSERT INTO incident_votes (incident_id, user_id, vote) VALUES ($1,$2,$3)
       ON CONFLICT (incident_id, user_id) DO UPDATE SET vote = EXCLUDED.vote, created_at = now()`,
      [id, req.user.id, body.vote]
    );
    const result = await client.query(
      `UPDATE incidents i SET
         confirmations = (SELECT count(*) FROM incident_votes WHERE incident_id = $1 AND vote = 'confirm'),
         disputes = (SELECT count(*) FROM incident_votes WHERE incident_id = $1 AND vote = 'dispute'),
         updated_at = now()
       WHERE i.id = $1 RETURNING confirmations, disputes`,
      [id]
    );
    return result.rows[0];
  });
  res.json({ incidentId: id, vote: body.vote, ...counts });
}));

app.get('/v1/sync/pull', authenticate, asyncRoute(async (req, res) => {
  const params = parse(z.object({ since: z.string().datetime({ offset: true }).optional() }), req.query);
  const since = params.since ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [journeys, incidents, devices] = await Promise.all([
    query('SELECT * FROM journeys WHERE user_id = $1 AND updated_at > $2 ORDER BY updated_at ASC LIMIT 500', [req.user.id, since]),
    query('SELECT * FROM incidents WHERE user_id = $1 AND updated_at > $2 ORDER BY updated_at ASC LIMIT 500', [req.user.id, since]),
    query('SELECT id, installation_id, platform, push_token, app_version, os_version, capabilities, last_seen_at, updated_at FROM devices WHERE user_id = $1 AND updated_at > $2 ORDER BY updated_at ASC LIMIT 100', [req.user.id, since])
  ]);
  res.json({ serverTime: new Date().toISOString(), journeys: journeys.rows, incidents: incidents.rows, devices: devices.rows });
}));

app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.message === 'validation_error') return res.status(error.status ?? 400).json({ error: 'validation_error', details: error.details });
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error.message === 'Origin not allowed') return res.status(403).json({ error: 'origin_not_allowed' });
  res.status(500).json({ error: 'internal_error' });
});

async function start() {
  if (config.autoMigrate) await runMigrations();
  await checkDatabase();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`TraffIQ IQ API listening on :${config.port}`);
  });
}

start().catch(async (error) => {
  console.error('failed to start TraffIQ IQ API', error);
  await pool.end();
  process.exit(1);
});
