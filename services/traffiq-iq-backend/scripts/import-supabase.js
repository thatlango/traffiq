import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pool, query, transaction } from '../src/db.js';

const sourceDir = path.resolve(process.argv[2] ?? '/migration');
const required = ['auth-users-public','auth-password-hashes','profiles','trusted_people','journeys','location_history','live_shares','signals','motion_events','panic_events','traffic_heatmap_tiles'];
const readRows = (name) => {
  const file = path.join(sourceDir, `${name}.jsonl`);
  if (!fs.existsSync(file)) throw new Error(`Missing migration file: ${file}`);
  return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map((line,i) => {
    try { return JSON.parse(line); } catch (e) { throw new Error(`${name}:${i+1}: ${e.message}`); }
  });
};
const datasets = Object.fromEntries(required.map(n => [n, readRows(n)]));
const passwordHashes = new Map(datasets['auth-password-hashes'].map(r => [r.id, r.encrypted_password]));
const profiles = new Map(datasets.profiles.map(r => [r.id, r]));
const uuidFrom = (value) => {
  const h=createHash('sha256').update(String(value)).digest('hex').slice(0,32).split('');
  h[12]='4'; h[16]=(parseInt(h[16],16)&3|8).toString(16);
  return `${h.slice(0,8).join('')}-${h.slice(8,12).join('')}-${h.slice(12,16).join('')}-${h.slice(16,20).join('')}-${h.slice(20).join('')}`;
};
const shareHash = token => createHash('sha256').update(token).digest('hex');
const modeMap = new Map([
  ['car','car'],['motorcycle','motorcycle'],['boda','motorcycle'],['taxi','taxi'],['public_taxi','taxi'],['bus','bus'],['truck','truck'],['bicycle','bicycle'],['walking','walking'],['walk','walking'],['other','other']
]);
const modeOf = r => modeMap.get(String(r.transport_mode ?? r.vehicle ?? 'other').toLowerCase()) ?? 'other';
const activeStatus = u => (u.banned_until || u.deleted_at ? 'disabled' : 'active');
const nullIfBlank = v => (typeof v === 'string' && v.trim() === '') || v == null ? null : v;
let dbQuery = query;

async function archive(table, rows, idKey='id') {
  for (let i=0;i<rows.length;i++) {
    const r=rows[i]; const id=String(r[idKey] ?? `${i}`);
    await dbQuery(`INSERT INTO legacy_supabase_rows(source_table,source_id,payload) VALUES($1,$2,$3::jsonb)
                 ON CONFLICT(source_table,source_id) DO UPDATE SET payload=EXCLUDED.payload, imported_at=now()`, [table,id,JSON.stringify(r)]);
  }
}

async function importUsers() {
  const auth = datasets['auth-users-public'];
  for (const u of auth) {
    const p=profiles.get(u.id) ?? {};
    const meta=u.user_metadata ?? {};
    const app=u.app_metadata ?? {};
    const providerSet=new Set([app.provider,...(app.providers ?? [])].filter(Boolean));
    const googleSubject=providerSet.has('google') ? String(meta.sub ?? meta.provider_id ?? '') || null : null;
    const display=p.full_name || p.display_name || meta.full_name || meta.name || (u.email ? u.email.split('@')[0] : 'TraffIQ user');
    const pw=passwordHashes.get(u.id) ?? `oauth-only$${uuidFrom(`oauth:${u.id}`)}`;
    await dbQuery(`INSERT INTO users(id,email,phone,display_name,password_hash,status,google_subject,city,avatar_url,preferences,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
      ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,phone=EXCLUDED.phone,display_name=EXCLUDED.display_name,password_hash=EXCLUDED.password_hash,status=EXCLUDED.status,google_subject=COALESCE(EXCLUDED.google_subject,users.google_subject),city=EXCLUDED.city,avatar_url=EXCLUDED.avatar_url,preferences=EXCLUDED.preferences,updated_at=EXCLUDED.updated_at`,
      [u.id,String(u.email).toLowerCase(),nullIfBlank(p.phone ?? u.phone),display,pw,activeStatus(u),googleSubject,p.city ?? null,p.avatar_url ?? meta.avatar_url ?? null,JSON.stringify(p.preferences ?? {}),u.created_at ?? new Date(),u.updated_at ?? new Date()]);
  }
  const ownerIds=new Set([...datasets.journeys.map(r=>r.user_id),...datasets.live_shares.map(r=>r.user_id),...datasets.location_history.map(r=>r.user_id)]);
  const authIds=new Set(auth.map(r=>r.id));
  for (const id of ownerIds) if (id && !authIds.has(id)) {
    await dbQuery(`INSERT INTO users(id,email,display_name,password_hash,status) VALUES($1,$2,$3,$4,'disabled') ON CONFLICT(id) DO NOTHING`,
      [id,`legacy+${id}@invalid.traffiq.local`,'Legacy TraffIQ user',`disabled$${uuidFrom(id)}`]);
  }
}

