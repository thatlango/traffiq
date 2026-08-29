import { sha256 } from './auth.js';
import { query } from './db.js';

const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });
const fail = (res, status, code, message) => res.status(status).json({ data: null, error: { code, message, details: null } });

export function registerWebShareCheck(app) {
  app.post('/v1/shared-trips/:token/check', async (req, res, next) => {
    try {
      const tokenHash = sha256(req.params.token);
      const journey = await query(`
        SELECT j.id,j.last_lat,j.last_lng,j.last_location_at,j.avg_speed_mps,j.status,js.expires_at
        FROM journey_shares js
        JOIN journeys j ON j.id=js.journey_id
        WHERE js.token_hash=$1 AND js.revoked_at IS NULL
          AND (js.expires_at IS NULL OR js.expires_at>now())
        LIMIT 1
      `, [tokenHash]);
      if (journey.rowCount) {
        const j = journey.rows[0];
        const state = {
          status: j.status === 'completed' ? 'ended' : 'active',
          lat: j.last_lat,
          lng: j.last_lng,
          accuracy: null,
          heading: null,
          speed: j.avg_speed_mps,
          last_updated_at: j.last_location_at,
          expires_at: j.expires_at,
        };
        return ok(res, {
          allowed: true,
          retry_after_seconds: 10,
          checked_at: new Date().toISOString(),
          state,
          fresh_device_requested: false,
        });
      }

      const live = await query(`
        SELECT id,lat,lng,accuracy,heading,speed,last_updated_at,expires_at,active
        FROM live_shares
        WHERE token_hash=$1 AND active=true AND expires_at>now()
        LIMIT 1
      `, [tokenHash]);
      if (!live.rowCount) return fail(res, 404, 'not_found', 'Share not found');
      const l = live.rows[0];
      const state = {
        status: l.active ? 'active' : 'ended',
        lat: l.lat,
        lng: l.lng,
        accuracy: l.accuracy,
        heading: l.heading,
        speed: l.speed,
        last_updated_at: l.last_updated_at,
        expires_at: l.expires_at,
      };
      return ok(res, {
        allowed: true,
        retry_after_seconds: 10,
        checked_at: new Date().toISOString(),
        state,
        fresh_device_requested: false,
      });
    } catch (error) { next(error); }
  });
}
