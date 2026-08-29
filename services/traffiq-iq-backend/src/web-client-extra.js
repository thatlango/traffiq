import { createHash, randomBytes } from 'node:crypto';
import { authenticate } from './auth.js';
import { query } from './db.js';
import { config } from './config.js';

const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });
const fail = (res, status, code, message) => res.status(status).json({ data: null, error: { code, message, details: null } });
const hashToken = token => createHash('sha256').update(token).digest('hex');
const webBase = () => (config.publicWebBaseUrl || 'https://traffiq.tukutuku.org').replace(/\/$/, '');

const journeyDto = j => ({
  id: j.id,
  client_journey_id: j.client_id,
  user_id: j.user_id,
  vehicle: j.mode,
  transport_mode: j.mode,
  journey_role: j.metadata?.journeyRole || null,
  purpose: j.metadata?.purpose || 'personal',
  journey_mode: j.metadata?.journeyMode || 'navigation',
  started_at: j.started_at,
  ended_at: j.ended_at,
  origin_lat: j.origin_lat,
  origin_lng: j.origin_lng,
  origin_label: j.origin_name,
  destination_lat: j.destination_lat,
  destination_lng: j.destination_lng,
  destination_label: j.destination_name,
  distance_m: Number(j.actual_distance_m || j.planned_distance_m || 0),
  duration_s: Number(j.actual_duration_s || j.planned_duration_s || 0),
  status: j.status,
});

const incidentDto = row => ({
  id: row.id,
  client_incident_id: row.client_id,
  user_id: row.user_id,
  journey_id: row.journey_id,
  type: row.type,
  lat: row.lat,
  lng: row.lng,
  road_impact: row.metadata?.roadImpact || null,
  severity: row.severity,
  note: row.description,
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

export function registerWebClientExtra(app) {
  app.get('/v1/journeys', authenticate, async (req, res, next) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
      const result = await query(
        `SELECT * FROM journeys WHERE user_id=$1 ORDER BY started_at DESC LIMIT $2`,
        [req.user.id, limit],
      );
      ok(res, result.rows.map(journeyDto));
    } catch (error) { next(error); }
  });

  app.patch('/v1/incidents/:id', authenticate, async (req, res, next) => {
    try {
      const body = req.body || {};
      const existing = await query('SELECT * FROM incidents WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      if (!existing.rowCount) return fail(res, 404, 'not_found', 'Incident not found');
      const current = existing.rows[0];
      const metadata = { ...(current.metadata || {}) };
      if (body.road_impact !== undefined) metadata.roadImpact = body.road_impact;
      const result = await query(
        `UPDATE incidents
         SET description=COALESCE($3,description),
             severity=COALESCE($4,severity),
             metadata=$5::jsonb,
             updated_at=now()
         WHERE id=$1 AND user_id=$2
         RETURNING *`,
        [req.params.id, req.user.id, body.note ?? null, body.severity ?? null, JSON.stringify(metadata)],
      );
      const evidence = await query(
        `SELECT media_url FROM incident_evidence WHERE incident_id=$1 AND media_type='image' ORDER BY created_at DESC LIMIT 1`,
        [req.params.id],
      );
      ok(res, incidentDto({ ...result.rows[0], photo_url: evidence.rows[0]?.media_url || null }));
    } catch (error) { next(error); }
  });

  app.post('/v1/live-shares', authenticate, async (req, res, next) => {
    try {
      const body = req.body || {};
      const hours = Math.min(24, Math.max(1, Number(body.hours || 4)));
      const token = randomBytes(24).toString('base64url');
      const result = await query(
        `INSERT INTO live_shares(user_id,token_hash,display_name,lat,lng,accuracy,heading,speed,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+($9::text || ' hours')::interval)
         RETURNING id,display_name,lat,lng,accuracy,heading,speed,active,expires_at,last_updated_at`,
        [
          req.user.id, hashToken(token), body.display_name || null,
          body.lat ?? null, body.lng ?? null, body.accuracy ?? null,
          body.heading ?? null, body.speed ?? null, String(hours),
        ],
      );
      ok(res, {
        ...result.rows[0],
        token,
        share_url: `${webBase()}/share/${token}`,
      }, 201);
    } catch (error) { next(error); }
  });

  app.patch('/v1/live-shares/:id', authenticate, async (req, res, next) => {
    try {
      const body = req.body || {};
      const result = await query(
        `UPDATE live_shares
         SET lat=COALESCE($3,lat), lng=COALESCE($4,lng), accuracy=COALESCE($5,accuracy),
             heading=COALESCE($6,heading), speed=COALESCE($7,speed),
             active=COALESCE($8,active), last_updated_at=now()
         WHERE id=$1 AND user_id=$2
         RETURNING id,display_name,lat,lng,accuracy,heading,speed,active,expires_at,last_updated_at`,
        [req.params.id, req.user.id, body.lat ?? null, body.lng ?? null, body.accuracy ?? null, body.heading ?? null, body.speed ?? null, body.active ?? null],
      );
      if (!result.rowCount) return fail(res, 404, 'not_found', 'Live share not found');
      ok(res, result.rows[0]);
    } catch (error) { next(error); }
  });

  app.get('/v1/live-shares/:token', async (req, res, next) => {
    try {
      const result = await query(
        `SELECT id,display_name,lat,lng,accuracy,heading,speed,active,expires_at,last_updated_at
         FROM live_shares
         WHERE token_hash=$1 AND active=true AND expires_at>now()`,
        [hashToken(req.params.token)],
      );
      if (!result.rowCount) return fail(res, 404, 'not_found', 'Live share not found or expired');
      ok(res, result.rows[0]);
    } catch (error) { next(error); }
  });
}