async function importTrustedPeople() {
  for (const r of datasets.trusted_people) {
    const tokenHash=r.invite_token_hash ?? (r.invite_token ? shareHash(r.invite_token) : null);
    await dbQuery(`INSERT INTO trusted_people(id,user_id,name,phone,email,relationship,note,invite_status,invite_token_hash,invite_expires_at,can_view_live_trips,can_receive_emergency_alerts,can_receive_incident_updates,is_default_share_contact,is_emergency_contact,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,email=EXCLUDED.email,relationship=EXCLUDED.relationship,note=EXCLUDED.note,invite_status=EXCLUDED.invite_status,invite_token_hash=EXCLUDED.invite_token_hash,invite_expires_at=EXCLUDED.invite_expires_at,can_view_live_trips=EXCLUDED.can_view_live_trips,can_receive_emergency_alerts=EXCLUDED.can_receive_emergency_alerts,can_receive_incident_updates=EXCLUDED.can_receive_incident_updates,is_default_share_contact=EXCLUDED.is_default_share_contact,is_emergency_contact=EXCLUDED.is_emergency_contact,updated_at=EXCLUDED.updated_at`,
      [r.id,r.user_id,r.name,nullIfBlank(r.phone) ?? '',nullIfBlank(r.email),r.relationship ?? null,r.note ?? null,r.invite_status ?? 'pending',tokenHash,r.invite_expires_at ?? null,r.can_view_live_trips ?? true,r.can_receive_emergency_alerts ?? true,r.can_receive_incident_updates ?? true,r.is_default_share_contact ?? false,r.is_emergency_contact ?? false,r.created_at ?? new Date(),r.updated_at ?? new Date()]);
  }
}

async function importJourneys() {
  for (const r of datasets.journeys) {
    const status=r.ended_at ? (r.end_reason === 'cancelled' ? 'cancelled' : 'completed') : 'cancelled';
    const endReason = r.end_reason ?? (r.ended_at ? null : 'legacy_open_at_migration');
    const clientId = /^[0-9a-f-]{36}$/i.test(r.client_journey_id ?? '') ? r.client_journey_id : uuidFrom(`journey-client:${r.id}`);
    const pathPoints=Array.isArray(r.path)?r.path:[];
    const last=pathPoints.at(-1);
    const lastLat=Array.isArray(last)?last[0]:last?.lat ?? null;
    const lastLng=Array.isArray(last)?last[1]:last?.lng ?? null;
    const lastAt=(!Array.isArray(last) && last?.recorded_at) || r.last_activity_at || r.ended_at || r.started_at || r.created_at;
    await dbQuery(`INSERT INTO journeys(id,user_id,client_id,mode,status,origin_name,origin_lat,origin_lng,destination_name,destination_lat,destination_lng,started_at,ended_at,last_lat,last_lng,last_location_at,distance_m,duration_s,created_at,updated_at,journey_role,purpose,end_reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,mode=EXCLUDED.mode,status=EXCLUDED.status,origin_name=EXCLUDED.origin_name,origin_lat=EXCLUDED.origin_lat,origin_lng=EXCLUDED.origin_lng,destination_name=EXCLUDED.destination_name,destination_lat=EXCLUDED.destination_lat,destination_lng=EXCLUDED.destination_lng,started_at=EXCLUDED.started_at,ended_at=EXCLUDED.ended_at,last_lat=EXCLUDED.last_lat,last_lng=EXCLUDED.last_lng,last_location_at=EXCLUDED.last_location_at,distance_m=EXCLUDED.distance_m,duration_s=EXCLUDED.duration_s,updated_at=EXCLUDED.updated_at,journey_role=EXCLUDED.journey_role,purpose=EXCLUDED.purpose,end_reason=EXCLUDED.end_reason`,
      [r.id,r.user_id,clientId,modeOf(r),status,r.origin_label ?? null,r.origin_lat ?? null,r.origin_lng ?? null,r.destination_label ?? null,r.destination_lat ?? null,r.destination_lng ?? null,r.started_at ?? r.created_at,r.ended_at ?? null,lastLat,lastLng,lastAt,Number(r.distance_m ?? 0),Number(r.duration_s ?? 0),r.created_at ?? r.started_at ?? new Date(),r.last_activity_at ?? r.ended_at ?? r.created_at ?? new Date(),r.journey_role ?? null,r.purpose ?? 'personal',endReason]);
    for (let i=0;i<pathPoints.length;i++) {
      const p=pathPoints[i]; const isArray=Array.isArray(p);
      const lat=Number(isArray?p[0]:p.lat), lng=Number(isArray?p[1]:p.lng);
      if (!Number.isFinite(lat)||!Number.isFinite(lng)) continue;
      const recorded=(!isArray && p.recorded_at) || new Date(new Date(r.started_at ?? r.created_at).getTime()+i*1000).toISOString();
      await dbQuery(`INSERT INTO journey_points(journey_id,client_point_id,lat,lng,accuracy_m,speed_mps,bearing_deg,recorded_at,source)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'gps') ON CONFLICT(journey_id,client_point_id) DO NOTHING`,
        [r.id,uuidFrom(`path:${r.id}:${i}`),lat,lng,isArray?null:p.accuracy ?? null,isArray?null:p.speed ?? null,isArray?null:p.heading ?? null,recorded]);
    }
  }
  for (const r of datasets.location_history) {
    if (!r.journey_id) continue;
    const exists=await dbQuery('SELECT 1 FROM journeys WHERE id=$1',[r.journey_id]);
    if (!exists.rowCount) continue;
    const cp = /^[0-9a-f-]{36}$/i.test(String(r.client_point_id ?? '')) ? r.client_point_id : uuidFrom(`location-history:${r.id}`);
    await dbQuery(`INSERT INTO journey_points(journey_id,client_point_id,lat,lng,accuracy_m,speed_mps,bearing_deg,recorded_at,source)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'gps') ON CONFLICT(journey_id,client_point_id) DO NOTHING`,
      [r.journey_id,cp,Number(r.lat),Number(r.lng),r.accuracy ?? null,r.calibrated_speed ?? r.speed ?? r.raw_speed ?? null,r.heading ?? null,r.recorded_at]);
  }
}

