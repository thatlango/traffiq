import { randomBytes, randomUUID } from 'node:crypto';
import { authenticate, hashPassword, issueAccessToken, issueRefreshToken, normalizeEmail, sha256 } from './auth.js';
import { query, transaction } from './db.js';
import { config } from './config.js';

const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });
const fail = (res, status, code, message, details = null) => res.status(status).json({ data: null, error: { code, message, details } });
const modeMap = (raw = 'car') => {
  const value = String(raw).toLowerCase();
  if (['motorcycle','boda','boda_boda'].includes(value)) return 'motorcycle';
  if (['taxi','matatu'].includes(value)) return 'taxi';
  if (['bus','truck','bicycle','walking','other','car'].includes(value)) return value;
  return 'car';
};
const severityMap = (raw = 'medium') => {
  const v = String(raw).toLowerCase();
  if (['minor','low'].includes(v)) return 'low';
  if (['moderate','medium'].includes(v)) return 'medium';
  if (['severe','high'].includes(v)) return 'high';
  if (['critical'].includes(v)) return 'critical';
  return 'medium';
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
const toIncident = row => ({
  id: row.id,
  client_incident_id: row.client_id,
  user_id: row.user_id,
  journey_id: row.journey_id,
  type: row.type,
  lat: row.lat,
  lng: row.lng,
  road_impact: row.metadata?.roadImpact || null,
  severity: row.severity,
  confidence: Math.min(1, 0.45 + Number(row.confirmations || 0) * 0.1),
  note: row.description,
  photo_url: row.photo_url || null,
  public_photo_url: row.photo_url || null,
  created_at: row.created_at,
  updated_at: row.updated_at,
  expires_at: row.expires_at,
  status: row.status,
  confirmation_count: Number(row.confirmations || 0),
  rejection_count: Number(row.disputes || 0),
  is_public: row.status === 'active'
});
const deviceFromRequest = req => ({
  installationId: req.headers['x-installation-id'] || `android-${randomUUID()}`,
  platform: 'android',
  appVersion: req.headers['x-traffiq-version'] || null
});
async function upsertDevice(userId, device) {
  if (!device?.installationId) return null;
  const result = await query(`INSERT INTO devices (user_id, installation_id, platform, push_token, app_version, os_version, capabilities)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
    ON CONFLICT (installation_id) DO UPDATE SET user_id=EXCLUDED.user_id,push_token=EXCLUDED.push_token,app_version=EXCLUDED.app_version,os_version=EXCLUDED.os_version,capabilities=EXCLUDED.capabilities,last_seen_at=now(),updated_at=now()
    RETURNING id,installation_id,platform,app_version,os_version,last_seen_at`, [userId,device.installationId,device.platform||'android',device.pushToken||null,device.appVersion||null,device.osVersion||null,JSON.stringify(device.capabilities||{})]);
  return result.rows[0];
}
async function authPayload(user, device) {
  const dbDevice = await upsertDevice(user.id, device);
  const accessToken = await issueAccessToken(user);
  const refresh = await issueRefreshToken(user.id, dbDevice?.id || null);
  return { user:{id:user.id,email:user.email,displayName:user.display_name,phone:user.phone}, device:dbDevice, accessToken, accessTokenExpiresInSeconds:config.accessTokenMinutes*60, refreshToken:refresh.token, refreshTokenExpiresAt:refresh.expiresAt };
}
async function verifyGoogleIdToken(idToken) {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('invalid_google_token');
  const claims = await response.json();
  if (config.googleWebClientId && claims.aud !== config.googleWebClientId) throw new Error('invalid_google_audience');
  if (!claims.email || claims.email_verified !== 'true') throw new Error('google_email_unverified');
  return claims;
}

export function registerMobileCompatibility(app) {
  app.post('/v1/auth/google', async (req,res,next) => { try {
    const { idToken, device } = req.body || {};
    if (!idToken) return fail(res,400,'validation_error','Google ID token is required');
    const claims = await verifyGoogleIdToken(idToken);
    const email = normalizeEmail(claims.email);
    let found = await query('SELECT * FROM users WHERE google_subject=$1 OR email=$2 LIMIT 1',[claims.sub,email]);
    let user = found.rows[0];
    if (!user) {
      const placeholderHash = await hashPassword(randomBytes(32).toString('base64url'));
      const created = await query(`INSERT INTO users(email,display_name,password_hash,google_subject,avatar_url) VALUES($1,$2,$3,$4,$5) RETURNING *`,[email,claims.name || email.split('@')[0],placeholderHash,claims.sub,claims.picture || null]);
      user = created.rows[0];
    } else if (!user.google_subject) {
      const updated = await query('UPDATE users SET google_subject=$2,avatar_url=COALESCE(avatar_url,$3),updated_at=now() WHERE id=$1 RETURNING *',[user.id,claims.sub,claims.picture||null]);
      user = updated.rows[0];
    }
    res.json(await authPayload(user, device || deviceFromRequest(req)));
  } catch(e) { if (String(e.message).startsWith('invalid_google') || e.message==='google_email_unverified') return fail(res,401,'invalid_google_token','Google sign-in could not be verified'); next(e); }});

  app.post('/v1/auth/password-reset', async (req,res,next) => { try {
    const email = normalizeEmail(req.body?.email || '');
    const found = await query('SELECT id FROM users WHERE email=$1 AND status=$2',[email,'active']);
    if (found.rowCount) {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now()+30*60_000);
      await transaction(async client => {
        await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',[found.rows[0].id]);
        await client.query('INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,$3)',[found.rows[0].id,sha256(token),expiresAt]);
        await client.query(`INSERT INTO notification_outbox(user_id,event_type,payload) VALUES($1,'auth.password_reset',$2::jsonb)`,[found.rows[0].id,JSON.stringify({token,expiresAt,webBaseUrl:config.publicWebBaseUrl})]);
      });
    }
    res.status(202).json({ok:true});
  } catch(e){next(e);} });

  app.post('/v1/auth/password', authenticate, async (req,res,next) => { try {
    const password = String(req.body?.password || '');
    if (password.length < 8) return fail(res,400,'weak_password','Use at least 8 characters');
    await query('UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1',[req.user.id,await hashPassword(password)]);
    res.status(204).end();
  } catch(e){next(e);} });

  app.get('/v1/me', authenticate, async (req,res,next) => { try {
    const r=await query('SELECT id,email,phone,display_name,city,avatar_url,preferences,created_at FROM users WHERE id=$1',[req.user.id]);
    const u=r.rows[0]; if(!u) return fail(res,404,'not_found','Profile not found');
    ok(res,{id:u.id,display_name:u.display_name,full_name:u.display_name,avatar_url:u.avatar_url,email:u.email,phone:u.phone,city:u.city,preferences:u.preferences||{}});
  } catch(e){next(e);} });
  app.patch('/v1/me', authenticate, async (req,res,next) => { try {
    const b=req.body||{};
    const r=await query(`UPDATE users SET display_name=COALESCE($2,display_name),phone=COALESCE($3,phone),city=COALESCE($4,city),preferences=COALESCE($5::jsonb,preferences),avatar_url=COALESCE($6,avatar_url),updated_at=now() WHERE id=$1 RETURNING *`,[req.user.id,b.display_name||b.full_name||null,b.phone||null,b.city||null,b.preferences?JSON.stringify(b.preferences):null,b.avatar_path||null]);
    const u=r.rows[0]; ok(res,{id:u.id,display_name:u.display_name,full_name:u.display_name,avatar_url:u.avatar_url,email:u.email,phone:u.phone,city:u.city,preferences:u.preferences||{}});
  } catch(e){next(e);} });
  app.delete('/v1/me/avatar', authenticate, async (req,res,next)=>{try{await query('UPDATE users SET avatar_url=NULL,updated_at=now() WHERE id=$1',[req.user.id]);ok(res,{removed:true});}catch(e){next(e);}});

  app.get('/v1/saved-places', authenticate, async(req,res,next)=>{try{const r=await query('SELECT * FROM saved_places WHERE user_id=$1 ORDER BY updated_at DESC',[req.user.id]);ok(res,r.rows.map(p=>({id:p.id,name:p.label,category:p.kind,formatted_address:p.formatted_address,latitude:p.lat,longitude:p.lng,provider_place_id:p.provider_place_id,is_favorite:p.is_favorite,is_suggested:p.is_suggested})));}catch(e){next(e);}});
  app.post('/v1/saved-places', authenticate, async(req,res,next)=>{try{const b=req.body||{};const r=await query(`INSERT INTO saved_places(user_id,label,kind,formatted_address,lat,lng,provider_place_id,is_favorite,is_suggested,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[req.user.id,b.label,b.kind||'custom',b.formatted_address||null,b.lat,b.lng,b.provider_place_id||null,!!b.is_favorite,!!b.is_suggested,b.source||'manual']);const p=r.rows[0];ok(res,{id:p.id,name:p.label,category:p.kind,formatted_address:p.formatted_address,latitude:p.lat,longitude:p.lng,provider_place_id:p.provider_place_id,is_favorite:p.is_favorite,is_suggested:p.is_suggested},201);}catch(e){next(e);}});
  app.patch('/v1/saved-places/:id', authenticate, async(req,res,next)=>{try{const b=req.body||{};const r=await query(`UPDATE saved_places SET label=$3,kind=$4,formatted_address=$5,lat=$6,lng=$7,provider_place_id=$8,is_favorite=COALESCE($9,is_favorite),is_suggested=COALESCE($10,is_suggested),updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,[req.params.id,req.user.id,b.label,b.kind||'custom',b.formatted_address||null,b.lat,b.lng,b.provider_place_id||null,b.is_favorite,b.is_suggested]);if(!r.rowCount)return fail(res,404,'not_found','Saved place not found');const p=r.rows[0];ok(res,{id:p.id,name:p.label,category:p.kind,formatted_address:p.formatted_address,latitude:p.lat,longitude:p.lng,provider_place_id:p.provider_place_id,is_favorite:p.is_favorite,is_suggested:p.is_suggested});}catch(e){next(e);}});
  app.delete('/v1/saved-places/:id', authenticate, async(req,res,next)=>{try{await query('DELETE FROM saved_places WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);ok(res,null);}catch(e){next(e);}});

  const trustedDto=p=>({id:p.id,name:p.name,phone:p.phone,email:p.email,relationship:p.relationship,note:p.note,invite_status:p.invite_status,can_view_live_trips:p.can_view_live_trips,can_receive_emergency_alerts:p.can_receive_emergency_alerts,can_receive_incident_updates:p.can_receive_incident_updates,is_default_share_contact:p.is_default_share_contact,is_emergency_contact:p.is_emergency_contact,created_at:p.created_at});
  app.get('/v1/trusted-people', authenticate, async(req,res,next)=>{try{const r=await query('SELECT * FROM trusted_people WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]);ok(res,r.rows.map(trustedDto));}catch(e){next(e);}});
  app.post('/v1/trusted-people', authenticate, async(req,res,next)=>{try{const b=req.body||{};const r=await query(`INSERT INTO trusted_people(user_id,name,phone,email,relationship,note,can_view_live_trips,can_receive_emergency_alerts,can_receive_incident_updates,is_default_share_contact,is_emergency_contact) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[req.user.id,b.name,b.phone,b.email||null,b.relationship||null,b.note||null,b.can_view_live_trips!==false,b.can_receive_emergency_alerts!==false,b.can_receive_incident_updates!==false,!!b.is_default_share_contact,!!b.is_emergency_contact]);ok(res,trustedDto(r.rows[0]),201);}catch(e){next(e);}});
  app.patch('/v1/trusted-people/:id', authenticate, async(req,res,next)=>{try{const b=req.body||{};const r=await query(`UPDATE trusted_people SET name=$3,phone=$4,email=$5,relationship=$6,note=$7,can_view_live_trips=$8,can_receive_emergency_alerts=$9,can_receive_incident_updates=$10,is_default_share_contact=$11,is_emergency_contact=$12,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,[req.params.id,req.user.id,b.name,b.phone,b.email||null,b.relationship||null,b.note||null,b.can_view_live_trips!==false,b.can_receive_emergency_alerts!==false,b.can_receive_incident_updates!==false,!!b.is_default_share_contact,!!b.is_emergency_contact]);if(!r.rowCount)return fail(res,404,'not_found','Trusted person not found');ok(res,trustedDto(r.rows[0]));}catch(e){next(e);}});
  app.delete('/v1/trusted-people/:id', authenticate, async(req,res,next)=>{try{await query('DELETE FROM trusted_people WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);ok(res,null);}catch(e){next(e);}});
  app.post('/v1/trusted-people/:id/invite', authenticate, async(req,res,next)=>{try{const token=randomBytes(24).toString('base64url');const expires=new Date(Date.now()+7*86400000);const r=await query(`UPDATE trusted_people SET invite_token_hash=$3,invite_expires_at=$4,invite_status='pending',updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,[req.params.id,req.user.id,sha256(token),expires]);if(!r.rowCount)return fail(res,404,'not_found','Trusted person not found');const p=r.rows[0];ok(res,{id:p.id,name:p.name,phone:p.phone,email:p.email,invite_status:p.invite_status,invite_url:`${config.publicWebBaseUrl}/invite/${token}`,expires_at:expires});}catch(e){next(e);}});

  app.get('/v1/sync/capabilities', authenticate, (_req,res)=>ok(res,{journey_sync:true,location_batch:true,incident_sync:true,max_location_batch:500}));
  app.get('/v1/journeys/active', authenticate, async(req,res,next)=>{try{const r=await query(`SELECT * FROM journeys WHERE user_id=$1 AND status IN ('active','paused') ORDER BY updated_at DESC LIMIT 1`,[req.user.id]);ok(res,r.rowCount?toJourneyDto(r.rows[0]):null);}catch(e){next(e);}});
  app.post('/v1/journeys/sync', authenticate, async(req,res,next)=>{try{const b=req.body||{};if(!b.client_journey_id)return fail(res,400,'validation_error','client_journey_id is required');const m=modeMap(b.vehicle||b.journey_mode);const ended=!!b.ended_at;const r=await query(`INSERT INTO journeys(user_id,client_id,mode,status,journey_role,purpose,origin_name,origin_lat,origin_lng,destination_name,destination_lat,destination_lng,prefer_safe,prefer_paved,started_at,ended_at,distance_m,duration_s,end_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT(user_id,client_id) DO UPDATE SET status=EXCLUDED.status,journey_role=COALESCE(EXCLUDED.journey_role,journeys.journey_role),purpose=COALESCE(EXCLUDED.purpose,journeys.purpose),destination_name=COALESCE(EXCLUDED.destination_name,journeys.destination_name),destination_lat=COALESCE(EXCLUDED.destination_lat,journeys.destination_lat),destination_lng=COALESCE(EXCLUDED.destination_lng,journeys.destination_lng),ended_at=COALESCE(EXCLUDED.ended_at,journeys.ended_at),distance_m=GREATEST(journeys.distance_m,EXCLUDED.distance_m),duration_s=GREATEST(journeys.duration_s,EXCLUDED.duration_s),updated_at=now() RETURNING *`,[req.user.id,b.client_journey_id,m,ended?'completed':'active',b.role||null,b.purpose||'personal',b.origin_label||null,b.origin?.lat||null,b.origin?.lng||null,b.destination_label||null,b.destination?.lat||null,b.destination?.lng||null,!!b.prefer_safe,!!b.prefer_paved,b.started_at||new Date(),b.ended_at||null,Number(b.distance_m||0),Number(b.duration_s||0),ended?'user_completed':null]);ok(res,toJourneyDto(r.rows[0]));}catch(e){next(e);}});
  app.post('/v1/journeys/:id/locations', authenticate, async(req,res,next)=>{try{const own=await query('SELECT id FROM journeys WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!own.rowCount)return fail(res,404,'not_found','Journey not found');const points=Array.isArray(req.body?.points)?req.body.points:[];let inserted=0,duplicates=0;for(const p of points.slice(0,500)){const r=await query(`INSERT INTO journey_points(journey_id,client_point_id,lat,lng,accuracy_m,speed_mps,bearing_deg,recorded_at,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'gps') ON CONFLICT(journey_id,client_point_id) DO NOTHING`,[req.params.id,p.client_point_id,p.lat,p.lng,p.accuracy||null,p.calibrated_speed??p.speed??null,p.heading||null,p.recorded_at]);if(r.rowCount)inserted++;else duplicates++;}if(points.length){const last=points[points.length-1];await query('UPDATE journeys SET last_lat=$2,last_lng=$3,last_location_at=$4,updated_at=now() WHERE id=$1',[req.params.id,last.lat,last.lng,last.recorded_at]);}ok(res,{accepted:Math.min(points.length,500),inserted,duplicates,late_reconciliation:false});}catch(e){next(e);}});
  app.patch('/v1/journeys/:id', authenticate, async(req,res,next)=>{try{const b=req.body||{};const r=await query(`UPDATE journeys SET purpose=COALESCE($3,purpose),mode=COALESCE($4,mode),origin_name=COALESCE($5,origin_name),origin_lat=COALESCE($6,origin_lat),origin_lng=COALESCE($7,origin_lng),destination_name=COALESCE($8,destination_name),destination_lat=COALESCE($9,destination_lat),destination_lng=COALESCE($10,destination_lng),updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,[req.params.id,req.user.id,b.purpose||null,b.journey_mode?modeMap(b.journey_mode):null,b.origin_label||null,b.origin?.lat||null,b.origin?.lng||null,b.destination_label||null,b.destination?.lat||null,b.destination?.lng||null]);if(!r.rowCount)return fail(res,404,'not_found','Journey not found');ok(res,toJourneyDto(r.rows[0]));}catch(e){next(e);}});

  app.get('/v1/journeys/recent-destinations', authenticate, async(req,res,next)=>{try{const r=await query(`SELECT DISTINCT ON(destination_name,destination_lat,destination_lng) destination_name,destination_lat,destination_lng,updated_at FROM journeys WHERE user_id=$1 AND destination_lat IS NOT NULL AND destination_lng IS NOT NULL ORDER BY destination_name,destination_lat,destination_lng,updated_at DESC LIMIT 20`,[req.user.id]);ok(res,r.rows.map(x=>({name:x.destination_name||'Recent destination',lat:x.destination_lat,lng:x.destination_lng,type:'Recent'})));}catch(e){next(e);}});

  app.get('/v1/incidents/:id', authenticate, async(req,res,next)=>{try{const r=await query(`SELECT i.*, (SELECT media_url FROM incident_evidence WHERE incident_id=i.id AND media_type='image' ORDER BY created_at DESC LIMIT 1) photo_url FROM incidents i WHERE i.id=$1`,[req.params.id]);if(!r.rowCount)return fail(res,404,'not_found','Incident not found');const i=toIncident(r.rows[0]);ok(res,{id:i.id,type:i.type,lat:i.lat,lng:i.lng,note:i.note,severity:i.severity,road_impact:i.road_impact,photo_url:i.public_photo_url,created_at:i.created_at,expires_at:i.expires_at||new Date(Date.now()+3600000).toISOString()});}catch(e){next(e);}});
  app.post('/v1/incidents/:id/verify', authenticate, async(req,res,next)=>{try{const vote=req.query.confirmed==='true'?'confirm':'dispute';await query(`INSERT INTO incident_votes(incident_id,user_id,vote) VALUES($1,$2,$3) ON CONFLICT(incident_id,user_id) DO UPDATE SET vote=EXCLUDED.vote,created_at=now()`,[req.params.id,req.user.id,vote]);const counts=await query(`SELECT count(*) FILTER(WHERE vote='confirm') confirmations,count(*) FILTER(WHERE vote='dispute') disputes FROM incident_votes WHERE incident_id=$1`,[req.params.id]);const c=counts.rows[0];const r=await query('UPDATE incidents SET confirmations=$2,disputes=$3,updated_at=now() WHERE id=$1 RETURNING *',[req.params.id,Number(c.confirmations),Number(c.disputes)]);if(!r.rowCount)return fail(res,404,'not_found','Incident not found');ok(res,toIncident(r.rows[0]));}catch(e){next(e);}});

  app.get('/v1/traffic/snapshot', authenticate, async(req,res,next)=>{try{const lat=Number(req.query.lat),lng=Number(req.query.lng),radius=Math.min(Number(req.query.radius_m||2000),20000);const r=await query(`SELECT count(*)::int observations, avg(speed_mps) avg_speed FROM journey_points WHERE received_at>now()-interval '15 minutes' AND (6371000*2*asin(sqrt(power(sin(radians(lat-$1)/2),2)+cos(radians($1))*cos(radians(lat))*power(sin(radians(lng-$2)/2),2))))<=$3`,[lat,lng,radius]);const n=Number(r.rows[0].observations||0),s=Number(r.rows[0].avg_speed||0)*3.6;if(n<3)return ok(res,{status:'low_confidence',traffic_state:null,confidence:Math.min(.5,n/6),observation_count:n,source_count:n,observed_at:new Date(),expires_at:new Date(Date.now()+5*60000)});const state=s<8?'severe':s<18?'heavy':s<35?'moderate':'clear';ok(res,{status:'known',traffic_state:state,confidence:Math.min(.95,.55+n*.03),observation_count:n,source_count:n,observed_at:new Date(),expires_at:new Date(Date.now()+5*60000)});}catch(e){next(e);}});
  app.get('/v1/safe-havens/nearby', authenticate, (_req,res)=>ok(res,[]));
}
