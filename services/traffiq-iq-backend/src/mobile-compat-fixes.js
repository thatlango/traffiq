import { authenticate } from './auth.js';
import { query } from './db.js';

const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });
const fail = (res, status, code, message) => res.status(status).json({ data: null, error: { code, message, details: null } });
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
  // Keep this module registered before the broad compatibility routes. These
  // shapes intentionally match the Android kotlinx.serialization models.
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