async function importLiveShares() {
  for (const r of datasets.live_shares) {
    const tokenHash=shareHash(String(r.token));
    await dbQuery(`INSERT INTO live_shares(id,user_id,token_hash,display_name,lat,lng,accuracy,heading,speed,active,expires_at,last_updated_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(id) DO UPDATE SET token_hash=EXCLUDED.token_hash,display_name=EXCLUDED.display_name,lat=EXCLUDED.lat,lng=EXCLUDED.lng,accuracy=EXCLUDED.accuracy,heading=EXCLUDED.heading,speed=EXCLUDED.speed,active=EXCLUDED.active,expires_at=EXCLUDED.expires_at,last_updated_at=EXCLUDED.last_updated_at`,
      [r.id,r.user_id,tokenHash,r.display_name ?? null,r.lat ?? null,r.lng ?? null,r.accuracy ?? null,r.heading ?? null,r.speed ?? null,r.active ?? true,r.expires_at,r.location_updated_at ?? r.updated_at ?? r.created_at,r.created_at]);
    if (r.journey_id) {
      await dbQuery(`INSERT INTO journey_shares(id,journey_id,user_id,token_hash,expires_at,revoked_at,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(token_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at,revoked_at=EXCLUDED.revoked_at`,
        [uuidFrom(`legacy-journey-share:${r.id}`),r.journey_id,r.user_id,tokenHash,r.expires_at,(r.active ?? true)?null:(r.updated_at ?? new Date()),r.created_at]);
    }
  }
}

async function main() {
  console.log('source counts', Object.fromEntries(Object.entries(datasets).map(([k,v])=>[k,v.length])));
  await transaction(async (client) => {
    dbQuery = (text, params=[]) => client.query(text, params);
    for (const name of ['profiles','trusted_people','journeys','location_history','live_shares','signals','motion_events','panic_events','traffic_heatmap_tiles']) await archive(name,datasets[name]);
    await importUsers();
    await importTrustedPeople();
    await importJourneys();
    await importLiveShares();
  });
  dbQuery = query;
  const result=await query(`SELECT
    (SELECT count(*)::int FROM users) users,
    (SELECT count(*)::int FROM journeys) journeys,
    (SELECT count(*)::int FROM journey_points) journey_points,
    (SELECT count(*)::int FROM live_shares) live_shares,
    (SELECT count(*)::int FROM journey_shares) journey_shares,
    (SELECT count(*)::int FROM legacy_supabase_rows) archived_rows`);
  console.log('target counts',result.rows[0]);
}

main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>pool.end());
